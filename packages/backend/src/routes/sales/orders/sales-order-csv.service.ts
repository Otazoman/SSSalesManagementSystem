import { Context } from "hono";
import { createLineIdChecker } from "../../../platform/csv/line-id";
import { SalesOrderRepository } from "./sales-order.repository";
import { RESOURCE_KEY } from "./sales-order-constants";
import { buildSalesOrderItemInsertRow } from "./sales-order-item-mapper";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import {
  WarehouseStockReservationRepository,
  reserveOrderItemsWarehouseAware,
} from "../../../platform/inventory/warehouse-stock-reservation.repository";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

// Item7: quote-csv.service.tsと同じ方針。sourceQuoteId/sourceQuoteItemId列を追加した以外は同型
export class SalesOrderCsvService {
  private repo: SalesOrderRepository;

  constructor(repo: SalesOrderRepository) {
    this.repo = repo;
  }

  async exportCsv(c: Context) {
    const rawData = await this.repo.findExportOrdersWithDetails();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_SALES_ORDERS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: rawData.length,
      }),
    );

    const headers = [
      "id",
      "title",
      "partnerId",
      "sourceQuoteId",
      "companyDepartment",
      "orderDate",
      "status",
      "totalAmount",
      "taxAmount",
      "memo",
      "terms",
      "updatedBy",
      "inputPersonEmployeeNumber",
      // 明細ID。売上のCSV(sourceOrderItemId)から受注明細を指すために使う。取り込み直しても同じIDになる
      "lineId",
      "itemId",
      "itemName",
      "sourceQuoteItemId",
      "inputType",
      "quantity",
      "unitPrice",
      "unitCode",
      "taxCategoryCode",
      "itemMemo",
    ];

    const rows = rawData.map((row) => {
      const o = row.sales_orders;
      const item = row.sales_order_items;

      const oDate = o.orderDate ? new Date(o.orderDate).toISOString().split("T")[0] : "";
      const itemIdVal = item?.itemId || "";
      const inputTypeVal = item?.inputType || "";
      const employeeNoVal = o.salesPersonEmployeeNumber || "";
      const inputPersonVal = o.inputPersonEmployeeNumber || "";

      return [
        csvField(`${o.id}`),
        csvField(o.title),
        csvField(`${o.partnerId}`),
        csvField(o.sourceQuoteId),
        csvField(o.companyDepartment),
        csvField(`${oDate}`),
        csvField(`${o.status}`),
        o.totalAmount ?? 0,
        o.taxAmount ?? 0,
        csvField(o.memo),
        csvField(o.terms),
        csvField(employeeNoVal),
        csvField(inputPersonVal),
        csvField(item?.id),
        csvField(`${itemIdVal}`),
        csvField(item?.itemName),
        csvField(item?.sourceQuoteItemId),
        csvField(inputTypeVal),
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
    const idxSourceQuoteId = getIdx(["sourcequoteid", "source_quote_id"]);
    const idxCompanyDepartment = getIdx(["companydepartment", "company_department", "department"]);
    const idxOrderDate = getIdx(["orderdate", "order_date"]);
    const idxStatus = getIdx(["status"]);
    const idxTotalAmount = getIdx(["totalamount", "total_amount"]);
    const idxTaxAmount = getIdx(["taxamount", "tax_amount"]);
    const idxMemo = getIdx(["memo"]);
    const idxTerms = getIdx(["terms"]);
    const idxUpdatedBy = getIdx(["updatedby", "updated_by"]);
    const idxInputPerson = getIdx(["inputpersonemployeenumber", "input_person_employee_number"]);
    const idxLineId = getIdx(["lineid", "line_id"]);
    const idxItemId = getIdx(["itemid", "item_id"]);
    const idxItemName = getIdx(["itemname", "item_name"]);
    const idxSourceQuoteItemId = getIdx(["sourcequoteitemid", "source_quote_item_id"]);
    const idxInputType = getIdx(["inputtype", "input_type"]);
    const idxQuantity = getIdx(["quantity"]);
    const idxUnitPrice = getIdx(["unitprice", "unit_price"]);
    const idxUnitCode = getIdx(["unitcode", "unit_code"]);
    const idxTaxCategoryCode = getIdx(["taxcategorycode", "tax_category_code"]);
    const idxItemMemo = getIdx(["itemmemo", "item_memo"]);

    let count = 0;
    const clearedOrderIds = new Set<string>();
    const checkLineId = createLineIdChecker("受注", (lineId) => this.repo.findOrderIdOfItem(lineId));
    const orderSortOrders = new Map<string, number>();
    // Item7残課題2-5フォローアップ: CSVで直接status=APPROVEDを指定した受注は、通常の
    // 承認申請フロー(submitForApproval)を経由しないため、そのままでは在庫引当が一切行われず
    // 在庫不足でもバックオーダーとして検知されない不整合があった。インポート後にこの一覧を元に
    // まとめて引当処理を行うことで、APIから確定した受注と同じ挙動になるよう揃える
    const approvedOrderIds = new Set<string>();
    // 追加要望対応: 既に出荷指示/出庫/売上計上が紐づく受注は、明細を削除しようとすると
    // DB側のFK制約違反で500エラーになっていた(再インポート時のdelete→再insertパターンが
    // 実運用が進んだ受注に対して安全でなかったため)。そのような受注はヘッダーのみ更新し、
    // 既存の明細行はそのまま保持してスキップする(データ消失より安全側に倒す)
    const itemsLockedOrderIds = new Set<string>();

    // BUG-049: 取込の書き込み(明細の削除に伴う引当の解放を含む)は記録だけして、1回の batch で書き込む
    // (途中で失敗した時に、一部の受注だけ取り込まれた状態にならないように)。在庫の引き当て直しは commit の後に行う
    const tx = recordWritesForBatch(this.repo);
    for (const cols of allLines.slice(1)) {
      if (cols.length <= idxId || !cols[idxId]) continue;
      const id = cols[idxId].trim();
      const partnerId = idxPartnerId !== -1 && cols[idxPartnerId] ? cols[idxPartnerId].trim() : "";
      if (!id || id === "id" || !partnerId) continue;

      const getCellVal = (idx: number) => {
        if (idx === -1 || idx >= cols.length) return null;
        const trimmed = cols[idx].trim();
        return trimmed === "" ? null : trimmed;
      };

      if (!clearedOrderIds.has(id)) {
        const existingItems = await this.repo.findOrderItems(id);
        const isLocked = await this.repo.hasDownstreamItemReferences(
          existingItems.map((item) => item.id),
        );
        if (isLocked) {
          itemsLockedOrderIds.add(id);
        } else {
          await tx.repo.deleteOrderItems(id);
        }
        clearedOrderIds.add(id);
        orderSortOrders.set(id, 0);

        const rawOrderDate = getCellVal(idxOrderDate);
        const rawStatus = getCellVal(idxStatus);
        const rawTotal = getCellVal(idxTotalAmount);
        const rawTax = getCellVal(idxTaxAmount);
        const salesPersonEmployeeNumber = getCellVal(idxUpdatedBy);
        const inputPersonEmployeeNumber = getCellVal(idxInputPerson) || opId;
        const resolvedStatus = rawStatus || "DRAFT";
        // 既存明細をロックした(=既に出荷/売上計上済みで在庫引当が別途成立済みの)受注は、
        // ここでの再引当処理の対象から除外する(二重引当を防ぐ)
        if (resolvedStatus === "APPROVED" && !isLocked) approvedOrderIds.add(id);

        await tx.repo.upsertOrderFromCsv({
          id,
          title: getCellVal(idxTitle),
          partnerId,
          sourceQuoteId: getCellVal(idxSourceQuoteId),
          companyDepartment: getCellVal(idxCompanyDepartment),
          orderDate: rawOrderDate ? new Date(rawOrderDate) : new Date(),
          status: resolvedStatus,
          totalAmount: rawTotal ? Number(rawTotal) : 0,
          taxAmount: rawTax ? Number(rawTax) : 0,
          memo: getCellVal(idxMemo),
          terms: getCellVal(idxTerms),
          salesPersonEmployeeNumber,
          inputPersonEmployeeNumber,
          createdBy: opId,
          createdAt: new Date(),
          updatedBy: opId,
          updatedAt: new Date(),
        });
      }

      const itemId = getCellVal(idxItemId);
      if (itemId && !itemsLockedOrderIds.has(id)) {
        const lineId = getCellVal(idxLineId);
        await checkLineId(lineId, id);
        const currentSortOrder = orderSortOrders.get(id) || 0;
        const rawQty = getCellVal(idxQuantity);
        const rawPrice = getCellVal(idxUnitPrice);
        const oQty = rawQty ? Number(rawQty) : 1;
        const oPrice = rawPrice ? Number(rawPrice) : 0;

        const rawInputType = getCellVal(idxInputType);
        const normalizedInputType =
          rawInputType?.toUpperCase() === "MASTER" || rawInputType?.toUpperCase() === "DIRECT"
            ? rawInputType.toUpperCase()
            : null;

        await tx.repo.insertOrderItem(
          buildSalesOrderItemInsertRow(
            {
              lineId,
              itemId,
              itemName: getCellVal(idxItemName),
              inputType: normalizedInputType,
              quantity: oQty,
              unitPrice: oPrice,
              costPrice: null,
              memo: getCellVal(idxItemMemo),
              unitCode: getCellVal(idxUnitCode),
              taxCategoryCode: getCellVal(idxTaxCategoryCode),
              sourceQuoteItemId: getCellVal(idxSourceQuoteItemId),
            },
            id,
            currentSortOrder,
          ),
        );

        orderSortOrders.set(id, currentSortOrder + 1);
      }
      count++;
    }
    await tx.commit();

    // Item7残課題2-5フォローアップ: status=APPROVEDで確定した受注は、通常の承認フローと同じく
    // 倉庫単位で在庫を引き当てる(与信警告と同じ非ブロッキング方針、不足分はbackorderedQuantityへ)
    if (approvedOrderIds.size > 0) {
      const warehouseReservationRepo = new WarehouseStockReservationRepository(c.env.DB);
      for (const orderId of approvedOrderIds) {
        const orderItems = await this.repo.findOrderItems(orderId);
        const reservationResults = await reserveOrderItemsWarehouseAware(
          warehouseReservationRepo,
          orderItems,
          new Date(),
        );
        for (const [orderItemId, result] of reservationResults) {
          await this.repo.updateOrderItemBackorder(orderItemId, result.backorderedQuantity);
        }
      }
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_SALES_ORDERS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
        processedCount: count,
      }),
    );

    const lockedNote =
      itemsLockedOrderIds.size > 0
        ? `(うち${itemsLockedOrderIds.size}件は既に出荷指示/出庫実績/売上計上と紐づいているため、ヘッダー情報のみ更新し明細は変更していません: ${Array.from(itemsLockedOrderIds).join(", ")})`
        : "";

    return {
      success: true,
      message: `CSVから ${clearedOrderIds.size} 件の受注データ(総明細行数: ${count}行)をインポート・完全同期しました${lockedNote}`,
    };
  }
}
