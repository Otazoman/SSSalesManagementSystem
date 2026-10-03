import { Context } from "hono";
import { BillingRepository } from "./billing.repository";
import { RESOURCE_KEY } from "./billing-constants";
import { CreateBillingPayload } from "./billing.schema";
import { SalesInvoiceRepository } from "../invoices/sales-invoice.repository";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { SearchBillingQuery } from "./billing.schema";
import { SortQuery } from "../../../platform/http/sort";
import { signedAmount } from "../../../platform/documents/red-slip";
import { computeDocumentTotals } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { roundTaxAmount } from "../../../platform/tax/compute-tax-amounts";
import { getTaxRoundingMode } from "../../../platform/tax/get-tax-rounding-mode";
import { buildBillingTaxLines } from "./billing-tax-lines";
import * as schema from "../../../db/schema";
import { assertPartnerNotSuspended } from "../../../platform/partners/suspended-partner";

// Item8 Phase4: 既にAPPROVED確定済みのsales_invoicesを束ねて請求(billing_headers)を作成する。
// quote-crud.service.ts等と異なり承認ワークフローは持たない(束ねる対象自体が承認済みのため)
export class BillingCrudService {
  private repo: BillingRepository;

  constructor(repo: BillingRepository) {
    this.repo = repo;
  }

