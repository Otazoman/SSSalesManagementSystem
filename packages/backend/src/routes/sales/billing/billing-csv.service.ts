import { Context } from "hono";
import { BillingRepository } from "./billing.repository";
import { RESOURCE_KEY } from "./billing-constants";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { assertReconRowsAreNew, parseReconCells, reconKey, type ReconRow } from "../../../platform/csv/reconciliation-rows";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";

// Item8 Phase4: quote-csv.service.tsと同じ方針。billing_headers+billing_items(1行1明細の
// フラット形式)、および payment_receipts(手動消込結果の一括登録用)の別CSVを担当する
export class BillingCsvService {
  private repo: BillingRepository;

  constructor(repo: BillingRepository) {
    this.repo = repo;
  }

  async exportCsv(c: Context) {
    const rawData = await this.repo.findExportHeadersWithItems();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_BILLING_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: rawData.length,
      }),
    );

    const headers = [
      "id",
      "title",
      "partnerId",
      "billingDate",
      "mode",
      "periodStart",
      "periodEnd",
      "status",
      "totalAmount",
      "taxAmount",
      "reconciledAmount",
      "reconciliationStatus",
      "memo",
      "salesInvoiceId",
      "itemAmount",
      "itemTaxAmount",
    ];

    const rows = rawData.map((row) => {
      const h = row.billing_headers;
      const item = row.billing_items;

      const fmtDate = (d: unknown) => (d ? new Date(d as string).toISOString().split("T")[0] : "");

      return [
        csvField(`${h.id}`),
        csvField(h.title),
        csvField(`${h.partnerId}`),
        csvField(`${fmtDate(h.billingDate)}`),
        csvField(`${h.mode}`),
        csvField(`${fmtDate(h.periodStart)}`),
        csvField(`${fmtDate(h.periodEnd)}`),
        csvField(`${h.status}`),
        h.totalAmount ?? 0,
        h.taxAmount ?? 0,
        h.reconciledAmount ?? 0,
        csvField(`${h.reconciliationStatus}`),
        csvField(h.memo),
        csvField(item?.salesInvoiceId),
        item?.amount ?? 0,
        item?.taxAmount ?? 0,
      ].join(",");
    });

    return withBom(buildCsvContent(headers, rows));
  }

  async bulkImportCsv(c: Context, file: File) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const text = await file.text();

    const allLines = parseCsv(text);
    if (allLines.length <= 1) {
      return { success: true, message: "同期する有効なデータがありませんでした" };
    }

    const headers = allLines[0].map((h) => h.toLowerCase().trim());
    const getIdx = (keys: string[]) =>
      headers.findIndex((h) => keys.map((k) => k.toLowerCase()).includes(h));

    const idxId = getIdx(["id"]);
    const idxTitle = getIdx(["title"]);
    const idxPartnerId = getIdx(["partnerid", "partner_id"]);
    const idxBillingDate = getIdx(["billingdate", "billing_date"]);
    const idxMode = getIdx(["mode"]);
    const idxPeriodStart = getIdx(["periodstart", "period_start"]);
    const idxPeriodEnd = getIdx(["periodend", "period_end"]);
    const idxStatus = getIdx(["status"]);
    const idxTotalAmount = getIdx(["totalamount", "total_amount"]);
    const idxTaxAmount = getIdx(["taxamount", "tax_amount"]);
    const idxReconciledAmount = getIdx(["reconciledamount", "reconciled_amount"]);
    const idxReconciliationStatus = getIdx(["reconciliationstatus", "reconciliation_status"]);
    const idxMemo = getIdx(["memo"]);
    const idxSalesInvoiceId = getIdx(["salesinvoiceid", "sales_invoice_id"]);
    const idxItemAmount = getIdx(["itemamount", "item_amount"]);
    const idxItemTaxAmount = getIdx(["itemtaxamount", "item_tax_amount"]);

    let count = 0;
    const clearedHeaderIds = new Set<string>();
    const headerSortOrders = new Map<string, number>();

    for (const cols of allLines.slice(1)) {
      if (cols.length <= idxId || !cols[idxId]) continue;
      const id = cols[idxId].trim();
      const partnerId =
        idxPartnerId !== -1 && cols[idxPartnerId] ? cols[idxPartnerId].trim() : "";
      if (!id || id === "id" || !partnerId) continue;

      const getCellVal = (idx: number) => {
        if (idx === -1 || idx >= cols.length) return null;
        const trimmed = cols[idx].trim();
        return trimmed === "" ? null : trimmed;
      };

      if (!clearedHeaderIds.has(id)) {
        await this.repo.deleteItemsByHeaderId(id);
        clearedHeaderIds.add(id);
        headerSortOrders.set(id, 0);

        const rawBillingDate = getCellVal(idxBillingDate);
        const rawMode = getCellVal(idxMode);
        const rawStatus = getCellVal(idxStatus);
        const rawTotal = getCellVal(idxTotalAmount);
        const rawTax = getCellVal(idxTaxAmount);
        const rawReconciled = getCellVal(idxReconciledAmount);

        await this.repo.upsertHeaderFromCsv({
          id,
          title: getCellVal(idxTitle),
          partnerId,
          billingDate: rawBillingDate ? new Date(rawBillingDate) : new Date(),
          mode: rawMode || "PER_TRANSACTION",
          periodStart: getCellVal(idxPeriodStart) ? new Date(getCellVal(idxPeriodStart)!) : null,
          periodEnd: getCellVal(idxPeriodEnd) ? new Date(getCellVal(idxPeriodEnd)!) : null,
          status: rawStatus || "DRAFT",
          totalAmount: rawTotal ? Number(rawTotal) : 0,
          taxAmount: rawTax ? Number(rawTax) : 0,
          reconciledAmount: rawReconciled ? Number(rawReconciled) : 0,
          reconciliationStatus: getCellVal(idxReconciliationStatus) || "UNRECONCILED",
          invoicePdfR2Path: null,
          memo: getCellVal(idxMemo),
          createdBy: opId,
          createdAt: new Date(),
          updatedBy: opId,
          updatedAt: new Date(),
        });
      }

      const salesInvoiceId = getCellVal(idxSalesInvoiceId);
      if (salesInvoiceId) {
        const currentSortOrder = headerSortOrders.get(id) || 0;
        await this.repo.insertItem({
          id: crypto.randomUUID(),
          billingHeaderId: id,
          salesInvoiceId,
          amount: getCellVal(idxItemAmount) ? Number(getCellVal(idxItemAmount)) : 0,
          taxAmount: getCellVal(idxItemTaxAmount) ? Number(getCellVal(idxItemTaxAmount)) : 0,
          sortOrder: currentSortOrder,
        });
        headerSortOrders.set(id, currentSortOrder + 1);
      }
      count++;
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_BILLING_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
        processedCount: count,
      }),
    );

    return {
      success: true,
      message: `CSVから ${clearedHeaderIds.size} 件の請求データ(総明細行数: ${count}行)をインポート・完全同期しました`,
    };
  }

  async exportPaymentReceiptsCsv(c: Context) {
    const rows = await this.repo.findExportPaymentReceipts();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_PAYMENT_RECEIPTS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: rows.length,
      }),
    );

    const headers = [
      "id",
      "billingHeaderId",
      "receivedDate",
      "amount",
      "method",
      "memo",
      "reconciledById",
      "reconciledAt",
    ];

    const csvRows = rows.map((r) => {
      return [
        csvField(`${r.id}`),
        csvField(`${r.billingHeaderId}`),
        csvField(`${new Date(r.receivedDate).toISOString().split("T")[0]}`),
        r.amount ?? 0,
        csvField(`${r.method}`),
        csvField(r.memo),
        csvField(`${r.reconciledById}`),
        csvField(`${new Date(r.reconciledAt).toISOString().split("T")[0]}`),
      ].join(",");
    });

    return withBom(buildCsvContent(headers, csvRows));
  }

  async bulkImportPaymentReceiptsCsv(c: Context, file: File) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const text = await file.text();

    const allLines = parseCsv(text);
    if (allLines.length <= 1) {
      return { success: true, message: "同期する有効なデータがありませんでした" };
    }

    const headers = allLines[0].map((h) => h.toLowerCase().trim());
    const getIdx = (keys: string[]) =>
      headers.findIndex((h) => keys.map((k) => k.toLowerCase()).includes(h));

    const idxBillingHeaderId = getIdx(["billingheaderid", "billing_header_id"]);
    const idxReceivedDate = getIdx(["receiveddate", "received_date"]);
    const idxAmount = getIdx(["amount"]);
    const idxMethod = getIdx(["method"]);
    const idxMemo = getIdx(["memo"]);

    // 全行を書き込み前に検証する(存在しない請求・不正な日付/金額・既存や重複した入金はエラーで1件も登録しない)
    const parseErrors: string[] = [];
    const rows: ReconRow[] = [];
    allLines.slice(1).forEach((cols, index) => {
      if (cols.length <= idxBillingHeaderId || !cols[idxBillingHeaderId]) return;
      const headerId = cols[idxBillingHeaderId].trim();
      if (!headerId || headerId === "billingheaderid") return;

      const getCellVal = (idx: number) => {
        if (idx === -1 || idx >= cols.length) return null;
        const trimmed = cols[idx].trim();
        return trimmed === "" ? null : trimmed;
      };
      const row = parseReconCells(
        {
          line: index + 2,
          headerId,
          date: getCellVal(idxReceivedDate),
          amount: getCellVal(idxAmount),
          method: getCellVal(idxMethod),
          memo: getCellVal(idxMemo),
        },
        "BANK_TRANSFER",
        parseErrors,
      );
      if (row) rows.push(row);
    });

    const existingHeaderIds = new Set<string>();
    const existingKeys = new Set<string>();
    for (const id of new Set(rows.map((r) => r.headerId))) {
      if (!(await this.repo.findHeaderById(id))) continue;
      existingHeaderIds.add(id);
      for (const r of await this.repo.findPaymentReceiptsByHeaderId(id)) {
        existingKeys.add(
          reconKey({ headerId: id, date: new Date(r.receivedDate), amount: r.amount, method: r.method, memo: r.memo ?? null }),
        );
      }
    }
    assertReconRowsAreNew(rows, parseErrors, existingHeaderIds, existingKeys, "入金", "請求");

    let count = 0;
    const affectedHeaderIds = new Set<string>();
    for (const row of rows) {
      await this.repo.insertPaymentReceipt({
        id: crypto.randomUUID(),
        billingHeaderId: row.headerId,
        receivedDate: row.date,
        amount: row.amount,
        method: row.method,
        memo: row.memo,
        reconciledById: opId,
        reconciledAt: new Date(),
      });
      affectedHeaderIds.add(row.headerId);
      count++;
    }

    for (const billingHeaderId of affectedHeaderIds) {
      const header = await this.repo.findHeaderById(billingHeaderId);
      if (!header) continue;
      const reconciledAmount = await this.repo.sumReconciledAmount(billingHeaderId);
      const reconciliationStatus =
        reconciledAmount >= header.totalAmount
          ? "RECONCILED"
          : reconciledAmount > 0
            ? "PARTIALLY_RECONCILED"
            : "UNRECONCILED";
      await this.repo.updateHeader(billingHeaderId, {
        reconciledAmount,
        reconciliationStatus,
        updatedBy: opId,
        updatedAt: new Date(),
      });
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_PAYMENT_RECEIPTS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
        processedCount: count,
      }),
    );

    return {
      success: true,
      message: `CSVから ${count} 件の入金消込データをインポートしました`,
    };
  }
}
