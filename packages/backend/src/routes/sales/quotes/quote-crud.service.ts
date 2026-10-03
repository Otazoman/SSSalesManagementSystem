import { Context } from "hono";
import { QuoteRepository } from "./quote.repository";
import { QuotePayload } from "./quote.schema";
import { RESOURCE_KEY } from "./quote-constants";
import { buildQuoteItemInsertRow, QuoteItemInput } from "./quote-item-mapper";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { deleteOrphanedR2Attachments } from "../../../platform/r2/delete-orphaned-attachments";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { getDocumentNumberFormatConfig } from "../../../platform/id/resolve-document-id";
import { generateFormattedCode } from "../../../platform/id/generate-short-code";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { isQuoteWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { SearchQuotesQuery } from "./quote.schema";
import { SortQuery } from "../../../platform/http/sort";
import { recalculateDocumentTotals } from "../../../platform/tax/recalculate-document-totals";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

// Item4-f: quote.service.tsから分割。検索・詳細取得・CRUD・承認申請/削除申請の状態遷移を担当
export class QuoteCrudService {
  private repo: QuoteRepository;

  constructor(repo: QuoteRepository) {
    this.repo = repo;
  }

  // 1. 一覧検索
  async searchQuotes(c: Context, query: SearchQuotesQuery, sort?: SortQuery) {
    const result = await this.repo.findQuotes(query, sort);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_QUOTES_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
      searchConditions: { ...query },
      viewedRecordCount: result.length,
      matchedQuoteIds: result.map((q) => q.id),
    }),
    );

    return await this.attachFilesToQuotes(result);
  }

  async searchQuotesPage(
    c: Context,
    query: SearchQuotesQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [result, total] = await Promise.all([
      this.repo.findQuotesPage(query, params, sort),
      this.repo.countQuotes(query),
    ]);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_QUOTES_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
      searchConditions: { ...query },
      viewedRecordCount: result.length,
      matchedQuoteIds: result.map((q) => q.id),
    }),
    );

    const data = await this.attachFilesToQuotes(result);

    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  private async attachFilesToQuotes(quotes: Awaited<ReturnType<QuoteRepository["findQuotes"]>>) {
    const quoteIds = quotes.map((q) => q.id);
    if (quoteIds.length === 0) return [];

    const allAttachments = await this.repo.findAttachmentsByQuoteIds(quoteIds);
    return quotes.map((q) => ({
      ...q,
      customerId: q.partnerId,
      attachments: allAttachments.filter((att) => att.quoteId === q.id),
    }));
  }

  // 4. 詳細取得
  async getQuoteDetail(c: Context, id: string) {
    const header = await this.repo.findQuoteById(id);
    if (!header) return null;

    const items = await this.repo.findQuoteItems(id);
    const rawAttachments = await this.repo.findQuoteAttachments(id);

    const baseUrl = new URL(c.req.url).origin;
    const attachments = rawAttachments.map((att) => {
      let downloadUrl = att.externalUrl || null;
      if (att.storageType === "R2" && att.attachmentR2Path) {
        downloadUrl = `${baseUrl}/api/quotes/download/${id}/${att.id}`;
      }
      return { ...att, downloadUrl };
    });

    return { ...header, customerId: header.partnerId, items, attachments };
  }

  // 5. 新規登録
  async createQuote(c: Context, formData: FormData, body: QuotePayload) {
    // BUG-042: 保存する合計・消費税は、明細から計算し直す(会社設定の端数処理。画面の計算は表示用)
    body = await recalculateDocumentTotals(c.env.COMPANY_SETTINGS, body, await this.repo.findTaxCategoryRates());
    const opId = await this.repo.getFallbackOperatorId(c);
    let quoteId = body.id;

    // 伝票番号フォーマット統一化: 新規作成時(候補IDが無い場合)は、会社設定を反映した
    // ベース番号を生成したうえで、末尾に版数"-1"を付与する(1版から開始、ユーザー確認済み)。
    // 下のexists判定+再試行ループが、Ver.UP(改訂)時に自動で"-2","-3"...と採番する
    if (!quoteId) {
      const config = await getDocumentNumberFormatConfig(c, "quote");
      quoteId = `${generateFormattedCode(config)}-1`;
    }

    if (quoteId) {
      const exists = await this.repo.existsQuote(quoteId);
      if (exists) {
        let isUnique = false;
        let revNumber = 1;
        let baseId = quoteId;
        const lastHyphenIndex = quoteId.lastIndexOf("-");
        if (lastHyphenIndex !== -1) {
          const trailingPart = quoteId.substring(lastHyphenIndex + 1);
          if (/^\d+$/.test(trailingPart)) {
            baseId = quoteId.substring(0, lastHyphenIndex);
          }
        }
        while (!isUnique) {
          const checkId = `${baseId}-${revNumber}`;
          const dupCheck = await this.repo.existsQuote(checkId);
          if (!dupCheck) {
            quoteId = checkId;
            isUnique = true;
          } else {
            revNumber++;
          }
        }
      }
    }

    const targetPartnerId = body.partnerId || (body as any).customerId || null;
    const fallbackId = await this.repo.getFallbackOperatorId(c);
    const targetDepartment =
      body.companyDepartment || body.company_department || null;
    // Item4-d: 自社担当者(employeeNumber)は監査用のcreatedBy/updatedByとは別の専用列へ保存する
    const targetSalesPersonEmployeeNumber =
      (body as any).salesPersonEmployeeNumber || null;
    // Item7残課題(見積へも展開): 未指定時はログイン操作者(fallbackId)を入力担当者の既定値とする
    const targetInputPersonEmployeeNumber =
      (body as any).inputPersonEmployeeNumber || fallbackId;

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.insertQuote({
      id: quoteId,
      title: body.title || null,
      partnerId: targetPartnerId, // customerId -> partnerId
      quoteDate: new Date(body.quoteDate),
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      status: "DRAFT",
      totalAmount: body.totalAmount || 0,
      taxAmount: body.taxAmount || 0,
      memo: body.memo || null,
      terms: body.terms || null,
      salesPersonEmployeeNumber: targetSalesPersonEmployeeNumber,
      inputPersonEmployeeNumber: targetInputPersonEmployeeNumber,
      companyName: body.companyName || null,
      companyDepartment: targetDepartment || null,
      companyAddress: body.companyAddress || null,
      companyTel: body.companyTel || null,
      companyFax: body.companyFax || null,
      deliveryDate: body.deliveryDate || null,
      deliveryPlace: body.deliveryPlace || null,
      paymentTerms: body.paymentTerms || null,
      projectId: body.projectId || null,
      // Item4-d: createdBy/updatedByは常にセッションの実操作者(Item1の全社統一方針)。
      // 以前はbody.updatedBy(実態は自社担当者のuserId)を優先していたため、
      // 監査ログとしての意味が崩れていた
      createdBy: fallbackId,
      updatedBy: fallbackId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (body.items && Array.isArray(body.items)) {
      for (const [index, item] of body.items.entries()) {
        await tx.repo.insertQuoteItem(
          buildQuoteItemInsertRow(item, quoteId, index),
        );
      }
    }

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path = null;
        let extUrl = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (fileObj) {
            r2Path = generateAttachmentKey(`quotes/${quoteId}`, fileObj.name);
            await c.env.QUATES_BUCKET.put(r2Path, fileObj.stream(), {
              httpMetadata: { contentType: fileObj.type },
            });
          }
        } else {
          extUrl = att.externalUrl || null;
        }

        await tx.repo.insertQuoteAttachment({
          id: crypto.randomUUID(),
          quoteId,
          fileName: att.fileName,
          storageType: att.storageType,
          attachmentR2Path: r2Path,
          externalUrl: extUrl,
          fileType: att.fileType || "OTHER",
          uploadedById: opId,
          uploadedAt: new Date(),
        });
      }
    }
    await tx.commit();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_QUOTE", RESOURCE_KEY, quoteId, null, {
      id: quoteId,
      partnerId: body.partnerId, // customerId -> partnerId
      totalAmount: body.totalAmount,
    }),
    );

    return {
      success: true,
      message: "見積情報を新規保存しました",
      id: quoteId,
    };
  }

  // 6. 見積更新
  async updateQuote(
    c: Context,
    id: string,
    formData: FormData,
    body: QuotePayload,
  ) {
    // BUG-042: 保存する合計・消費税は、明細から計算し直す(会社設定の端数処理。画面の計算は表示用)
    body = await recalculateDocumentTotals(c.env.COMPANY_SETTINGS, body, await this.repo.findTaxCategoryRates());
    const opId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findQuoteById(id);

    if (oldSnapshot) {
      // 承認機能が無効な場合はpartners(取引先マスタ)と同様、ステータスに関わらず直接編集できる
      // (会社設定で無効化した時点で、審査待ち状態自体の意味が無くなるため)
      const wfEnabled = await isQuoteWorkflowGloballyEnabled(
        c.env.COMPANY_SETTINGS,
      );
      if (wfEnabled) {
        if (
          oldSnapshot.status === "PENDING_APPROVAL" ||
          oldSnapshot.status === "PENDING_DELETION"
        ) {
          throw new BadRequestError("承認処理中の見積は編集できません");
        }
        if (oldSnapshot.status === "APPROVED") {
          throw new BadRequestError(
            "承認済みの見積を編集するには変更申請(/api/approvals/request-update)が必要です",
          );
        }
      }
    }

    const fallbackId = await this.repo.getFallbackOperatorId(c);
    const targetPartnerId = body.partnerId || (body as any).customerId || null;

    const targetDepartment =
      body.companyDepartment || body.company_department || null;
    // Item4-d: 自社担当者(employeeNumber)は監査用のupdatedByとは別の専用列へ保存する
    const targetSalesPersonEmployeeNumber =
      (body as any).salesPersonEmployeeNumber || null;
    // Item7残課題(見積へも展開): 未指定時は既存値を維持し、それも無ければログイン操作者を既定値とする
    const targetInputPersonEmployeeNumber =
      (body as any).inputPersonEmployeeNumber ||
      oldSnapshot?.inputPersonEmployeeNumber ||
      fallbackId;

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.updateQuote(id, {
      title: body.title || null,
      partnerId: targetPartnerId, // customerId -> partnerId
      quoteDate: new Date(body.quoteDate),
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      status: body.status || oldSnapshot?.status || "DRAFT",
      totalAmount: body.totalAmount || 0,
      taxAmount: body.taxAmount || 0,
      memo: body.memo || null,
      terms: body.terms || null,
      salesPersonEmployeeNumber: targetSalesPersonEmployeeNumber,
      inputPersonEmployeeNumber: targetInputPersonEmployeeNumber,
      companyName: body.companyName || null,
      companyDepartment: targetDepartment,
      companyAddress: body.companyAddress || null,
      companyTel: body.companyTel || null,
      companyFax: body.companyFax || null,
      deliveryDate: body.deliveryDate || null,
      deliveryPlace: body.deliveryPlace || null,
      paymentTerms: body.paymentTerms || null,
      projectId: body.projectId || null,
      // Item4-d: updatedByは常にセッションの実操作者(Item1の全社統一方針)
      updatedBy: fallbackId,
      updatedAt: new Date(),
    });

    // 明細IDを保ったまま、保存内容に合わせて明細を更新・追加・削除する(受注明細とのつながりを保つ。
    // 受注から参照されている明細を削除しようとした場合は400で、commit() しないので何も書き込まれない)
    const syncItems = Array.isArray(body.items) ? (body.items as Array<QuoteItemInput & { id?: string | null }>) : [];
    for (const write of await tx.repo.buildItemSyncWrites(id, syncItems)) {
      await write;
    }

    const existingAttachments = await this.repo.findQuoteAttachments(id);

    await tx.repo.deleteQuoteAttachments(id);

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path = att.attachmentR2Path || null;
        let extUrl = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (fileObj) {
            r2Path = generateAttachmentKey(`quotes/${id}`, fileObj.name);
            await c.env.QUATES_BUCKET.put(r2Path, fileObj.stream(), {
              httpMetadata: { contentType: fileObj.type },
            });
          } else if (!r2Path) {
            const match = existingAttachments.find(
              (ea) => ea.fileName === att.fileName && ea.storageType === "R2",
            );
            if (match) r2Path = match.attachmentR2Path;
          }
        } else {
          extUrl = att.externalUrl || null;
        }

        if (r2Path || extUrl) {
          await tx.repo.insertQuoteAttachment({
            id: crypto.randomUUID(),
            quoteId: id,
            fileName: att.fileName,
            storageType: att.storageType,
            attachmentR2Path: r2Path,
            externalUrl: extUrl,
            fileType: att.fileType || "OTHER",
            uploadedById: opId,
            uploadedAt: new Date(),
          });
        }
      }
    }

    await tx.repo.insertHistoryLog({
      id: crypto.randomUUID(),
      quoteId: id,
      version: 1,
      action: "UPDATE",
      snapshotData: JSON.stringify({
        header: {
          ...oldSnapshot,
          quoteDate: oldSnapshot?.quoteDate
            ? new Date(oldSnapshot.quoteDate).toISOString()
            : null,
          validUntil: oldSnapshot?.validUntil
            ? new Date(oldSnapshot.validUntil).toISOString()
            : null,
        },
        items: body.items,
      }),
      changedById: opId,
      changedAt: new Date(),
      comment: body.historyComment || "画面編集による更新",
    });
    await tx.commit();

    if (body.attachments && Array.isArray(body.attachments)) {
      await deleteOrphanedR2Attachments(
        c.env.QUATES_BUCKET,
        existingAttachments,
        body.attachments.map((att: any) => att.attachmentR2Path),
      );
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_QUOTE", RESOURCE_KEY, id, oldSnapshot, {
      id,
      partnerId: body.partnerId, // customerId -> partnerId
      totalAmount: body.totalAmount,
    }),
    );

    return { success: true, message: "見積情報を更新しました" };
  }

  // 7. 見積削除(直接削除。下書き(DRAFT)のみ許可。それ以外はrequestQuoteDeletion経由の削除申請が必要)
  async deleteQuote(c: Context, id: string) {
    const oldSnapshot = await this.repo.findQuoteById(id);
    if (oldSnapshot && oldSnapshot.status !== "DRAFT") {
      throw new BadRequestError(
        "下書き以外の見積を削除するには削除申請が必要です",
      );
    }
    return this.performQuoteDeletion(c, id, oldSnapshot);
  }

  // 見積の物理削除本体(R2添付削除込み)。ステータスによるガードは行わない。
  // deleteQuote(直接削除)・requestQuoteDeletion(承認不要時)・
  // quotes.adapter.ts(DELETE承認確定時)から呼ばれる
  async performQuoteDeletion(c: Context, id: string, knownSnapshot?: any) {
    const oldSnapshot = knownSnapshot ?? (await this.repo.findQuoteById(id));
    const associatedAttachments = await this.repo.findQuoteAttachments(id);

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.deleteQuoteItems(id);
    await tx.repo.deleteQuoteAttachments(id);
    await tx.repo.deleteQuote(id);
    await tx.commit();

    for (const att of associatedAttachments) {
      if (att.storageType === "R2" && att.attachmentR2Path) {
        try {
          await c.env.QUATES_BUCKET.delete(att.attachmentR2Path);
        } catch (r2Err) {
          console.error("R2 delete error during quote removal:", r2Err);
        }
      }
    }
    // 差戻しで下書きに戻った伝票の場合、残っている差戻しの申請を閉じる(BUG-015)。
    // 直接削除・削除申請(下書きは直接削除)・承認不要時・削除の承認確定の、どの経路で消しても閉じる
    await WorkflowEngine.closeRemandedRequestsOfDeletedTarget(createDb(c.env.DB), "sales_quotes", id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_QUOTE", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return {
      success: true,
      message: "見積データおよび紐づくR2添付ファイルを完全に削除しました",
    };
  }

  // Item4-e: 見積の承認申請提出(DRAFT→PENDING_APPROVAL、承認機能OFFなら直接APPROVED)
  async submitForApproval(
    c: Context,
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) {
    const quote = await this.repo.findQuoteById(id);
    if (!quote) throw new NotFoundError("対象の見積が見つかりません");
    if (quote.status !== "DRAFT") {
      throw new BadRequestError("下書き状態の見積のみ承認申請できます");
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isQuoteWorkflowGloballyEnabled(
      c.env.COMPANY_SETTINGS,
    );

    if (!wfEnabled) {
      await this.repo.updateQuote(id, {
        status: "APPROVED",
        updatedBy: employeeNumber,
        updatedAt: new Date(),
      });
      c.executionCtx.waitUntil(
        logAuditEvent(c, "APPROVE_QUOTE_DIRECT", RESOURCE_KEY, id, quote, {
        status: "APPROVED",
      }),
      );
      return {
        success: true,
        message: "承認機能が無効のため、見積を確定しました",
      };
    }

    await this.repo.updateQuote(id, {
      status: "PENDING_APPROVAL",
      updatedBy: employeeNumber,
      updatedAt: new Date(),
    });

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const db = createDb(c.env.DB);
    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: "sales_quotes",
      targetId: id,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: quote.totalAmount || 0,
      comment: `見積[${id}]の承認申請`,
      applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      // 承認フロー自体が未定義等の場合はPENDING_APPROVALへ変更した分を戻す
      await this.repo.updateQuote(id, {
        status: "DRAFT",
        updatedBy: employeeNumber,
        updatedAt: new Date(),
      });
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `見積[${id}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_QUOTE_FOR_APPROVAL", RESOURCE_KEY, id, quote, {
      status: "PENDING_APPROVAL",
    }),
    );

    return { success: true, message: "見積の承認を申請しました" };
  }

  // Item4-e: 見積の削除申請(DRAFTかつ未申請なら承認不要で直接削除、APPROVEDなら削除承認申請)
  async requestQuoteDeletion(c: Context, id: string) {
    const quote = await this.repo.findQuoteById(id);
    if (!quote) throw new NotFoundError("対象の見積が見つかりません");

    if (quote.status === "DRAFT") {
      return this.performQuoteDeletion(c, id, quote);
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isQuoteWorkflowGloballyEnabled(
      c.env.COMPANY_SETTINGS,
    );

    // 承認機能が無効な場合はpartners(取引先マスタ)と同様、ステータスに関わらず直接削除する
    // (会社設定でいったん無効化してから削除、という運用に対応するため)
    if (!wfEnabled) {
      return this.performQuoteDeletion(c, id, quote);
    }

    if (quote.status !== "APPROVED") {
      throw new BadRequestError(
        "承認処理中の見積は削除申請できません。処理完了後に再度お試しください。",
      );
    }

    await this.repo.updateQuote(id, {
      status: "PENDING_DELETION",
      updatedBy: employeeNumber,
      updatedAt: new Date(),
    });

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const db = createDb(c.env.DB);
    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: "sales_quotes",
      targetId: id,
      applicantId: applicantUserId,
      requestType: "DELETE",
      amount: quote.totalAmount || 0,
      comment: `見積[${id}]の削除申請`,
    }, c);

    if (!wfResult.success) {
      await this.repo.updateQuote(id, {
        status: "APPROVED",
        updatedBy: employeeNumber,
        updatedAt: new Date(),
      });
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `見積[${id}]の削除申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_QUOTE_DELETION", RESOURCE_KEY, id, quote, {
      status: "PENDING_DELETION",
    }),
    );

    return { success: true, message: "見積の削除を申請しました" };
  }
}
