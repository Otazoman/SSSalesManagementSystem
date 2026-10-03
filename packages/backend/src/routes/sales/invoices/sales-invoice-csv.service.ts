import { Context } from "hono";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { assertSalesOrderPartnerMatches } from "./sales-invoice-source-partner";
import { RESOURCE_KEY } from "./sales-invoice-constants";
import { buildSalesInvoiceItemInsertRow } from "./sales-invoice-item-mapper";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

// Item8: quote-csv.service.tsと同じ方針。CSVエクスポート・インポートを担当
export class SalesInvoiceCsvService {
  private repo: SalesInvoiceRepository;

  constructor(repo: SalesInvoiceRepository) {
    this.repo = repo;
  }

  async exportCsv(c: Context) {
    const rawData = await this.repo.findExportInvoicesWithDetails();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_SALES_INVOICES_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: rawData.length,
      }),
    );

    const headers = [
      "id",
      "title",
      "partnerId",
      "salesOrderId",
      "companyDepartment",
      "invoiceDate",
      "status",
      "documentType",
      "originalInvoiceId",
      "totalAmount",
      "taxAmount",
      "memo",
      "billingStatus",
      "salesPersonEmployeeNumber",
      "inputPersonEmployeeNumber",
      "itemId",
      "itemName",
      "inputType",
      "sourceOrderItemId",
      "quantity",
      "unitPrice",
      "unitCode",
      "taxCategoryCode",
      "itemMemo",
    ];

    const rows = rawData.map((row) => {
      const inv = row.sales_invoices;
      const item = row.sales_invoice_items;

      const invDate = inv.invoiceDate
        ? new Date(inv.invoiceDate).toISOString().split("T")[0]
        : "";

      return [
        csvField(`${inv.id}`),
        csvField(inv.title),
        csvField(`${inv.partnerId}`),
        csvField(inv.salesOrderId),
        csvField(inv.companyDepartment),
        csvField(`${invDate}`),
        csvField(`${inv.status}`),
        csvField(`${inv.documentType}`),
        csvField(inv.originalInvoiceId),
        inv.totalAmount ?? 0,
        inv.taxAmount ?? 0,
        csvField(inv.memo),
        csvField(inv.billingStatus),
        csvField(inv.salesPersonEmployeeNumber),
        csvField(inv.inputPersonEmployeeNumber),
        csvField(item?.itemId),
        csvField(item?.itemName),
        csvField(item?.inputType),
        csvField(item?.sourceOrderItemId),
        item?.quantity ?? 0,
        item?.unitPrice ?? 0,
        csvField(item?.unitCode),
        csvField(item?.taxCategoryCode),
        csvField(item?.memo),
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
    const idxSalesOrderId = getIdx(["salesorderid", "sales_order_id"]);
    const idxCompanyDepartment = getIdx(["companydepartment", "company_department"]);
    const idxInvoiceDate = getIdx(["invoicedate", "invoice_date"]);
    const idxStatus = getIdx(["status"]);
    const idxDocumentType = getIdx(["documenttype", "document_type"]);
    const idxOriginalInvoiceId = getIdx(["originalinvoiceid", "original_invoice_id"]);
    const idxTotalAmount = getIdx(["totalamount", "total_amount"]);
    const idxTaxAmount = getIdx(["taxamount", "tax_amount"]);
    const idxMemo = getIdx(["memo"]);
    const idxBillingStatus = getIdx(["billingstatus", "billing_status"]);
    const idxSalesPerson = getIdx([
      "salespersonemployeenumber",
      "sales_person_employee_number",
    ]);
    const idxInputPerson = getIdx([
      "inputpersonemployeenumber",
      "input_person_employee_number",
    ]);
    const idxItemId = getIdx(["itemid", "item_id"]);
    const idxItemName = getIdx(["itemname", "item_name"]);
    const idxInputType = getIdx(["inputtype", "input_type"]);
    const idxSourceOrderItemId = getIdx(["sourceorderitemid", "source_order_item_id"]);
    const idxQuantity = getIdx(["quantity"]);
    const idxUnitPrice = getIdx(["unitprice", "unit_price"]);
    const idxUnitCode = getIdx(["unitcode", "unit_code"]);
    const idxTaxCategoryCode = getIdx(["taxcategorycode", "tax_category_code"]);
    const idxItemMemo = getIdx(["itemmemo", "item_memo"]);

    let count = 0;
    const clearedInvoiceIds = new Set<string>();
    const invoiceSortOrders = new Map<string, number>();

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
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

      // BUG-050: 行ごとに、取引先と元の受注の得意先が一致することを確認する
      // (commit() より前に止めるため、1行でも異なれば1件も取り込まない)
      await assertSalesOrderPartnerMatches(
        this.repo,
        partnerId,
        getCellVal(idxSalesOrderId),
        [getCellVal(idxSourceOrderItemId)],
        `CSVの売上[${id}]: `,
      );

      if (!clearedInvoiceIds.has(id)) {
        await tx.repo.deleteInvoiceItems(id);
        clearedInvoiceIds.add(id);
        invoiceSortOrders.set(id, 0);

        const rawInvoiceDate = getCellVal(idxInvoiceDate);
        const rawStatus = getCellVal(idxStatus);
        const rawDocumentType = getCellVal(idxDocumentType);
        const rawTotal = getCellVal(idxTotalAmount);
        const rawTax = getCellVal(idxTaxAmount);

        await tx.repo.upsertInvoiceFromCsv({
          id,
          title: getCellVal(idxTitle),
          partnerId,
          salesOrderId: getCellVal(idxSalesOrderId),
          companyDepartment: getCellVal(idxCompanyDepartment),
          invoiceDate: rawInvoiceDate ? new Date(rawInvoiceDate) : new Date(),
          status: rawStatus || "DRAFT",
          documentType: rawDocumentType || "SALE",
          originalInvoiceId: getCellVal(idxOriginalInvoiceId),
          totalAmount: rawTotal ? Number(rawTotal) : 0,
          taxAmount: rawTax ? Number(rawTax) : 0,
          memo: getCellVal(idxMemo),
          billingStatus: getCellVal(idxBillingStatus) || "UNBILLED",
          salesPersonEmployeeNumber: getCellVal(idxSalesPerson),
          inputPersonEmployeeNumber: getCellVal(idxInputPerson) || opId,
          createdBy: opId,
          createdAt: new Date(),
          updatedBy: opId,
          updatedAt: new Date(),
        });
      }

      const itemId = getCellVal(idxItemId);
      if (itemId) {
        const currentSortOrder = invoiceSortOrders.get(id) || 0;
        const rawQty = getCellVal(idxQuantity);
        const rawPrice = getCellVal(idxUnitPrice);
        const qQty = rawQty ? Number(rawQty) : 1;
        const qPrice = rawPrice ? Number(rawPrice) : 0;

        const rawInputType = getCellVal(idxInputType);
        const normalizedInputType =
          rawInputType?.toUpperCase() === "MASTER" || rawInputType?.toUpperCase() === "DIRECT"
            ? rawInputType.toUpperCase()
            : null;

        await tx.repo.insertInvoiceItem(
          buildSalesInvoiceItemInsertRow(
            {
              itemId,
              itemName: getCellVal(idxItemName),
              inputType: normalizedInputType,
              sourceOrderItemId: getCellVal(idxSourceOrderItemId),
              quantity: qQty,
              unitPrice: qPrice,
              costPrice: null,
              memo: getCellVal(idxItemMemo),
              unitCode: getCellVal(idxUnitCode),
              taxCategoryCode: getCellVal(idxTaxCategoryCode),
            },
            id,
            currentSortOrder,
          ),
        );

        invoiceSortOrders.set(id, currentSortOrder + 1);
      }
      count++;
    }
    await tx.commit();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_SALES_INVOICES_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
        processedCount: count,
      }),
    );

    return {
      success: true,
      message: `CSVから ${clearedInvoiceIds.size} 件の売上データ(総明細行数: ${count}行)をインポート・完全同期しました`,
    };
  }
}
