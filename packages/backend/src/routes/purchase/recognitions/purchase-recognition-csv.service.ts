import { Context } from "hono";
import { PurchaseRecognitionRepository } from "./purchase-recognition.repository";
import { assertPurchaseOrderPartnerMatches } from "./purchase-recognition-source-partner";
import { RESOURCE_KEY } from "./purchase-recognition-constants";
import { buildPurchaseRecognitionItemInsertRow } from "./purchase-recognition-item-mapper";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

// Item10: sales-invoice-csv.service.tsと同じ方針。CSVエクスポート・インポートを担当
export class PurchaseRecognitionCsvService {
  private repo: PurchaseRecognitionRepository;

  constructor(repo: PurchaseRecognitionRepository) {
    this.repo = repo;
  }

  async exportCsv(c: Context) {
    const rawData = await this.repo.findExportRecognitionsWithDetails();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_PURCHASE_RECOGNITIONS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: rawData.length,
      }),
    );

    const headers = [
      "id",
      "title",
      "partnerId",
      "orderId",
      "companyDepartment",
      "recognitionDate",
      "status",
      "documentType",
      "originalRecognitionId",
      "totalAmount",
      "taxAmount",
      "memo",
      "paymentStatus",
      "purchasePersonEmployeeNumber",
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
      const rec = row.purchase_recognitions;
      const item = row.purchase_recognition_items;

      const recDate = rec.recognitionDate
        ? new Date(rec.recognitionDate).toISOString().split("T")[0]
        : "";

      return [
        csvField(`${rec.id}`),
        csvField(rec.title),
        csvField(`${rec.partnerId}`),
        csvField(rec.orderId),
        csvField(rec.companyDepartment),
        csvField(`${recDate}`),
        csvField(`${rec.status}`),
        csvField(`${rec.documentType}`),
        csvField(rec.originalRecognitionId),
        rec.totalAmount ?? 0,
        rec.taxAmount ?? 0,
        csvField(rec.memo),
        csvField(rec.paymentStatus),
        csvField(rec.purchasePersonEmployeeNumber),
        csvField(rec.inputPersonEmployeeNumber),
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
    const idxOrderId = getIdx(["orderid", "order_id"]);
    const idxCompanyDepartment = getIdx(["companydepartment", "company_department"]);
    const idxRecognitionDate = getIdx(["recognitiondate", "recognition_date"]);
    const idxStatus = getIdx(["status"]);
    const idxDocumentType = getIdx(["documenttype", "document_type"]);
    const idxOriginalRecognitionId = getIdx(["originalrecognitionid", "original_recognition_id"]);
    const idxTotalAmount = getIdx(["totalamount", "total_amount"]);
    const idxTaxAmount = getIdx(["taxamount", "tax_amount"]);
    const idxMemo = getIdx(["memo"]);
    const idxPaymentStatus = getIdx(["paymentstatus", "payment_status"]);
    const idxPurchasePerson = getIdx([
      "purchasepersonemployeenumber",
      "purchase_person_employee_number",
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
    const clearedRecognitionIds = new Set<string>();
    const recognitionSortOrders = new Map<string, number>();

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

      // BUG-050: 行ごとに、取引先と元の発注の仕入先が一致することを確認する
      // (commit() より前に止めるため、1行でも異なれば1件も取り込まない)
      await assertPurchaseOrderPartnerMatches(
        this.repo,
        partnerId,
        getCellVal(idxOrderId),
        [getCellVal(idxSourceOrderItemId)],
        `CSVの仕入[${id}]: `,
      );

      if (!clearedRecognitionIds.has(id)) {
        await tx.repo.deleteRecognitionItems(id);
        clearedRecognitionIds.add(id);
        recognitionSortOrders.set(id, 0);

        const rawRecognitionDate = getCellVal(idxRecognitionDate);
        const rawStatus = getCellVal(idxStatus);
        const rawDocumentType = getCellVal(idxDocumentType);
        const rawTotal = getCellVal(idxTotalAmount);
        const rawTax = getCellVal(idxTaxAmount);

        await tx.repo.upsertRecognitionFromCsv({
          id,
          title: getCellVal(idxTitle),
          partnerId,
          orderId: getCellVal(idxOrderId),
          companyDepartment: getCellVal(idxCompanyDepartment),
          recognitionDate: rawRecognitionDate ? new Date(rawRecognitionDate) : new Date(),
          status: rawStatus || "DRAFT",
          documentType: rawDocumentType || "PURCHASE",
          originalRecognitionId: getCellVal(idxOriginalRecognitionId),
          totalAmount: rawTotal ? Number(rawTotal) : 0,
          taxAmount: rawTax ? Number(rawTax) : 0,
          memo: getCellVal(idxMemo),
          paymentStatus: getCellVal(idxPaymentStatus) || "UNPAID",
          purchasePersonEmployeeNumber: getCellVal(idxPurchasePerson),
          inputPersonEmployeeNumber: getCellVal(idxInputPerson) || opId,
          createdBy: opId,
          createdAt: new Date(),
          updatedBy: opId,
          updatedAt: new Date(),
        });
      }

      const itemId = getCellVal(idxItemId);
      if (itemId) {
        const currentSortOrder = recognitionSortOrders.get(id) || 0;
        const rawQty = getCellVal(idxQuantity);
        const rawPrice = getCellVal(idxUnitPrice);
        const qQty = rawQty ? Number(rawQty) : 1;
        const qPrice = rawPrice ? Number(rawPrice) : 0;

        const rawInputType = getCellVal(idxInputType);
        const normalizedInputType =
          rawInputType?.toUpperCase() === "MASTER" || rawInputType?.toUpperCase() === "DIRECT"
            ? rawInputType.toUpperCase()
            : null;

        await tx.repo.insertRecognitionItem(
          buildPurchaseRecognitionItemInsertRow(
            {
              itemId,
              itemName: getCellVal(idxItemName),
              inputType: normalizedInputType,
              sourceOrderItemId: getCellVal(idxSourceOrderItemId),
              quantity: qQty,
              unitPrice: qPrice,
              memo: getCellVal(idxItemMemo),
              unitCode: getCellVal(idxUnitCode),
              taxCategoryCode: getCellVal(idxTaxCategoryCode),
            },
            id,
            currentSortOrder,
          ),
        );

        recognitionSortOrders.set(id, currentSortOrder + 1);
      }
      count++;
    }
    await tx.commit();

    c.executionCtx.waitUntil(
      logAuditEvent(
        c,
        "BULK_IMPORT_PURCHASE_RECOGNITIONS_CSV",
        RESOURCE_KEY,
        "BULK_OPERATION",
        null,
        {
          processedCount: count,
        },
      ),
    );

    return {
      success: true,
      message: `CSVから ${clearedRecognitionIds.size} 件の仕入データ(総明細行数: ${count}行)をインポート・完全同期しました`,
    };
  }
}
