import { Context } from "hono";
import { PurchaseRecognitionRepository } from "./purchase-recognition.repository";
import { assertPurchaseOrderPartnerMatches } from "./purchase-recognition-source-partner";
import { PurchaseRecognitionPayload } from "./purchase-recognition.schema";
import { RESOURCE_KEY } from "./purchase-recognition-constants";
import {
  buildPurchaseRecognitionItemInsertRow,
  PurchaseRecognitionItemInput,
} from "./purchase-recognition-item-mapper";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { deleteOrphanedR2Attachments } from "../../../platform/r2/delete-orphaned-attachments";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { isPurchaseRecognitionWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { SearchPurchaseRecognitionsQuery } from "./purchase-recognition.schema";
import { SortQuery } from "../../../platform/http/sort";
import { deleteFromPair } from "../../../platform/r2/bucket-with-fallback";
import { ORIGINAL_REQUIRED_DOCUMENT_TYPES } from "../../../platform/documents/red-slip";
import { recalculateDocumentTotals } from "../../../platform/tax/recalculate-document-totals";
import { allocateDocumentTaxToLines, DEFAULT_TAX_ROUNDING_MODE, type TaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";
import { assertPartnerNotSuspended } from "../../../platform/partners/suspended-partner";

const NON_PURCHASE_DOCUMENT_TYPES = ["RETURN", "DISCOUNT", "CORRECTION"];
const DEFAULT_TAX_RATE = 0.1;

// Item10: sales-invoice-crud.service.tsと完全に対称な構成。仕入(purchase_recognitions)の
// 検索・詳細取得・CRUD・承認申請/削除申請の状態遷移、および確定(APPROVED)時の
// 品目連動仕訳自動転記を担当する
export class PurchaseRecognitionCrudService {
  private repo: PurchaseRecognitionRepository;

  constructor(repo: PurchaseRecognitionRepository) {
    this.repo = repo;
  }

  async searchRecognitions(c: Context, query: SearchPurchaseRecognitionsQuery, sort?: SortQuery) {
    const result = await this.repo.findRecognitions(query, sort);

    c.executionCtx.waitUntil(
      logAuditEvent(
        c,
        "SEARCH_PURCHASE_RECOGNITIONS_LIST",
        RESOURCE_KEY,
        "SEARCH_OPERATION",
        null,
        {
          searchConditions: { ...query },
          viewedRecordCount: result.length,
          matchedRecognitionIds: result.map((r) => r.id),
        },
      ),
    );

    return await this.attachFilesToRecognitions(result);
  }

  async searchRecognitionsPage(
    c: Context,
    query: SearchPurchaseRecognitionsQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [result, total] = await Promise.all([
      this.repo.findRecognitionsPage(query, params, sort),
      this.repo.countRecognitions(query),
    ]);

    c.executionCtx.waitUntil(
      logAuditEvent(
        c,
        "SEARCH_PURCHASE_RECOGNITIONS_LIST",
        RESOURCE_KEY,
        "SEARCH_OPERATION",
        null,
        {
          searchConditions: { ...query },
          viewedRecordCount: result.length,
          matchedRecognitionIds: result.map((r) => r.id),
        },
      ),
    );

    const data = await this.attachFilesToRecognitions(result);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  private async attachFilesToRecognitions(
    recognitions: Awaited<ReturnType<PurchaseRecognitionRepository["findRecognitions"]>>,
  ) {
    const recognitionIds = recognitions.map((r) => r.id);
    if (recognitionIds.length === 0) return [];

    const allAttachments = await this.repo.findAttachmentsByRecognitionIds(recognitionIds);
    return recognitions.map((rec) => ({
      ...rec,
      attachments: allAttachments.filter((att) => att.purchaseRecognitionId === rec.id),
    }));
  }

  // Item10: フロントの「発注から選択」ピッカー用。発注の各明細について、会社設定
  // (is_purchase_recognition_requires_receipt)に応じた基準数量(発注数量/入荷済数量)と
  // 既仕入済数量(APPROVED、RETURN分は減算)から残数量を計算して返す
  async getOrderRecognitionProgress(c: Context, orderId: string) {
    const order = await this.repo.findOrderById(orderId);
    if (!order) throw new NotFoundError("対象の発注が見つかりません");

    const items = await this.repo.findOrderItems(orderId);
    const itemIds = items.map((i: any) => i.id);

    const settings = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const requiresReceipt = settings.is_purchase_recognition_requires_receipt === true;

    const [receivedRows, recognizedByOrderItem] = await Promise.all([
      requiresReceipt
        ? this.repo.getReceivedQuantitiesByOrderItemIds(itemIds)
        : Promise.resolve([]),
      this.repo.getRecognizedQuantitiesByOrderItemIds(itemIds),
    ]);
    const receivedByOrderItem = new Map(
      receivedRows.map((r) => [r.orderItemId, r.receivedQuantity]),
    );

    // BUG-065: サービス品目(役務)は入荷しないため、設定に関わらず発注数量を基準にする
    const serviceItemIds = await this.repo.findServiceItemIds(items.map((item: any) => item.itemId));
    return items.map((item: any) => {
      const usesFulfilled = requiresReceipt && !serviceItemIds.has(item.itemId);
      const basisQuantity = usesFulfilled
        ? receivedByOrderItem.get(item.id) || 0
        : item.quantity;
      const recognizedQuantity = recognizedByOrderItem.get(item.id) || 0;
      return {
        sourceOrderItemId: item.id,
        itemId: item.itemId,
        itemName: item.itemName,
        inputType: item.inputType,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCode: item.unitCode,
        taxCategoryCode: item.taxCategoryCode,
        accountCode: item.accountCode,
        basisQuantity,
        recognizedQuantity,
        remainingQuantity: Math.max(basisQuantity - recognizedQuantity, 0),
        basis: usesFulfilled ? "RECEIVED" : "ORDERED",
      };
    });
  }

  async getRecognitionDetail(c: Context, id: string) {
    const header = await this.repo.findRecognitionById(id);
    if (!header) return null;

    const items = await this.repo.findRecognitionItems(id);
    const rawAttachments = await this.repo.findRecognitionAttachments(id);
    const receiptIds = await this.repo.findReceiptLinkIds(id);

    const baseUrl = new URL(c.req.url).origin;
    const attachments = rawAttachments.map((att) => {
      let downloadUrl = att.externalUrl || null;
      if (att.storageType === "R2" && att.attachmentR2Path) {
        downloadUrl = `${baseUrl}/api/purchase-recognitions/download/${id}/${att.id}`;
      }
      return { ...att, downloadUrl };
    });

    return { ...header, items, attachments, receiptIds };
  }

  // Item10: documentType(PURCHASE以外)ではoriginalRecognitionId(対象の元仕入)が必須
  private validateDocumentType(body: PurchaseRecognitionPayload) {
    const documentType = body.documentType || "PURCHASE";
    // 追加要望L-2-a: 元伝票が必須なのは返品/値引のみ。赤伝(訂正)は元伝票なしの自由入力も可
    if (ORIGINAL_REQUIRED_DOCUMENT_TYPES.includes(documentType as any) && !body.originalRecognitionId) {
      throw new BadRequestError(
        `伝票種別「${documentType}」を起票するには対象となる元仕入伝票(originalRecognitionId)の指定が必要です`,
      );
    }
    return documentType;
  }

  // Item10: 発注明細単位で仕入を起こす場合の残数量検証。会社設定
  // (is_purchase_recognition_requires_receipt)により、発注数量基準/入荷済数量基準を切り替える。
  // PURCHASE以外(返品/値引/赤伝)は数量消込の対象外とする
  private async validateRemainingQuantities(
    c: Context,
    documentType: string,
    items: PurchaseRecognitionItemInput[],
  ) {
    if (documentType !== "PURCHASE") return;

    const targetItems = items.filter((item) => !!item.sourceOrderItemId);
    if (targetItems.length === 0) return;

    const settings = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const requiresReceipt = settings.is_purchase_recognition_requires_receipt === true;

    const orderItemIds = targetItems.map((item) => item.sourceOrderItemId!);
    const [receivedRows, recognizedByOrderItem] = await Promise.all([
      requiresReceipt
        ? this.repo.getReceivedQuantitiesByOrderItemIds(orderItemIds)
        : Promise.resolve([]),
      this.repo.getRecognizedQuantitiesByOrderItemIds(orderItemIds),
    ]);
    const receivedByOrderItem = new Map(
      receivedRows.map((r) => [r.orderItemId, r.receivedQuantity]),
    );

    for (const item of targetItems) {
      const orderItemId = item.sourceOrderItemId!;
      const orderItem = await this.repo.findOrderItemById(orderItemId);
      if (!orderItem) {
        throw new NotFoundError(`発注明細が見つかりません: ${orderItemId}`);
      }

      // BUG-065: サービス品目(役務)は設定に関わらず発注数量を基準にする
      const usesFulfilled = requiresReceipt && !(await this.repo.findServiceItemIds([orderItem.itemId])).has(orderItem.itemId ?? "");
      const basisQuantity = usesFulfilled
        ? receivedByOrderItem.get(orderItemId) || 0
        : orderItem.quantity;
      const alreadyRecognized = recognizedByOrderItem.get(orderItemId) || 0;
      const remaining = basisQuantity - alreadyRecognized;

      if (item.quantity > remaining) {
        const basisLabel = usesFulfilled ? "入荷済数量" : "発注数量";
        throw new BadRequestError(
          `発注明細[${orderItemId}]の残数量(${remaining}、基準: ${basisLabel})を超えています(指定数量: ${item.quantity})`,
        );
      }
    }
  }

  // L-1-b: 対象検収の紐づけ先を検証し、保存すべきid一覧を返す(ヘッダ登録前に呼ぶ)。
  // 通常仕入(PURCHASE)のみ対象(返品/値引/赤伝は紐づけない=空)。存在しない検収は404、
  // 取引先が仕入先と異なる検収は400。receiptIds未指定(undefined)は「変更なし」としてundefinedを返す
  // (更新時は既存の紐づけを維持する)
  private async resolveReceiptLinkIds(
    documentType: string,
    partnerId: string | null,
    receiptIds: string[] | undefined,
  ): Promise<string[] | undefined> {
    if (receiptIds === undefined) return undefined;
    const uniqueIds = documentType === "PURCHASE" ? [...new Set(receiptIds)] : [];
    if (uniqueIds.length === 0) return [];

    const receipts = await this.repo.findItemReceiptsByIds(uniqueIds);
    if (receipts.length !== uniqueIds.length) {
      throw new NotFoundError("指定された検収記録の一部が見つかりません");
    }
    for (const receipt of receipts) {
      if (receipt.partnerId && partnerId && receipt.partnerId !== partnerId) {
        throw new BadRequestError(`検収記録[${receipt.id}]の取引先が仕入の取引先と一致しません`);
      }
    }
    return uniqueIds;
  }

  async createRecognition(c: Context, formData: FormData, body: PurchaseRecognitionPayload) {
    await assertPartnerNotSuspended(c.env.DB, body.partnerId || (body as any).supplierId || null);
    // BUG-042: 保存する合計・消費税は、明細から計算し直す(会社設定の端数処理。画面の計算は表示用)
    body = await recalculateDocumentTotals(c.env.COMPANY_SETTINGS, body, await this.repo.findTaxCategoryRates());
    const documentType = this.validateDocumentType(body);
    const items = (body.items || []) as PurchaseRecognitionItemInput[];
    await this.validateRemainingQuantities(c, documentType, items);
    await assertPurchaseOrderPartnerMatches(
      this.repo,
      body.partnerId || (body as any).supplierId || null,
      body.orderId,
      items.map((item) => item.sourceOrderItemId),
    );

    const opId = await this.repo.getFallbackOperatorId(c);
    let recognitionId = body.id;

    if (!recognitionId) {
      recognitionId = await resolveConfiguredDocumentId(
        c,
        "purchase_recognition",
        (id) => this.repo.existsRecognition(id),
        null,
      );
    } else if (await this.repo.existsRecognition(recognitionId)) {
      throw new BadRequestError(`仕入番号[${recognitionId}]は既に使用されています`);
    }

    const targetPartnerId = body.partnerId || (body as any).supplierId || null;
    const targetDepartment = body.companyDepartment || body.company_department || null;
    const targetPurchasePersonEmployeeNumber = body.purchasePersonEmployeeNumber || null;
    const targetInputPersonEmployeeNumber = body.inputPersonEmployeeNumber || opId;
    const receiptLinkIds = await this.resolveReceiptLinkIds(
      documentType,
      targetPartnerId,
      body.receiptIds,
    );

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.insertRecognition({
      id: recognitionId,
      title: body.title || null,
      partnerId: targetPartnerId,
      orderId: body.orderId || null,
      recognitionDate: new Date(body.recognitionDate),
      status: "DRAFT",
      documentType,
      originalRecognitionId: body.originalRecognitionId || null,
      totalAmount: body.totalAmount || 0,
      taxAmount: body.taxAmount || 0,
      memo: body.memo || null,
      purchasePersonEmployeeNumber: targetPurchasePersonEmployeeNumber,
      inputPersonEmployeeNumber: targetInputPersonEmployeeNumber,
      companyName: body.companyName || null,
      companyDepartment: targetDepartment || null,
      companyAddress: body.companyAddress || null,
      companyTel: body.companyTel || null,
      companyFax: body.companyFax || null,
      paymentTerms: body.paymentTerms || null,
      projectId: body.projectId || null,
      paymentStatus: "UNPAID",
      createdBy: opId,
      updatedBy: opId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    for (const [index, item] of items.entries()) {
      await tx.repo.insertRecognitionItem(
        buildPurchaseRecognitionItemInsertRow(item, recognitionId, index),
      );
    }

    if (receiptLinkIds !== undefined) {
      await tx.repo.replaceReceiptLinks(recognitionId, receiptLinkIds);
    }

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path = null;
        let extUrl = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (fileObj) {
            r2Path = generateAttachmentKey(`purchase-recognitions/${recognitionId}`, fileObj.name);
            await c.env.PURCHASE_RECOGNITIONS_BUCKET.put(r2Path, fileObj.stream(), {
              httpMetadata: { contentType: fileObj.type },
            });
          }
        } else {
          extUrl = att.externalUrl || null;
        }

        await tx.repo.insertRecognitionAttachment({
          id: crypto.randomUUID(),
          purchaseRecognitionId: recognitionId,
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
      logAuditEvent(c, "CREATE_PURCHASE_RECOGNITION", RESOURCE_KEY, recognitionId, null, {
        id: recognitionId,
        partnerId: targetPartnerId,
        totalAmount: body.totalAmount,
        documentType,
      }),
    );

    return { success: true, message: "仕入情報を新規保存しました", id: recognitionId };
  }

  async updateRecognition(
    c: Context,
    id: string,
    formData: FormData,
    body: PurchaseRecognitionPayload,
  ) {
    // BUG-042: 保存する合計・消費税は、明細から計算し直す(会社設定の端数処理。画面の計算は表示用)
    body = await recalculateDocumentTotals(c.env.COMPANY_SETTINGS, body, await this.repo.findTaxCategoryRates());
    const oldSnapshot = await this.repo.findRecognitionById(id);
    if (!oldSnapshot) throw new NotFoundError("対象の仕入が見つかりません");

    const wfEnabled = await isPurchaseRecognitionWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);
    if (wfEnabled) {
      if (
        oldSnapshot.status === "PENDING_APPROVAL" ||
        oldSnapshot.status === "PENDING_DELETION"
      ) {
        throw new BadRequestError("承認処理中の仕入は編集できません");
      }
      if (oldSnapshot.status === "APPROVED") {
        throw new BadRequestError(
          "承認済みの仕入を編集するには変更申請(/api/approvals/request-update)が必要です",
        );
      }
    }

    const documentType = this.validateDocumentType(body);
    const items = (body.items || []) as PurchaseRecognitionItemInput[];
    await this.validateRemainingQuantities(c, documentType, items);
    await assertPurchaseOrderPartnerMatches(
      this.repo,
      body.partnerId || (body as any).supplierId || null,
      body.orderId,
      items.map((item) => item.sourceOrderItemId),
    );

    const opId = await this.repo.getFallbackOperatorId(c);
    const targetPartnerId = body.partnerId || (body as any).supplierId || null;
    const targetDepartment = body.companyDepartment || body.company_department || null;
    const targetPurchasePersonEmployeeNumber = body.purchasePersonEmployeeNumber || null;
    const targetInputPersonEmployeeNumber =
      body.inputPersonEmployeeNumber || oldSnapshot.inputPersonEmployeeNumber || opId;
    const receiptLinkIds = await this.resolveReceiptLinkIds(
      documentType,
      targetPartnerId,
      body.receiptIds,
    );

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.updateRecognition(id, {
      title: body.title || null,
      partnerId: targetPartnerId,
      orderId: body.orderId || null,
      recognitionDate: new Date(body.recognitionDate),
      status: body.status || oldSnapshot.status || "DRAFT",
      documentType,
      originalRecognitionId: body.originalRecognitionId || null,
      totalAmount: body.totalAmount || 0,
      taxAmount: body.taxAmount || 0,
      memo: body.memo || null,
      purchasePersonEmployeeNumber: targetPurchasePersonEmployeeNumber,
      inputPersonEmployeeNumber: targetInputPersonEmployeeNumber,
      companyName: body.companyName || null,
      companyDepartment: targetDepartment,
      companyAddress: body.companyAddress || null,
      companyTel: body.companyTel || null,
      companyFax: body.companyFax || null,
      paymentTerms: body.paymentTerms || null,
      projectId: body.projectId ?? oldSnapshot.projectId ?? null,
      updatedBy: opId,
      updatedAt: new Date(),
    });

    await tx.repo.deleteRecognitionItems(id);
    for (const [index, item] of items.entries()) {
      await tx.repo.insertRecognitionItem(
        buildPurchaseRecognitionItemInsertRow(item, id, index),
      );
    }

    if (receiptLinkIds !== undefined) {
      await tx.repo.replaceReceiptLinks(id, receiptLinkIds);
    }

    const existingAttachments = await this.repo.findRecognitionAttachments(id);

    await tx.repo.deleteRecognitionAttachments(id);

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path = att.attachmentR2Path || null;
        let extUrl = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (fileObj) {
            r2Path = generateAttachmentKey(`purchase-recognitions/${id}`, fileObj.name);
            await c.env.PURCHASE_RECOGNITIONS_BUCKET.put(r2Path, fileObj.stream(), {
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
          await tx.repo.insertRecognitionAttachment({
            id: crypto.randomUUID(),
            purchaseRecognitionId: id,
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
      purchaseRecognitionId: id,
      version: 1,
      action: "UPDATE",
      snapshotData: JSON.stringify({
        header: {
          ...oldSnapshot,
          recognitionDate: oldSnapshot.recognitionDate
            ? new Date(oldSnapshot.recognitionDate).toISOString()
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
        c.env.PURCHASE_RECOGNITIONS_BUCKET,
        existingAttachments,
        body.attachments.map((att: any) => att.attachmentR2Path),
        c.env.QUATES_BUCKET,
      );
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_PURCHASE_RECOGNITION", RESOURCE_KEY, id, oldSnapshot, {
        id,
        partnerId: targetPartnerId,
        totalAmount: body.totalAmount,
      }),
    );

    return { success: true, message: "仕入情報を更新しました" };
  }

  async deleteRecognition(c: Context, id: string) {
    const oldSnapshot = await this.repo.findRecognitionById(id);
    if (oldSnapshot && oldSnapshot.status !== "DRAFT") {
      throw new BadRequestError("下書き以外の仕入を削除するには削除申請が必要です");
    }
    return this.performRecognitionDeletion(c, id, oldSnapshot);
  }

  async performRecognitionDeletion(c: Context, id: string, knownSnapshot?: any) {
    const oldSnapshot = knownSnapshot ?? (await this.repo.findRecognitionById(id));
    const associatedAttachments = await this.repo.findRecognitionAttachments(id);

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.deleteRecognitionItems(id);
    await tx.repo.deleteRecognitionAttachments(id);
    await tx.repo.deleteRecognition(id);
    await tx.commit();

    for (const att of associatedAttachments) {
      if (att.storageType === "R2" && att.attachmentR2Path) {
        try {
          await deleteFromPair({ primary: c.env.PURCHASE_RECOGNITIONS_BUCKET, legacy: c.env.QUATES_BUCKET }, att.attachmentR2Path);
        } catch (r2Err) {
          console.error("R2 delete error during purchase recognition removal:", r2Err);
        }
      }
    }
    // 差戻しで下書きに戻った伝票の場合、残っている差戻しの申請を閉じる(BUG-015)。
    // 直接削除・削除申請(下書きは直接削除)・承認不要時・削除の承認確定の、どの経路で消しても閉じる
    await WorkflowEngine.closeRemandedRequestsOfDeletedTarget(createDb(c.env.DB), "purchase_recognitions", id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_PURCHASE_RECOGNITION", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return {
      success: true,
      message: "仕入データおよび紐づくR2添付ファイルを完全に削除しました",
    };
  }

  // 仕訳の材料(明細の行・借貸を反転する区分か・発注の前払による充当額)を集める。
  // 「伝票を選んで仕訳を作る」(V-4。routes/admin/journal-sources/document-posting.ts)が使う。
  // 仕訳は承認確定時には自動転記しない(選択して作成する)
  async buildJournalInput(recognitionId: string, roundingMode: TaxRoundingMode = DEFAULT_TAX_ROUNDING_MODE) {
    const recognition = await this.repo.findRecognitionById(recognitionId);
    if (!recognition) return null;

    const items = await this.repo.findRecognitionItems(recognitionId);
    if (items.length === 0) return null;

    const [accountCodes, taxCategoryRates] = await Promise.all([
      this.repo.findItemAccountCodes(items.map((i) => i.itemId).filter((id): id is string => !!id)),
      this.repo.findTaxCategoryRates(),
    ]);

    // 追加要望L-2-a: 返品は金額を正のまま、借貸を反転して起票する(reverse)。
    // V-4: 値引・赤伝(訂正)も売上側と同じく借貸を反転する
    const isReverse = recognition.documentType !== "PURCHASE";
    // BUG-042: 明細ごとに端数処理せず、伝票の消費税(税率ごとに1回)を明細に割り振る。合計は伝票の消費税と必ず一致させる
    const rateOf = (code: string | null) =>
      code ? (taxCategoryRates.get(code) ?? DEFAULT_TAX_RATE) : DEFAULT_TAX_RATE;
    const lineTaxes = allocateDocumentTaxToLines(
      items.map((item) => ({ amount: item.amount, rate: rateOf(item.taxCategoryCode) })),
      roundingMode,
      recognition.taxAmount || 0,
    );
    const lines = items.map((item, index) => {
      const rate = rateOf(item.taxCategoryCode);
      const amount = item.amount;
      const taxAmount = lineTaxes[index];
      return {
        itemId: item.itemId,
        itemName: item.itemName || "",
        // K-2-b: 明細で個別に指定された勘定科目があれば品目マスタの科目より優先する
        itemAccountCode:
          item.accountCode || (item.itemId ? accountCodes.get(item.itemId) || null : null),
        amount,
        taxCategoryCode: item.taxCategoryCode,
        taxRate: rate,
        taxAmount,
        sourceRefItemId: item.id,
      };
    });

    // 発注がisPaid=trueの場合、前渡金充当額として今回の仕入金額(税込)全額を渡す
    // (前渡金額の内訳管理は本Phaseのスコープ外のため、全額前渡済みの発注を前提とした簡易対応)
    let advanceAppliedAmount = 0;
    if (recognition.orderId) {
      const order = await this.repo.findOrderById(recognition.orderId);
      if (order?.isPaid) {
        advanceAppliedAmount = recognition.totalAmount; // BUG-047: totalAmount は税込
      }
    }

    return { recognition, lines, isReverse, advanceAppliedAmount };
  }

  async submitForApproval(
    c: Context,
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) {
    const recognition = await this.repo.findRecognitionById(id);
    if (!recognition) throw new NotFoundError("対象の仕入が見つかりません");
    if (recognition.status !== "DRAFT") {
      throw new BadRequestError("下書き状態の仕入のみ承認申請できます");
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isPurchaseRecognitionWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateRecognition(id, {
        status: "APPROVED",
        updatedBy: employeeNumber,
        updatedAt: new Date(),
      });
      c.executionCtx.waitUntil(
        logAuditEvent(c, "APPROVE_PURCHASE_RECOGNITION_DIRECT", RESOURCE_KEY, id, recognition, {
          status: "APPROVED",
        }),
      );
      return { success: true, message: "承認機能が無効のため、仕入を確定しました" };
    }

    await this.repo.updateRecognition(id, {
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
    const wfResult = await WorkflowEngine.startWorkflow(
      db,
      {
        targetType: "purchase_recognitions",
        targetId: id,
        applicantId: applicantUserId,
        requestType: "REGISTER",
        amount: recognition.totalAmount || 0,
        comment: `仕入[${id}]の承認申請`,
        applicantDepartmentSurrogateId,
      },
      c,
    );

    if (!wfResult.success) {
      await this.repo.updateRecognition(id, {
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
      comment: `仕入[${id}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_PURCHASE_RECOGNITION_FOR_APPROVAL", RESOURCE_KEY, id, recognition, {
        status: "PENDING_APPROVAL",
      }),
    );

    return { success: true, message: "仕入の承認を申請しました" };
  }

  async requestRecognitionDeletion(c: Context, id: string) {
    const recognition = await this.repo.findRecognitionById(id);
    if (!recognition) throw new NotFoundError("対象の仕入が見つかりません");

    if (recognition.status === "DRAFT") {
      return this.performRecognitionDeletion(c, id, recognition);
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isPurchaseRecognitionWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      return this.performRecognitionDeletion(c, id, recognition);
    }

    if (recognition.status !== "APPROVED") {
      throw new BadRequestError(
        "承認処理中の仕入は削除申請できません。処理完了後に再度お試しください。",
      );
    }

    await this.repo.updateRecognition(id, {
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
    const wfResult = await WorkflowEngine.startWorkflow(
      db,
      {
        targetType: "purchase_recognitions",
        targetId: id,
        applicantId: applicantUserId,
        requestType: "DELETE",
        amount: recognition.totalAmount || 0,
        comment: `仕入[${id}]の削除申請`,
      },
      c,
    );

    if (!wfResult.success) {
      await this.repo.updateRecognition(id, {
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
      comment: `仕入[${id}]の削除申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_PURCHASE_RECOGNITION_DELETION", RESOURCE_KEY, id, recognition, {
        status: "PENDING_DELETION",
      }),
    );

    return { success: true, message: "仕入の削除を申請しました" };
  }
}