  async searchHeaders(c: Context, query: SearchBillingQuery, sort?: SortQuery) {
    const result = await this.repo.findHeaders(query, sort);
    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_BILLING_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
      }),
    );
    return result;
  }

  async searchHeadersPage(
    c: Context,
    query: SearchBillingQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [result, total] = await Promise.all([
      this.repo.findHeadersPage(query, params, sort),
      this.repo.countHeaders(query),
    ]);
    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_BILLING_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
      }),
    );
    return buildListResponse(result, buildPaginationMeta(params, total));
  }

  async getBillingDetail(c: Context, id: string) {
    const header = await this.repo.findHeaderById(id);
    if (!header) return null;

    const itemRows = await this.repo.findItemsWithInvoiceDetail(id);
    const paymentReceipts = await this.repo.findPaymentReceiptsByHeaderId(id);

    // K-4-2: 消込画面で対象請求に含まれる売上の明細(品目・数量・単価)まで参照できるよう、
    // billing-pdf.service.tsのPERIODICモードと同じ取得メソッドを流用して展開する。
    // K-4-3: salesInvoiceがnull(完全手動入力行)はsales_invoice_itemsを持たないためスキップする
    const invoiceIds = itemRows
      .map((row) => row.salesInvoice?.id)
      .filter((id): id is string => !!id);
    const invoiceItems = await this.repo.findSalesInvoiceItemsByInvoiceIds(invoiceIds);
    const invoiceItemsByInvoiceId = new Map<string, typeof invoiceItems>();
    for (const item of invoiceItems) {
      const list = invoiceItemsByInvoiceId.get(item.salesInvoiceId) || [];
      list.push(item);
      invoiceItemsByInvoiceId.set(item.salesInvoiceId, list);
    }

    return {
      ...header,
      items: itemRows.map((row) => ({
        ...row.billingItem,
        salesInvoice: row.salesInvoice,
        invoiceItems: row.salesInvoice
          ? invoiceItemsByInvoiceId.get(row.salesInvoice.id) || []
          : [],
      })),
      paymentReceipts,
    };
  }

  private validateCreatePayload(body: CreateBillingPayload, manualItems: CreateBillingPayload["manualItems"]) {
    const totalLineCount = body.salesInvoiceIds.length + manualItems.length;
    if (totalLineCount === 0) {
      throw new BadRequestError("対象の売上、または明細を1件以上指定してください");
    }
    if (body.mode === "PER_TRANSACTION" && totalLineCount !== 1) {
      throw new BadRequestError(
        "都度請求(PER_TRANSACTION)では対象の売上・明細を合計1件のみ選択してください",
      );
    }
    if (body.mode === "PERIODIC") {
      if (!body.periodStart || !body.periodEnd) {
        throw new BadRequestError("締め請求(PERIODIC)では対象期間(periodStart/periodEnd)の指定が必要です");
      }
    }
  }

  async createBilling(c: Context, body: CreateBillingPayload) {
    await assertPartnerNotSuspended(c.env.DB, body.partnerId);
    // 直接service層を呼ぶテスト等でvalibotのデフォルト値([])を経由しないケースに備える
    const manualItems = body.manualItems ?? [];
    this.validateCreatePayload(body, manualItems);

    const salesInvoiceRepo = new SalesInvoiceRepository(c.env.DB);
    const targetInvoices = await this.repo.findSalesInvoicesByIds(body.salesInvoiceIds);

    if (targetInvoices.length !== body.salesInvoiceIds.length) {
      throw new NotFoundError("指定された売上の一部が見つかりません");
    }
    for (const inv of targetInvoices) {
      if (inv.status !== "APPROVED") {
        throw new BadRequestError(`売上[${inv.id}]は承認済みではないため請求対象にできません`);
      }
      if (inv.billingStatus === "BILLED") {
        throw new BadRequestError(`売上[${inv.id}]は既に請求済み(BILLED)です`);
      }
      if (inv.partnerId !== body.partnerId) {
        throw new BadRequestError(`売上[${inv.id}]の取引先が指定の請求先と一致しません`);
      }
    }

    // K-4-3: 完全手動入力の明細行。品目マスタに依らないため、数量×単価と税区分から
    // 自前でamount/taxAmountを算出する(sales_invoice由来の行は既存の確定済み金額をそのまま使う)
    // BUG-042: 行ごとの消費税は表示用。請求の消費税は下で請求書全体から税率ごとに1回計算する
    const taxCategoryRates = await this.repo.findTaxCategoryRates();
    const roundingMode = await getTaxRoundingMode(c.env.COMPANY_SETTINGS);
    const manualLines = manualItems.map((item) => {
      const amount = Math.round(item.quantity * item.unitPrice);
      const rate = item.taxCategoryCode ? (taxCategoryRates.get(item.taxCategoryCode) ?? 0.1) : 0.1;
      const taxAmount = roundTaxAmount(amount, rate, roundingMode);
      return { ...item, amount, taxAmount };
    });

    const opId = await this.repo.getFallbackOperatorId(c);
    const billingId = await resolveConfiguredDocumentId(
      c,
      "billing",
      (id) => this.repo.existsHeader(id),
      null,
    );

    // 追加要望L-2-a: 赤伝(返品/値引/赤伝(訂正))は請求額から減算する(伝票自体は正の金額で保存)
    // BUG-042: 請求の合計・消費税は、対象の売上の明細と手入力の明細の全てから、税率ごとに1回の端数処理で計算する
    // (適格請求書の要件。売上ごとの消費税の合計とは数円ずれることがある。請求書 PDF の内訳と同じ計算)
    // 明細の無い売上(明細を持たない古いデータなど)は、明細から計算できないため、保存済みの金額をそのまま足す
    const invoiceItems = await this.repo.findSalesInvoiceItemsByInvoiceIds(body.salesInvoiceIds);
    const invoicesWithItems = new Set(invoiceItems.map((item) => item.salesInvoiceId));
    const itemlessInvoices = targetInvoices.filter((inv) => !invoicesWithItems.has(inv.id));
    const computed = computeDocumentTotals(
      buildBillingTaxLines(targetInvoices, invoiceItems, manualLines),
      taxCategoryRates,
      roundingMode,
    );
    const totalAmount =
      computed.totalAmount +
      itemlessInvoices.reduce((s, inv) => s + signedAmount(inv.documentType, inv.totalAmount), 0);
    const taxAmount =
      computed.taxAmount +
      itemlessInvoices.reduce((s, inv) => s + signedAmount(inv.documentType, inv.taxAmount), 0);

    let sortOrder = 0;
    const itemRows: (typeof schema.billingItems.$inferInsert)[] = [];
    for (const inv of targetInvoices) {
      itemRows.push({
        id: crypto.randomUUID(),
        billingHeaderId: billingId,
        salesInvoiceId: inv.id,
        amount: signedAmount(inv.documentType, inv.totalAmount),
        taxAmount: signedAmount(inv.documentType, inv.taxAmount),
        sortOrder: sortOrder++,
      });
    }
    for (const line of manualLines) {
      itemRows.push({
        id: crypto.randomUUID(),
        billingHeaderId: billingId,
        salesInvoiceId: null,
        amount: line.amount,
        taxAmount: line.taxAmount,
        sortOrder: sortOrder++,
        itemName: line.itemName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxCategoryCode: line.taxCategoryCode || null,
      });
    }

    // 二重請求防止: 事前チェック(上のBILLED判定)は読み取りのみで、同時に別の請求が同じ売上を
    // 取った場合を防げない。そのため先に「未請求のものだけBILLEDへ」を条件付きUPDATEで確保し、
    // 確保できなかった売上があれば、確保済み分を戻して失敗させる
    const claimedIds = await salesInvoiceRepo.claimUnbilledInvoices(body.salesInvoiceIds);
    if (claimedIds.length !== body.salesInvoiceIds.length) {
      await salesInvoiceRepo.markInvoicesAsUnbilled(claimedIds);
      throw new BadRequestError(
        "対象の売上の一部が、他の操作により既に請求済みになっています。画面を更新して再度お試しください",
      );
    }

    try {
      // ヘッダと明細は1回のbatch(原子的)で登録する。失敗時にヘッダだけが残らない
      await this.repo.insertHeaderWithItems(
        {
          id: billingId,
          partnerId: body.partnerId,
          title: body.title || null,
          billingDate: new Date(body.billingDate),
          mode: body.mode,
          periodStart: body.periodStart ? new Date(body.periodStart) : null,
          periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
          status: "DRAFT",
          totalAmount,
          taxAmount,
          reconciledAmount: 0,
          reconciliationStatus: "UNRECONCILED",
          invoicePdfR2Path: null,
          memo: body.memo || null,
          createdBy: opId,
          updatedBy: opId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        itemRows,
      );
    } catch (err) {
      // 請求が作られなかったのに売上だけBILLEDで取り残されないよう、確保した売上を未請求へ戻す
      await salesInvoiceRepo.markInvoicesAsUnbilled(claimedIds);
      throw err;
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_BILLING", RESOURCE_KEY, billingId, null, {
        id: billingId,
        partnerId: body.partnerId,
        mode: body.mode,
        salesInvoiceIds: body.salesInvoiceIds,
        manualItemCount: manualItems.length,
        totalAmount,
      }),
    );

    return { success: true, message: "請求情報を新規登録しました", id: billingId };
  }

  // 追加要望: 請求の削除。入金消込が既に記録されている場合は、消込実績を無に帰さないよう削除を拒否する。
  // billing_items/payment_receiptsはonDelete: cascadeのためヘッダー削除だけで道連れ削除されるが、
  // 紐づいていた売上のbillingStatusはBILLEDのまま取り残されるため、明示的にUNBILLEDへ戻す
  async deleteBilling(c: Context, id: string) {
    const header = await this.repo.findHeaderById(id);
    if (!header) {
      throw new NotFoundError("対象の請求データが見つかりません");
    }
    if (header.reconciledAmount > 0) {
      throw new BadRequestError(
        "入金消込が記録されているため削除できません。消込を取り消してから削除してください",
      );
    }

    const items = await this.repo.findItemsByHeaderId(id);
    const salesInvoiceIds = items
      .map((item) => item.salesInvoiceId)
      .filter((invoiceId): invoiceId is string => !!invoiceId);

    const salesInvoiceRepo = new SalesInvoiceRepository(c.env.DB);
    await salesInvoiceRepo.markInvoicesAsUnbilled(salesInvoiceIds);
    await this.repo.deleteHeader(id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_BILLING", RESOURCE_KEY, id, header, {
        id,
        salesInvoiceIds,
      }),
    );

    return { success: true, message: "請求情報を削除しました" };
  }
}
