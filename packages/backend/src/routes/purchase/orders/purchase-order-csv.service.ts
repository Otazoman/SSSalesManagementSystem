import { Context } from "hono";
import { createLineIdChecker } from "../../../platform/csv/line-id";
import { PurchaseOrderRepository } from "./purchase-order.repository";
import { RESOURCE_KEY } from "./purchase-order-constants";
import { buildPurchaseOrderItemInsertRow } from "./purchase-order-item-mapper";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

// purchase-requisition-csv.service.tsと同じ方針。CSVエクスポート・インポートを担当
export class PurchaseOrderCsvService {
  private repo: PurchaseOrderRepository;

  constructor(repo: PurchaseOrderRepository) {
    this.repo = repo;
  }

  async exportCsv(c: Context) {
    const rawData = await this.repo.findExportOrdersWithDetails();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_PURCHASE_ORDERS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: rawData.length,
      }),
    );

    const headers = [
      "id",
      "requestId",
      "partnerId",
      "title",
      "orderDate",
      "status",
      "projectId",
      "totalAmount",
      "taxAmount",
      "memo",
      "companyName",
      "companyDepartment",
      "companyAddress",
      "companyTel",
      "companyFax",
      "deliveryDate",
      "deliveryPlace",
      "paymentTerms",
      "purchasePersonEmployeeNumber",
      "inputPersonEmployeeNumber",
      "isPaid",
      // 明細ID。仕入のCSV(sourceOrderItemId)から発注明細を指すために使う。取り込み直しても同じIDになる
      "lineId",
      "itemId",
      "itemName",
      "inputType",
      "quantity",
      "unitPrice",
      "unitCode",
      "taxCategoryCode",
      "itemMemo",
    ];

    const rows = rawData.map((row) => {
      const o = row.orders;
      const item = row.order_items;

      return [
        csvField(`${o.id}`),
        csvField(`${o.requestId || ""}`),
        csvField(`${o.partnerId || ""}`),
        csvField(o.title),
        csvField(`${o.orderDate ? new Date(o.orderDate).toISOString().split("T")[0] : ""}`),
        csvField(`${o.status}`),
        csvField(`${o.projectId || ""}`),
        o.totalAmount ?? 0,
        o.taxAmount ?? 0,
        csvField(o.memo),
        csvField(o.companyName),
        csvField(o.companyDepartment),
        csvField(o.companyAddress),
        csvField(`${o.companyTel || ""}`),
        csvField(`${o.companyFax || ""}`),
        csvField(`${o.deliveryDate || ""}`),
        csvField(o.deliveryPlace),
        csvField(o.paymentTerms),
        csvField(`${o.purchasePersonEmployeeNumber || ""}`),
        csvField(`${o.inputPersonEmployeeNumber || ""}`),
        o.isPaid ? "TRUE" : "FALSE",
        csvField(item?.id),
        csvField(`${item?.itemId || ""}`),
        csvField(item?.itemName),
        csvField(`${item?.inputType || "MASTER"}`),
        item?.quantity ?? 0,
        item?.unitPrice ?? 0,
        csvField(`${item?.unitCode || ""}`),
        csvField(`${item?.taxCategoryCode || ""}`),
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
    const idxRequestId = getIdx(["requestid", "request_id"]);
    const idxPartnerId = getIdx(["partnerid", "partner_id"]);
    const idxTitle = getIdx(["title"]);
    const idxOrderDate = getIdx(["orderdate", "order_date"]);
    const idxStatus = getIdx(["status"]);
    const idxProjectId = getIdx(["projectid", "project_id"]);
    const idxTotalAmount = getIdx(["totalamount", "total_amount"]);
    const idxTaxAmount = getIdx(["taxamount", "tax_amount"]);
    const idxMemo = getIdx(["memo"]);
    const idxCompanyName = getIdx(["companyname", "company_name"]);
    const idxCompanyDepartment = getIdx(["companydepartment", "company_department"]);
    const idxCompanyAddress = getIdx(["companyaddress", "company_address"]);
    const idxCompanyTel = getIdx(["companytel", "company_tel"]);
    const idxCompanyFax = getIdx(["companyfax", "company_fax"]);
    const idxDeliveryDate = getIdx(["deliverydate", "delivery_date"]);
    const idxDeliveryPlace = getIdx(["deliveryplace", "delivery_place"]);
    const idxPaymentTerms = getIdx(["paymentterms", "payment_terms"]);
    const idxPurchasePerson = getIdx([
      "purchasepersonemployeenumber",
      "purchase_person_employee_number",
    ]);
    const idxInputPerson = getIdx(["inputpersonemployeenumber", "input_person_employee_number"]);
    const idxIsPaid = getIdx(["ispaid", "is_paid"]);
    const idxLineId = getIdx(["lineid", "line_id"]);
    const idxItemId = getIdx(["itemid", "item_id"]);
    const idxItemName = getIdx(["itemname", "item_name"]);
    const idxInputType = getIdx(["inputtype", "input_type"]);
    const idxQuantity = getIdx(["quantity"]);
    const idxUnitPrice = getIdx(["unitprice", "unit_price"]);
    const idxUnitCode = getIdx(["unitcode", "unit_code"]);
    const idxTaxCategoryCode = getIdx(["taxcategorycode", "tax_category_code"]);
    const idxItemMemo = getIdx(["itemmemo", "item_memo"]);

    let count = 0;
    const clearedIds = new Set<string>();
    // 発注IDごとの明細の並び順。CSVの行順をそのままsortOrderへ反映する
    // (findOrderItemsがsortOrder昇順で読むため、0固定だと複数明細の並びが不定になる)
    const nextSortOrderByOrderId = new Map<string, number>();

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    // 仕入・入庫などから明細を参照されている発注は、明細を入れ替えない(消すとFK制約で取込全体が失敗するため)
    const itemsLockedOrderIds = new Set<string>();
    const checkLineId = createLineIdChecker("発注", (lineId) => this.repo.findOrderIdOfItem(lineId));
    for (const cols of allLines.slice(1)) {
      if (cols.length <= idxId || !cols[idxId]) continue;
      const id = cols[idxId].trim();
      if (!id || id === "id") continue;

      const getCellVal = (idx: number) => {
        if (idx === -1 || idx >= cols.length) return null;
        const trimmed = cols[idx].trim();
        return trimmed === "" ? null : trimmed;
      };

      if (!clearedIds.has(id)) {
        const existingItems = await this.repo.findOrderItems(id);
        if (await this.repo.hasDownstreamItemReferences(existingItems.map((item: { id: string }) => item.id))) {
          itemsLockedOrderIds.add(id);
        } else {
          await tx.repo.deleteOrderItems(id);
        }
        clearedIds.add(id);

        const rawTotal = getCellVal(idxTotalAmount);
        const rawTax = getCellVal(idxTaxAmount);
        const rawStatus = getCellVal(idxStatus);
        const rawOrderDate = getCellVal(idxOrderDate);
        const rawIsPaid = getCellVal(idxIsPaid);

        await tx.repo.upsertOrderFromCsv({
          id,
          requestId: getCellVal(idxRequestId),
          partnerId: getCellVal(idxPartnerId),
          title: getCellVal(idxTitle),
          orderDate: rawOrderDate ? new Date(rawOrderDate) : new Date(),
          status: rawStatus || "DRAFT",
          projectId: getCellVal(idxProjectId),
          totalAmount: rawTotal ? Number(rawTotal) : 0,
          taxAmount: rawTax ? Number(rawTax) : 0,
          memo: getCellVal(idxMemo),
          companyName: getCellVal(idxCompanyName),
          companyDepartment: getCellVal(idxCompanyDepartment),
          companyAddress: getCellVal(idxCompanyAddress),
          companyTel: getCellVal(idxCompanyTel),
          companyFax: getCellVal(idxCompanyFax),
          deliveryDate: getCellVal(idxDeliveryDate),
          deliveryPlace: getCellVal(idxDeliveryPlace),
          paymentTerms: getCellVal(idxPaymentTerms),
          purchasePersonEmployeeNumber: getCellVal(idxPurchasePerson) || opId,
          inputPersonEmployeeNumber: getCellVal(idxInputPerson) || opId,
          isPaid: rawIsPaid ? rawIsPaid.toUpperCase() === "TRUE" : false,
          paidAt: null,
          createdBy: opId,
          createdAt: new Date(),
          updatedBy: opId,
          updatedAt: new Date(),
        });
      }

      const itemId = getCellVal(idxItemId);
      const itemName = getCellVal(idxItemName);
      if ((itemId || itemName) && !itemsLockedOrderIds.has(id)) {
        const lineId = getCellVal(idxLineId);
        await checkLineId(lineId, id);
        const rawQty = getCellVal(idxQuantity);
        const rawPrice = getCellVal(idxUnitPrice);
        const rawInputType = getCellVal(idxInputType);

        const sortOrder = nextSortOrderByOrderId.get(id) ?? 0;
        nextSortOrderByOrderId.set(id, sortOrder + 1);

        await tx.repo.insertOrderItem(
          buildPurchaseOrderItemInsertRow(
            {
              lineId,
              itemId: itemId || "",
              itemName,
              inputType: rawInputType === "DIRECT" ? "DIRECT" : "MASTER",
              quantity: rawQty ? Number(rawQty) : 1,
              unitPrice: rawPrice ? Number(rawPrice) : 0,
              unitCode: getCellVal(idxUnitCode),
              taxCategoryCode: getCellVal(idxTaxCategoryCode),
              memo: getCellVal(idxItemMemo),
            },
            id,
            sortOrder,
          ),
        );
      }
      count++;
    }
    await tx.commit();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_PURCHASE_ORDERS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
        processedCount: count,
      }),
    );

    return {
      success: true,
      message: `CSVから ${clearedIds.size} 件の発注データ(総明細行数: ${count}行)をインポート・完全同期しました`,
    };
  }
}
