import { Context } from "hono";
import { PurchaseRequisitionRepository } from "./purchase-requisition.repository";
import { PurchaseRequisitionPayload } from "./purchase-requisition.schema";
import { RESOURCE_KEY } from "./purchase-requisition-constants";
import { buildPurchaseRequisitionItemInsertRow } from "./purchase-requisition-item-mapper";
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
import { isPurchaseRequisitionWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { SearchPurchaseRequisitionsQuery } from "./purchase-requisition.schema";
import { computeDocumentTotals } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { SortQuery } from "../../../platform/http/sort";
import { DEFAULT_TAX_ROUNDING_MODE, type TaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";
import { getTaxRoundingMode } from "../../../platform/tax/get-tax-rounding-mode";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";
import { assertPartnerNotSuspended } from "../../../platform/partners/suspended-partner";

// Phase3フォローアップ: 見積との項目整合。quote-pdf.service.ts/resolve-quote-placeholders.tsと
// 同じcomputeQuoteAmountBreakdown()を使い、明細のtaxCategoryCode別に消費税を算出する
// (未指定は10%扱い、quotes側のcalcTaxBreakdownと同じ分類方式)。明細が無い場合のみ、
// フロントエンドから送られたtotalAmount/taxAmountをそのまま信頼する(quotesと同じ方針)
async function calcAmounts(
  repo: PurchaseRequisitionRepository,
  items: PurchaseRequisitionPayload["items"],
  fallbackTotal?: number | null,
  fallbackTax?: number | null,
  roundingMode: TaxRoundingMode = DEFAULT_TAX_ROUNDING_MODE,
): Promise<{ totalAmount: number; taxAmount: number }> {
  if (!items || items.length === 0) {
    return { totalAmount: fallbackTotal || 0, taxAmount: fallbackTax || 0 };
  }
  const taxCategoryRates = await repo.findTaxCategoryRates();
  const breakdownItems = items.map((item) => ({
    amount: Number(item.quantity) * Number(item.estimatedUnitPrice),
    taxCategoryCode: item.taxCategoryCode || null,
  }));
  return computeDocumentTotals(breakdownItems, taxCategoryRates, roundingMode);
}

// Item9 Phase3: quote-crud.service.tsと同じ方針(検索・詳細取得・CRUD・承認申請/削除申請の状態遷移)
export class PurchaseRequisitionCrudService {
  private repo: PurchaseRequisitionRepository;

  constructor(repo: PurchaseRequisitionRepository) {
    this.repo = repo;
  }

  async searchRequisitions(
    c: Context,
    query: SearchPurchaseRequisitionsQuery,
    sort?: SortQuery,
  ) {
    const result = await this.repo.findRequisitions(query, sort);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_PURCHASE_REQUISITIONS_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
      }),
    );

    return await this.attachFilesToRequisitions(result);
  }

  async searchRequisitionsPage(
    c: Context,
    query: SearchPurchaseRequisitionsQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [result, total] = await Promise.all([
      this.repo.findRequisitionsPage(query, params, sort),
      this.repo.countRequisitions(query),
    ]);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_PURCHASE_REQUISITIONS_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
      }),
    );

    const data = await this.attachFilesToRequisitions(result);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  private async attachFilesToRequisitions(
    requisitions: Awaited<ReturnType<PurchaseRequisitionRepository["findRequisitions"]>>,
  ) {
    const ids = requisitions.map((r) => r.id);
    if (ids.length === 0) return [];

    const allAttachments = await this.repo.findAttachmentsByRequisitionIds(ids);
    return requisitions.map((r) => ({
      ...r,
      attachments: allAttachments.filter((att) => att.requestId === r.id),
    }));
  }

  async getRequisitionDetail(c: Context, id: string) {
    const header = await this.repo.findRequisitionById(id);
    if (!header) return null;

    const items = await this.repo.findRequisitionItems(id);
    const rawAttachments = await this.repo.findRequisitionAttachments(id);

    const baseUrl = new URL(c.req.url).origin;
    const attachments = rawAttachments.map((att) => ({
      ...att,
      downloadUrl:
        att.externalUrl ||
        (att.storageType === "R2" && att.attachmentR2Path
          ? `${baseUrl}/api/purchase-requisitions/download/${id}/${att.id}`
          : null),
    }));

    return { ...header, items, attachments };
  }

  async createRequisition(c: Context, formData: FormData, body: PurchaseRequisitionPayload) {
    await assertPartnerNotSuspended(c.env.DB, body.partnerId);
    const opId = await this.repo.getFallbackOperatorId(c);
    let requisitionId = body.id;

    if (!requisitionId) {
      const config = await getDocumentNumberFormatConfig(c, "purchase_requisition");
      requisitionId = generateFormattedCode(config);
    }

    if (await this.repo.existsRequisition(requisitionId)) {
      throw new BadRequestError("同一IDの購買申請が既に存在します");
    }

    const { totalAmount, taxAmount } = await calcAmounts(
      this.repo,
      body.items,
      body.totalAmount,
      body.taxAmount,
      await getTaxRoundingMode(c.env.COMPANY_SETTINGS),
    );
    // 見積のsalesPersonEmployeeNumber/inputPersonEmployeeNumberと同じ「明示指定優先、
    // 未指定はログイン操作者」パターン。申請者(applicantId)は既存列だが、これまでopId固定だった
    const applicantId = body.applicantId || opId;
    const inputPersonEmployeeNumber = body.inputPersonEmployeeNumber || opId;

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.insertRequisition({
      id: requisitionId,
      title: body.title,
      departmentSurrogateId: body.departmentSurrogateId,
      applicantId,
      inputPersonEmployeeNumber,
      requestType: body.requestType || "ONE_TIME",
      status: "DRAFT",
      partnerId: body.partnerId || null,
      partnerName: body.partnerName || null,
      partnerInputType: body.partnerInputType || "MASTER",
      projectId: body.projectId || null,
      totalAmount,
      taxAmount,
      memo: body.memo || null,
      createdBy: opId,
      updatedBy: opId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (body.items && Array.isArray(body.items)) {
      for (const [index, item] of body.items.entries()) {
        await tx.repo.insertRequisitionItem(
          buildPurchaseRequisitionItemInsertRow(item, requisitionId, index),
        );
      }
    }

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path: string | null = null;
        let extUrl: string | null = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (!fileObj) continue;

          r2Path = generateAttachmentKey(
            `purchase-requisitions/${requisitionId}`,
            fileObj.name,
          );
          await c.env.PURCHASE_REQUISITIONS_BUCKET.put(r2Path, fileObj.stream(), {
            httpMetadata: { contentType: fileObj.type },
          });
        } else {
          extUrl = att.externalUrl || null;
        }

        await tx.repo.insertRequisitionAttachment({
          id: crypto.randomUUID(),
          requestId: requisitionId,
          purchaseRequestItemId: null,
          fileName: att.fileName,
          storageType: att.storageType || "R2",
          attachmentR2Path: r2Path,
          externalUrl: extUrl,
          uploadedById: opId,
          uploadedAt: new Date(),
        });
      }
    }
    await tx.commit();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_PURCHASE_REQUISITION", RESOURCE_KEY, requisitionId, null, {
        id: requisitionId,
        title: body.title,
        totalAmount,
      }),
    );

    return {
      success: true,
      message: "購買申請を新規保存しました",
      id: requisitionId,
    };
  }

  async updateRequisition(
    c: Context,
    id: string,
    formData: FormData,
    body: PurchaseRequisitionPayload,
  ) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findRequisitionById(id);
    if (!oldSnapshot) throw new NotFoundError("対象の購買申請が見つかりません");

    const wfEnabled = await isPurchaseRequisitionWorkflowGloballyEnabled(
      c.env.COMPANY_SETTINGS,
    );
    if (wfEnabled) {
      if (
        oldSnapshot.status === "PENDING_APPROVAL" ||
        oldSnapshot.status === "PENDING_DELETION"
      ) {
        throw new BadRequestError("承認処理中の購買申請は編集できません");
      }
      if (oldSnapshot.status === "APPROVED") {
        throw new BadRequestError(
          "承認済みの購買申請を編集するには変更申請(/api/approvals/request-update)が必要です",
        );
      }
    }

    const { totalAmount, taxAmount } = await calcAmounts(
      this.repo,
      body.items,
      body.totalAmount,
      body.taxAmount,
      await getTaxRoundingMode(c.env.COMPANY_SETTINGS),
    );

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.updateRequisition(id, {
      title: body.title,
      departmentSurrogateId: body.departmentSurrogateId,
      requestType: body.requestType || oldSnapshot.requestType,
      status: oldSnapshot.status,
      partnerId: body.partnerId || null,
      partnerName: body.partnerName || null,
      partnerInputType: body.partnerInputType || "MASTER",
      projectId: body.projectId || null,
      applicantId: body.applicantId || oldSnapshot.applicantId,
      inputPersonEmployeeNumber:
        body.inputPersonEmployeeNumber || oldSnapshot.inputPersonEmployeeNumber || opId,
      totalAmount,
      taxAmount,
      memo: body.memo || null,
      updatedBy: opId,
      updatedAt: new Date(),
    });

    await tx.repo.deleteRequisitionItems(id);
    if (body.items && Array.isArray(body.items)) {
      for (const [index, item] of body.items.entries()) {
        await tx.repo.insertRequisitionItem(
          buildPurchaseRequisitionItemInsertRow(item, id, index),
        );
      }
    }

    const existingAttachments = await this.repo.findRequisitionAttachments(id);

    await tx.repo.deleteRequisitionAttachments(id);

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path = att.attachmentR2Path || null;
        let extUrl: string | null = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (fileObj) {
            r2Path = generateAttachmentKey(`purchase-requisitions/${id}`, fileObj.name);
            await c.env.PURCHASE_REQUISITIONS_BUCKET.put(r2Path, fileObj.stream(), {
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
          await tx.repo.insertRequisitionAttachment({
            id: crypto.randomUUID(),
            requestId: id,
            purchaseRequestItemId: null,
            fileName: att.fileName,
            storageType: att.storageType || "R2",
            attachmentR2Path: r2Path,
            externalUrl: extUrl,
            uploadedById: opId,
            uploadedAt: new Date(),
          });
        }
      }
    }
    await tx.commit();

    if (body.attachments && Array.isArray(body.attachments)) {
      await deleteOrphanedR2Attachments(
        c.env.PURCHASE_REQUISITIONS_BUCKET,
        existingAttachments,
        body.attachments.map((att: any) => att.attachmentR2Path),
      );
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_PURCHASE_REQUISITION", RESOURCE_KEY, id, oldSnapshot, {
        id,
        title: body.title,
        totalAmount,
      }),
    );

    return { success: true, message: "購買申請を更新しました" };
  }

  // 購買申請の削除(直接削除。下書き(DRAFT)のみ許可。それ以外はrequestRequisitionDeletion経由の削除申請が必要)
  async deleteRequisition(c: Context, id: string) {
    const oldSnapshot = await this.repo.findRequisitionById(id);
    if (oldSnapshot && oldSnapshot.status !== "DRAFT") {
      throw new BadRequestError("下書き以外の購買申請を削除するには削除申請が必要です");
    }
    return this.performRequisitionDeletion(c, id, oldSnapshot);
  }

  // 購買申請の物理削除本体(R2添付削除込み)。ステータスによるガードは行わない。
  // deleteRequisition(直接削除)・requestRequisitionDeletion(承認不要時)・
  // purchase-requisitions.adapter.ts(DELETE承認確定時)から呼ばれる
  async performRequisitionDeletion(c: Context, id: string, knownSnapshot?: any) {
    const oldSnapshot = knownSnapshot ?? (await this.repo.findRequisitionById(id));
    const associatedAttachments = await this.repo.findRequisitionAttachments(id);

    for (const att of associatedAttachments) {
      if (att.attachmentR2Path) {
        try {
          await c.env.PURCHASE_REQUISITIONS_BUCKET.delete(att.attachmentR2Path);
        } catch (r2Err) {
          console.error("R2 delete error during purchase requisition removal:", r2Err);
        }
      }
    }

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.deleteRequisitionItems(id);
    await tx.repo.deleteRequisitionAttachments(id);
    await tx.repo.deleteRequisition(id);
    await tx.commit();
    // 差戻しで下書きに戻った伝票の場合、残っている差戻しの申請を閉じる(BUG-015)。
    // 直接削除・削除申請(下書きは直接削除)・承認不要時・削除の承認確定の、どの経路で消しても閉じる
    await WorkflowEngine.closeRemandedRequestsOfDeletedTarget(createDb(c.env.DB), "purchase_requisitions", id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_PURCHASE_REQUISITION", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return {
      success: true,
      message: "購買申請データおよび紐づくR2添付ファイルを完全に削除しました",
    };
  }

  // 購買申請の承認申請提出(DRAFT→PENDING_APPROVAL、承認機能OFFなら直接APPROVED)
  async submitForApproval(
    c: Context,
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) {
    const requisition = await this.repo.findRequisitionById(id);
    if (!requisition) throw new NotFoundError("対象の購買申請が見つかりません");
    if (requisition.status !== "DRAFT") {
      throw new BadRequestError("下書き状態の購買申請のみ承認申請できます");
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isPurchaseRequisitionWorkflowGloballyEnabled(
      c.env.COMPANY_SETTINGS,
    );

    if (!wfEnabled) {
      await this.repo.updateRequisition(id, {
        status: "APPROVED",
        updatedBy: employeeNumber,
        updatedAt: new Date(),
      });
      c.executionCtx.waitUntil(
        logAuditEvent(c, "APPROVE_PURCHASE_REQUISITION_DIRECT", RESOURCE_KEY, id, requisition, {
          status: "APPROVED",
        }),
      );
      return {
        success: true,
        message: "承認機能が無効のため、購買申請を確定しました",
      };
    }

    await this.repo.updateRequisition(id, {
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
    // Item9 Phase2で構築した汎用マッチ機構の実利用: matchField="requestType"のフローを
    // admin側で設定すれば、購買区分(都度/定期/前払)ごとに異なる承認ルートを組める
    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: "purchase_requisitions",
      targetId: id,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: requisition.totalAmount || 0,
      comment: `購買申請[${id}]の承認申請`,
      matchPayload: { requestType: requisition.requestType },
      applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      await this.repo.updateRequisition(id, {
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
      comment: `購買申請[${id}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_PURCHASE_REQUISITION_FOR_APPROVAL", RESOURCE_KEY, id, requisition, {
        status: "PENDING_APPROVAL",
      }),
    );

    return { success: true, message: "購買申請の承認を申請しました" };
  }

  // 購買申請の削除申請(DRAFTかつ未申請なら承認不要で直接削除、APPROVEDなら削除承認申請)
  async requestRequisitionDeletion(c: Context, id: string) {
    const requisition = await this.repo.findRequisitionById(id);
    if (!requisition) throw new NotFoundError("対象の購買申請が見つかりません");

    if (requisition.status === "DRAFT") {
      return this.performRequisitionDeletion(c, id, requisition);
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isPurchaseRequisitionWorkflowGloballyEnabled(
      c.env.COMPANY_SETTINGS,
    );

    if (!wfEnabled) {
      return this.performRequisitionDeletion(c, id, requisition);
    }

    if (requisition.status !== "APPROVED") {
      throw new BadRequestError(
        "承認処理中の購買申請は削除申請できません。処理完了後に再度お試しください。",
      );
    }

    await this.repo.updateRequisition(id, {
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
      targetType: "purchase_requisitions",
      targetId: id,
      applicantId: applicantUserId,
      requestType: "DELETE",
      amount: requisition.totalAmount || 0,
      comment: `購買申請[${id}]の削除申請`,
      matchPayload: { requestType: requisition.requestType },
    }, c);

    if (!wfResult.success) {
      await this.repo.updateRequisition(id, {
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
      comment: `購買申請[${id}]の削除申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_PURCHASE_REQUISITION_DELETION", RESOURCE_KEY, id, requisition, {
        status: "PENDING_DELETION",
      }),
    );

    return { success: true, message: "購買申請の削除を申請しました" };
  }
}
