import { Context } from "hono";
import { PaymentRepository } from "./payment.repository";
import { RESOURCE_KEY } from "./payment-constants";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { assertReconRowsAreNew, parseReconCells, reconKey, type ReconLimit, type ReconRow } from "../../../platform/csv/reconciliation-rows";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";

// Item10 Phase5: billing-csv.service.tsと同じ方針。payment_headers+payment_header_items
// (1行1明細のフラット形式)、および payment_disbursements(手動消込結果の一括登録用)の
// 別CSVを担当する
export class PaymentCsvService {
  private repo: PaymentRepository;

  constructor(repo: PaymentRepository) {
    this.repo = repo;
  }

  async exportCsv(c: Context) {
    const rawData = await this.repo.findExportHeadersWithItems();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_PAYMENT_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: rawData.length,
      }),
    );

    const headers = [
      "id",
      "title",
      "partnerId",
      "paymentDate",
      "mode",
      "periodStart",
      "periodEnd",
      "status",
      "totalAmount",
      "taxAmount",
      "reconciledAmount",
      "reconciliationStatus",
      "memo",
      "purchaseRecognitionId",
      "itemAmount",
      "itemTaxAmount",
    ];

    const rows = rawData.map((row) => {
      const h = row.payment_headers;
      const item = row.payment_header_items;

      const fmtDate = (d: unknown) => (d ? new Date(d as string).toISOString().split("T")[0] : "");

      return [
        csvField(`${h.id}`),
        csvField(h.title),
        csvField(`${h.partnerId}`),
        csvField(`${fmtDate(h.paymentDate)}`),
        csvField(`${h.mode}`),
        csvField(`${fmtDate(h.periodStart)}`),
        csvField(`${fmtDate(h.periodEnd)}`),
        csvField(`${h.status}`),
        h.totalAmount ?? 0,
        h.taxAmount ?? 0,
        h.reconciledAmount ?? 0,
        csvField(`${h.reconciliationStatus}`),
        csvField(h.memo),
        csvField(item?.purchaseRecognitionId),
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
    const idxPaymentDate = getIdx(["paymentdate", "payment_date"]);
    const idxMode = getIdx(["mode"]);
    const idxPeriodStart = getIdx(["periodstart", "period_start"]);
    const idxPeriodEnd = getIdx(["periodend", "period_end"]);
    const idxStatus = getIdx(["status"]);
    const idxTotalAmount = getIdx(["totalamount", "total_amount"]);
    const idxTaxAmount = getIdx(["taxamount", "tax_amount"]);
    const idxReconciledAmount = getIdx(["reconciledamount", "reconciled_amount"]);
    const idxReconciliationStatus = getIdx(["reconciliationstatus", "reconciliation_status"]);
    const idxMemo = getIdx(["memo"]);
    const idxPurchaseRecognitionId = getIdx(["purchaserecognitionid", "purchase_recognition_id"]);
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

        const rawPaymentDate = getCellVal(idxPaymentDate);
        const rawMode = getCellVal(idxMode);
        const rawStatus = getCellVal(idxStatus);
        const rawTotal = getCellVal(idxTotalAmount);
        const rawTax = getCellVal(idxTaxAmount);
        const rawReconciled = getCellVal(idxReconciledAmount);

        await this.repo.upsertHeaderFromCsv({
          id,
          title: getCellVal(idxTitle),
          partnerId,
          paymentDate: rawPaymentDate ? new Date(rawPaymentDate) : new Date(),
          mode: rawMode || "PER_TRANSACTION",
          periodStart: getCellVal(idxPeriodStart) ? new Date(getCellVal(idxPeriodStart)!) : null,
          periodEnd: getCellVal(idxPeriodEnd) ? new Date(getCellVal(idxPeriodEnd)!) : null,
          status: rawStatus || "DRAFT",
          totalAmount: rawTotal ? Number(rawTotal) : 0,
          taxAmount: rawTax ? Number(rawTax) : 0,
          reconciledAmount: rawReconciled ? Number(rawReconciled) : 0,
          reconciliationStatus: getCellVal(idxReconciliationStatus) || "UNRECONCILED",
          memo: getCellVal(idxMemo),
          createdBy: opId,
          createdAt: new Date(),
          updatedBy: opId,
          updatedAt: new Date(),
        });
      }

      const purchaseRecognitionId = getCellVal(idxPurchaseRecognitionId);
      if (purchaseRecognitionId) {
        const currentSortOrder = headerSortOrders.get(id) || 0;
        await this.repo.insertItem({
          id: crypto.randomUUID(),
          paymentHeaderId: id,
          purchaseRecognitionId,
          amount: getCellVal(idxItemAmount) ? Number(getCellVal(idxItemAmount)) : 0,
          taxAmount: getCellVal(idxItemTaxAmount) ? Number(getCellVal(idxItemTaxAmount)) : 0,
          sortOrder: currentSortOrder,
        });
        headerSortOrders.set(id, currentSortOrder + 1);
      }
      count++;
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_PAYMENT_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
        processedCount: count,
      }),
    );

    return {
      success: true,
      message: `CSVから ${clearedHeaderIds.size} 件の支払データ(総明細行数: ${count}行)をインポート・完全同期しました`,
    };
  }

  async exportDisbursementsCsv(c: Context) {
    const rows = await this.repo.findExportDisbursements();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_PAYMENT_DISBURSEMENTS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: rows.length,
      }),
    );

    const headers = [
      "id",
      "paymentHeaderId",
      "paidDate",
      "amount",
      "method",
      "memo",
      "reconciledById",
      "reconciledAt",
    ];

    const csvRows = rows.map((r) => {
      return [
        csvField(`${r.id}`),
        csvField(`${r.paymentHeaderId}`),
        csvField(`${new Date(r.paidDate).toISOString().split("T")[0]}`),
        r.amount ?? 0,
        csvField(`${r.method}`),
        csvField(r.memo),
        csvField(`${r.reconciledById}`),
        csvField(`${new Date(r.reconciledAt).toISOString().split("T")[0]}`),
      ].join(",");
    });

    return withBom(buildCsvContent(headers, csvRows));
  }

  async bulkImportDisbursementsCsv(c: Context, file: File) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const text = await file.text();

    const allLines = parseCsv(text);
    if (allLines.length <= 1) {
      return { success: true, message: "同期する有効なデータがありませんでした" };
    }

    const headers = allLines[0].map((h) => h.toLowerCase().trim());
    const getIdx = (keys: string[]) =>
      headers.findIndex((h) => keys.map((k) => k.toLowerCase()).includes(h));

    const idxPaymentHeaderId = getIdx(["paymentheaderid", "payment_header_id"]);
    const idxPaidDate = getIdx(["paiddate", "paid_date"]);
    const idxAmount = getIdx(["amount"]);
    const idxMethod = getIdx(["method"]);
    const idxMemo = getIdx(["memo"]);

    // 全行を書き込み前に検証する(存在しない支払・不正な日付/金額・既存や重複した支払消込はエラーで1件も登録しない)
    const parseErrors: string[] = [];
    const rows: ReconRow[] = [];
    allLines.slice(1).forEach((cols, index) => {
      if (cols.length <= idxPaymentHeaderId || !cols[idxPaymentHeaderId]) return;
      const headerId = cols[idxPaymentHeaderId].trim();
      if (!headerId || headerId === "paymentheaderid") return;

      const getCellVal = (idx: number) => {
        if (idx === -1 || idx >= cols.length) return null;
        const trimmed = cols[idx].trim();
        return trimmed === "" ? null : trimmed;
      };
      const row = parseReconCells(
        {
          line: index + 2,
          headerId,
          date: getCellVal(idxPaidDate),
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
    const limits = new Map<string, ReconLimit>();
    for (const id of new Set(rows.map((r) => r.headerId))) {
      const header = await this.repo.findHeaderById(id);
      if (!header) continue;
      existingHeaderIds.add(id);
      const existing = await this.repo.findDisbursementsByHeaderId(id);
      limits.set(id, {
        totalAmount: header.totalAmount,
        reconciledAmount: existing.reduce((sum, r) => sum + r.amount, 0),
      });
      for (const r of existing) {
        existingKeys.add(
          reconKey({ headerId: id, date: new Date(r.paidDate), amount: r.amount, method: r.method, memo: r.memo ?? null }),
        );
      }
    }
    assertReconRowsAreNew(rows, parseErrors, existingHeaderIds, existingKeys, "支払消込", "支払", limits);

    let count = 0;
    const affectedHeaderIds = new Set<string>();
    for (const row of rows) {
      await this.repo.insertDisbursement({
        id: crypto.randomUUID(),
        paymentHeaderId: row.headerId,
        paidDate: row.date,
        amount: row.amount,
        method: row.method,
        memo: row.memo,
        reconciledById: opId,
        reconciledAt: new Date(),
      });
      affectedHeaderIds.add(row.headerId);
      count++;
    }

    for (const paymentHeaderId of affectedHeaderIds) {
      const header = await this.repo.findHeaderById(paymentHeaderId);
      if (!header) continue;
      const reconciledAmount = await this.repo.sumReconciledAmount(paymentHeaderId);
      const reconciliationStatus =
        reconciledAmount >= header.totalAmount
          ? "RECONCILED"
          : reconciledAmount > 0
            ? "PARTIALLY_RECONCILED"
            : "UNRECONCILED";
      await this.repo.updateHeader(paymentHeaderId, {
        reconciledAmount,
        reconciliationStatus,
        updatedBy: opId,
        updatedAt: new Date(),
      });
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_PAYMENT_DISBURSEMENTS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
        processedCount: count,
      }),
    );

    return {
      success: true,
      message: `CSVから ${count} 件の支払消込データをインポートしました`,
    };
  }
}
