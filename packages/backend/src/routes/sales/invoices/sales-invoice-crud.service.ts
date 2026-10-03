import { Context } from "hono";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { SalesInvoicePayload } from "./sales-invoice.schema";
import { RESOURCE_KEY } from "./sales-invoice-constants";
import { assertSalesOrderPartnerMatches } from "./sales-invoice-source-partner";
import {
  buildSalesInvoiceItemInsertRow,
  SalesInvoiceItemInput,
} from "./sales-invoice-item-mapper";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { deleteOrphanedR2Attachments } from "../../../platform/r2/delete-orphaned-attachments";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { isSalesInvoiceWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { SearchSalesInvoicesQuery } from "./sales-invoice.schema";
import { SortQuery } from "../../../platform/http/sort";
import { deleteFromPair } from "../../../platform/r2/bucket-with-fallback";
import { ORIGINAL_REQUIRED_DOCUMENT_TYPES } from "../../../platform/documents/red-slip";
import { recalculateDocumentTotals } from "../../../platform/tax/recalculate-document-totals";
import { allocateDocumentTaxToLines, DEFAULT_TAX_ROUNDING_MODE, type TaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";
import { assertPartnerNotSuspended } from "../../../platform/partners/suspended-partner";

const NON_SALE_DOCUMENT_TYPES = ["RETURN", "DISCOUNT", "CORRECTION"];
const DEFAULT_TAX_RATE = 0.1;

// Item8: quote-crud.service.tsと同じ構成。売上(sales_invoices)の検索・詳細取得・CRUD・
// 承認申請/削除申請の状態遷移、および確定(APPROVED)時の品目連動仕訳自動転記を担当する
export class SalesInvoiceCrudService {
  private repo: SalesInvoiceRepository;

  constructor(repo: SalesInvoiceRepository) {
    this.repo = repo;
  }

  async searchInvoices(c: Context, query: SearchSalesInvoicesQuery, sort?: SortQuery) {
    const result = await this.repo.findInvoices(query, sort);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_SALES_INVOICES_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
        matchedInvoiceIds: result.map((r) => r.id),
      }),
    );

    return await this.attachFilesToInvoices(result);
  }

  async searchInvoicesPage(
    c: Context,
    query: SearchSalesInvoicesQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [result, total] = await Promise.all([
      this.repo.findInvoicesPage(query, params, sort),
      this.repo.countInvoices(query),
    ]);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_SALES_INVOICES_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
        matchedInvoiceIds: result.map((r) => r.id),
      }),
    );

    const data = await this.attachFilesToInvoices(result);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  private async attachFilesToInvoices(
    invoices: Awaited<ReturnType<SalesInvoiceRepository["findInvoices"]>>,
  ) {
    const invoiceIds = invoices.map((i) => i.id);
    if (invoiceIds.length === 0) return [];

    const allAttachments = await this.repo.findAttachmentsByInvoiceIds(invoiceIds);
    return invoices.map((inv) => ({
      ...inv,
      attachments: allAttachments.filter((att) => att.salesInvoiceId === inv.id),
    }));
  }

  // Item8: フロントの「受注から選択」ピッカー用。受注の各明細について、会社設定
  // (is_sales_invoice_requires_shipment)に応じた基準数量(受注数量/出荷済数量)と
  // 既売上済数量(APPROVED、RETURN分は減算)から残数量を計算して返す
  async getOrderInvoiceProgress(c: Context, salesOrderId: string) {
    const order = await this.repo.findSalesOrderById(salesOrderId);
    if (!order) throw new NotFoundError("対象の受注が見つかりません");

    const items = await this.repo.findSalesOrderItems(salesOrderId);
    const itemIds = items.map((i: any) => i.id);

    const settings = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const requiresShipment = settings.is_sales_invoice_requires_shipment === true;

    const [shippedRows, invoicedByOrderItem] = await Promise.all([
      requiresShipment
        ? this.repo.getShippedQuantitiesByOrderItemIds(itemIds)
        : Promise.resolve([]),
      this.repo.getInvoicedQuantitiesByOrderItemIds(itemIds),
    ]);
    const shippedByOrderItem = new Map(
      shippedRows.map((r) => [r.salesOrderItemId, r.shippedQuantity]),
    );

    // BUG-065: サービス品目(役務)は出荷しないため、設定に関わらず受注数量を基準にする
    const serviceItemIds = await this.repo.findServiceItemIds(items.map((item: any) => item.itemId));
    return items.map((item: any) => {
      const usesFulfilled = requiresShipment && !serviceItemIds.has(item.itemId);
      const basisQuantity = usesFulfilled
        ? shippedByOrderItem.get(item.id) || 0
        : item.quantity;
      const invoicedQuantity = invoicedByOrderItem.get(item.id) || 0;
      return {
        salesOrderItemId: item.id,
        itemId: item.itemId,
        itemName: item.itemName,
        inputType: item.inputType,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCode: item.unitCode,
        taxCategoryCode: item.taxCategoryCode,
        accountCode: item.accountCode,
        basisQuantity,
        invoicedQuantity,
        remainingQuantity: Math.max(basisQuantity - invoicedQuantity, 0),
        basis: usesFulfilled ? "SHIPPED" : "ORDERED",
      };
    });
  }

  async getInvoiceDetail(c: Context, id: string) {
    const header = await this.repo.findInvoiceById(id);
    if (!header) return null;

    const items = await this.repo.findInvoiceItems(id);
    const rawAttachments = await this.repo.findInvoiceAttachments(id);

    const baseUrl = new URL(c.req.url).origin;
    const attachments = rawAttachments.map((att) => {
      let downloadUrl = att.externalUrl || null;
      if (att.storageType === "R2" && att.attachmentR2Path) {
        downloadUrl = `${baseUrl}/api/sales-invoices/download/${id}/${att.id}`;
      }
      return { ...att, downloadUrl };
    });

    return { ...header, items, attachments };
  }

  // Item8: documentType(SALE以外)ではoriginalInvoiceId(対象の元売上)が必須
  private validateDocumentType(body: SalesInvoicePayload) {
    const documentType = body.documentType || "SALE";
    // 追加要望L-2-a: 元伝票が必須なのは返品/値引のみ。赤伝(訂正)は元伝票なしの自由入力も可
    if (ORIGINAL_REQUIRED_DOCUMENT_TYPES.includes(documentType as any) && !body.originalInvoiceId) {
      throw new BadRequestError(
        `伝票種別「${documentType}」を起票するには対象となる元の売上(originalInvoiceId)の指定が必要です`,
      );
    }
    return documentType;
  }

  // Item8: 受注明細単位で売上を起こす場合の残数量検証。会社設定
  // (is_sales_invoice_requires_shipment)により、受注数量基準/出荷済数量基準を切り替える。
  // SALE以外(返品/値引/赤伝)は数量消込の対象外とする
  private async validateRemainingQuantities(
    c: Context,
    documentType: string,
    items: SalesInvoiceItemInput[],
  ) {
    if (documentType !== "SALE") return;

    const targetItems = items.filter((item) => !!item.sourceOrderItemId);
    if (targetItems.length === 0) return;

    const settings = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
    const requiresShipment = settings.is_sales_invoice_requires_shipment === true;

    const orderItemIds = targetItems.map((item) => item.sourceOrderItemId!);
    const [shippedRows, invoicedByOrderItem] = await Promise.all([
      requiresShipment
        ? this.repo.getShippedQuantitiesByOrderItemIds(orderItemIds)
        : Promise.resolve([]),
      this.repo.getInvoicedQuantitiesByOrderItemIds(orderItemIds),
    ]);
    const shippedByOrderItem = new Map(
      shippedRows.map((r) => [r.salesOrderItemId, r.shippedQuantity]),
    );

    for (const item of targetItems) {
      const orderItemId = item.sourceOrderItemId!;
      const orderItem = await this.repo.findSalesOrderItemById(orderItemId);
      if (!orderItem) {
        throw new NotFoundError(`受注明細が見つかりません: ${orderItemId}`);
      }

      // BUG-065: サービス品目(役務)は設定に関わらず受注数量を基準にする
      const usesFulfilled = requiresShipment && !(await this.repo.findServiceItemIds([orderItem.itemId])).has(orderItem.itemId ?? "");
      const basisQuantity = usesFulfilled
        ? shippedByOrderItem.get(orderItemId) || 0
        : orderItem.quantity;
      const alreadyInvoiced = invoicedByOrderItem.get(orderItemId) || 0;
      const remaining = basisQuantity - alreadyInvoiced;

      if (item.quantity > remaining) {
        const basisLabel = usesFulfilled ? "出荷済数量" : "受注数量";
        throw new BadRequestError(
          `受注明細[${orderItemId}]の残数量(${remaining}、基準: ${basisLabel})を超えています(指定数量: ${item.quantity})`,
        );
      }
    }
  }

  async createInvoice(c: Context, formData: FormData, body: SalesInvoicePayload) {
    await assertPartnerNotSuspended(c.env.DB, body.partnerId || (body as any).customerId || null);
    // BUG-042: 保存する合計・消費税は、明細から計算し直す(会社設定の端数処理。画面の計算は表示用)
    body = await recalculateDocumentTotals(c.env.COMPANY_SETTINGS, body, await this.repo.findTaxCategoryRates());
    const documentType = this.validateDocumentType(body);
    const items = (body.items || []) as SalesInvoiceItemInput[];
    await this.validateRemainingQuantities(c, documentType, items);
    await assertSalesOrderPartnerMatches(
      this.repo,
      body.partnerId || (body as any).customerId || null,
      body.salesOrderId,
      items.map((item) => item.sourceOrderItemId),
    );

    const opId = await this.repo.getFallbackOperatorId(c);
    let invoiceId = body.id;

    if (!invoiceId) {
      invoiceId = await resolveConfiguredDocumentId(
        c,
        "sales_invoice",
        (id) => this.repo.existsInvoice(id),
        null,
      );
    } else if (await this.repo.existsInvoice(invoiceId)) {
      throw new BadRequestError(`売上番号[${invoiceId}]は既に使用されています`);
    }

    const targetPartnerId = body.partnerId || (body as any).customerId || null;
    const targetDepartment = body.companyDepartment || body.company_department || null;
    const targetSalesPersonEmployeeNumber = body.salesPersonEmployeeNumber || null;
    const targetInputPersonEmployeeNumber = body.inputPersonEmployeeNumber || opId;

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.insertInvoice({
      id: invoiceId,
      title: body.title || null,
      partnerId: targetPartnerId,
      salesOrderId: body.salesOrderId || null,
      invoiceDate: new Date(body.invoiceDate),
      status: "DRAFT",
      documentType,
      originalInvoiceId: body.originalInvoiceId || null,
      totalAmount: body.totalAmount || 0,
      taxAmount: body.taxAmount || 0,
      memo: body.memo || null,
      salesPersonEmployeeNumber: targetSalesPersonEmployeeNumber,
      inputPersonEmployeeNumber: targetInputPersonEmployeeNumber,
      companyName: body.companyName || null,
      companyDepartment: targetDepartment || null,
      companyAddress: body.companyAddress || null,
      companyTel: body.companyTel || null,
      companyFax: body.companyFax || null,
      paymentTerms: body.paymentTerms || null,
      projectId: body.projectId || null,
      billingStatus: "UNBILLED",
      createdBy: opId,
      updatedBy: opId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    for (const [index, item] of items.entries()) {
      await tx.repo.insertInvoiceItem(
        buildSalesInvoiceItemInsertRow(item, invoiceId, index),
      );
    }

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path = null;
        let extUrl = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (fileObj) {
            r2Path = generateAttachmentKey(`sales-invoices/${invoiceId}`, fileObj.name);
            await c.env.SALES_INVOICES_BUCKET.put(r2Path, fileObj.stream(), {
              httpMetadata: { contentType: fileObj.type },
            });
          }
        } else {
          extUrl = att.externalUrl || null;
        }

        await tx.repo.insertInvoiceAttachment({
          id: crypto.randomUUID(),
          salesInvoiceId: invoiceId,
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
      logAuditEvent(c, "CREATE_SALES_INVOICE", RESOURCE_KEY, invoiceId, null, {
        id: invoiceId,
        partnerId: targetPartnerId,
        totalAmount: body.totalAmount,
        documentType,
      }),
    );

    return { success: true, message: "売上情報を新規保存しました", id: invoiceId };
  }

  async updateInvoice(c: Context, id: string, formData: FormData, body: SalesInvoicePayload) {
    // BUG-042: 保存する合計・消費税は、明細から計算し直す(会社設定の端数処理。画面の計算は表示用)
    body = await recalculateDocumentTotals(c.env.COMPANY_SETTINGS, body, await this.repo.findTaxCategoryRates());
    const oldSnapshot = await this.repo.findInvoiceById(id);
    if (!oldSnapshot) throw new NotFoundError("対象の売上が見つかりません");

    // 請求明細は作成時点の金額をスナップショットとして持つため、請求済みの売上を編集すると
    // 請求書の金額と食い違う。承認機能のON/OFFに関わらず編集不可とする
    if (oldSnapshot.billingStatus === "BILLED") {
      throw new BadRequestError(
        "請求済みの売上は編集できません。請求を削除して未請求に戻すか、赤伝で訂正してください",
      );
    }

    const wfEnabled = await isSalesInvoiceWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);
    if (wfEnabled) {
      if (
        oldSnapshot.status === "PENDING_APPROVAL" ||
        oldSnapshot.status === "PENDING_DELETION"
      ) {
        throw new BadRequestError("承認処理中の売上は編集できません");
      }
      if (oldSnapshot.status === "APPROVED") {
        throw new BadRequestError(
          "承認済みの売上を編集するには変更申請(/api/approvals/request-update)が必要です",
        );
      }
    }

    const documentType = this.validateDocumentType(body);
    const items = (body.items || []) as SalesInvoiceItemInput[];
    await this.validateRemainingQuantities(c, documentType, items);
    await assertSalesOrderPartnerMatches(
      this.repo,
      body.partnerId || (body as any).customerId || null,
      body.salesOrderId,
      items.map((item) => item.sourceOrderItemId),
    );

    const opId = await this.repo.getFallbackOperatorId(c);
    const targetPartnerId = body.partnerId || (body as any).customerId || null;
    const targetDepartment = body.companyDepartment || body.company_department || null;
    const targetSalesPersonEmployeeNumber = body.salesPersonEmployeeNumber || null;
    const targetInputPersonEmployeeNumber =
      body.inputPersonEmployeeNumber || oldSnapshot.inputPersonEmployeeNumber || opId;

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.updateInvoice(id, {
      title: body.title || null,
      partnerId: targetPartnerId,
      salesOrderId: body.salesOrderId || null,
      invoiceDate: new Date(body.invoiceDate),
      status: body.status || oldSnapshot.status || "DRAFT",
      documentType,
      originalInvoiceId: body.originalInvoiceId || null,
      totalAmount: body.totalAmount || 0,
      taxAmount: body.taxAmount || 0,
      memo: body.memo || null,
      salesPersonEmployeeNumber: targetSalesPersonEmployeeNumber,
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

    await tx.repo.deleteInvoiceItems(id);
    for (const [index, item] of items.entries()) {
      await tx.repo.insertInvoiceItem(buildSalesInvoiceItemInsertRow(item, id, index));
    }

    const existingAttachments = await this.repo.findInvoiceAttachments(id);

    await tx.repo.deleteInvoiceAttachments(id);

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path = att.attachmentR2Path || null;
        let extUrl = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (fileObj) {
            r2Path = generateAttachmentKey(`sales-invoices/${id}`, fileObj.name);
            await c.env.SALES_INVOICES_BUCKET.put(r2Path, fileObj.stream(), {
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
          await tx.repo.insertInvoiceAttachment({
            id: crypto.randomUUID(),
            salesInvoiceId: id,
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
      salesInvoiceId: id,
      version: 1,
      action: "UPDATE",
      snapshotData: JSON.stringify({
        header: {
          ...oldSnapshot,
          invoiceDate: oldSnapshot.invoiceDate
            ? new Date(oldSnapshot.invoiceDate).toISOString()
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
        c.env.SALES_INVOICES_BUCKET,
        existingAttachments,
        body.attachments.map((att: any) => att.attachmentR2Path),
        c.env.QUATES_BUCKET,
      );
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_SALES_INVOICE", RESOURCE_KEY, id, oldSnapshot, {
        id,
        partnerId: targetPartnerId,
        totalAmount: body.totalAmount,
      }),
    );

    return { success: true, message: "売上情報を更新しました" };
  }

  async deleteInvoice(c: Context, id: string) {
    const oldSnapshot = await this.repo.findInvoiceById(id);
    if (oldSnapshot && oldSnapshot.status !== "DRAFT") {
      throw new BadRequestError("下書き以外の売上を削除するには削除申請が必要です");
    }
    return this.performInvoiceDeletion(c, id, oldSnapshot);
  }

  async performInvoiceDeletion(c: Context, id: string, knownSnapshot?: any) {
    const oldSnapshot = knownSnapshot ?? (await this.repo.findInvoiceById(id));
    const associatedAttachments = await this.repo.findInvoiceAttachments(id);

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.deleteInvoiceItems(id);
    await tx.repo.deleteInvoiceAttachments(id);
    await tx.repo.deleteInvoice(id);
    await tx.commit();

    for (const att of associatedAttachments) {
      if (att.storageType === "R2" && att.attachmentR2Path) {
        try {
          await deleteFromPair({ primary: c.env.SALES_INVOICES_BUCKET, legacy: c.env.QUATES_BUCKET }, att.attachmentR2Path);
        } catch (r2Err) {
          console.error("R2 delete error during sales invoice removal:", r2Err);
        }
      }
    }
    // 差戻しで下書きに戻った伝票の場合、残っている差戻しの申請を閉じる(BUG-015)。
    // 直接削除・削除申請(下書きは直接削除)・承認不要時・削除の承認確定の、どの経路で消しても閉じる
    await WorkflowEngine.closeRemandedRequestsOfDeletedTarget(createDb(c.env.DB), "sales_invoices", id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_SALES_INVOICE", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return {
      success: true,
      message: "売上データおよび紐づくR2添付ファイルを完全に削除しました",
    };
  }

  // 仕訳の材料(明細の行・借貸を反転する区分か・受注の前受による充当額)を集める。
  // 「伝票を選んで仕訳を作る」(V-4。routes/admin/journal-sources/document-posting.ts)が使う。
  // 仕訳は承認確定時には自動転記しない(選択して作成する)
  async buildJournalInput(invoiceId: string, roundingMode: TaxRoundingMode = DEFAULT_TAX_ROUNDING_MODE) {
    const invoice = await this.repo.findInvoiceById(invoiceId);
    if (!invoice) return null;

    const items = await this.repo.findInvoiceItems(invoiceId);
    if (items.length === 0) return null;

    const [accountCodes, taxCategoryRates] = await Promise.all([
      this.repo.findItemAccountCodes(items.map((i) => i.itemId).filter((id): id is string => !!id)),
      this.repo.findTaxCategoryRates(),
    ]);

    // 追加要望L-2-a: 返品は金額を正のまま、借貸を反転して起票する(reverse)。
    // V-4: 値引(DISCOUNT)・赤伝(訂正)(CORRECTION)も返品と同じく借貸を反転する(ユーザー確認済み、2026-09-22)
    const isReverse = invoice.documentType !== "SALE";
    // BUG-042: 明細ごとに端数処理せず、伝票の消費税(税率ごとに1回)を明細に割り振る。合計は伝票の消費税と必ず一致させる
    const rateOf = (code: string | null) =>
      code ? (taxCategoryRates.get(code) ?? DEFAULT_TAX_RATE) : DEFAULT_TAX_RATE;
    const lineTaxes = allocateDocumentTaxToLines(
      items.map((item) => ({ amount: item.amount, rate: rateOf(item.taxCategoryCode) })),
      roundingMode,
      invoice.taxAmount || 0,
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

    // 受注がisPrepaid=trueの場合、前受金充当額として今回の売上金額(税込)全額を渡す
    // (前受金額の内訳管理は本Phaseのスコープ外のため、全額前受済みの受注を前提とした簡易対応)
    let orderAdvanceAppliedAmount = 0;
    if (invoice.salesOrderId) {
      const order = await this.repo.findSalesOrderById(invoice.salesOrderId);
      if (order?.isPrepaid) {
        orderAdvanceAppliedAmount = invoice.totalAmount; // BUG-047: totalAmount は税込
      }
    }

    return { invoice, lines, isReverse, orderAdvanceAppliedAmount };
  }

  async submitForApproval(
    c: Context,
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) {
    const invoice = await this.repo.findInvoiceById(id);
    if (!invoice) throw new NotFoundError("対象の売上が見つかりません");
    if (invoice.status !== "DRAFT") {
      throw new BadRequestError("下書き状態の売上のみ承認申請できます");
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isSalesInvoiceWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateInvoice(id, {
        status: "APPROVED",
        updatedBy: employeeNumber,
        updatedAt: new Date(),
      });
      c.executionCtx.waitUntil(
        logAuditEvent(c, "APPROVE_SALES_INVOICE_DIRECT", RESOURCE_KEY, id, invoice, {
          status: "APPROVED",
        }),
      );
      return { success: true, message: "承認機能が無効のため、売上を確定しました" };
    }

    await this.repo.updateInvoice(id, {
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
        targetType: "sales_invoices",
        targetId: id,
        applicantId: applicantUserId,
        requestType: "REGISTER",
        amount: invoice.totalAmount || 0,
        comment: `売上[${id}]の承認申請`,
        applicantDepartmentSurrogateId,
      },
      c,
    );

    if (!wfResult.success) {
      await this.repo.updateInvoice(id, {
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
      comment: `売上[${id}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_SALES_INVOICE_FOR_APPROVAL", RESOURCE_KEY, id, invoice, {
        status: "PENDING_APPROVAL",
      }),
    );

    return { success: true, message: "売上の承認を申請しました" };
  }

  async requestInvoiceDeletion(c: Context, id: string) {
    const invoice = await this.repo.findInvoiceById(id);
    if (!invoice) throw new NotFoundError("対象の売上が見つかりません");

    if (invoice.status === "DRAFT") {
      return this.performInvoiceDeletion(c, id, invoice);
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isSalesInvoiceWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      return this.performInvoiceDeletion(c, id, invoice);
    }

    if (invoice.status !== "APPROVED") {
      throw new BadRequestError(
        "承認処理中の売上は削除申請できません。処理完了後に再度お試しください。",
      );
    }

    await this.repo.updateInvoice(id, {
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
        targetType: "sales_invoices",
        targetId: id,
        applicantId: applicantUserId,
        requestType: "DELETE",
        amount: invoice.totalAmount || 0,
        comment: `売上[${id}]の削除申請`,
      },
      c,
    );

    if (!wfResult.success) {
      await this.repo.updateInvoice(id, {
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
      comment: `売上[${id}]の削除申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_SALES_INVOICE_DELETION", RESOURCE_KEY, id, invoice, {
        status: "PENDING_DELETION",
      }),
    );

    return { success: true, message: "売上の削除を申請しました" };
  }
}
