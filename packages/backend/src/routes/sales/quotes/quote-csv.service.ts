import { Context } from "hono";
import { createLineIdChecker } from "../../../platform/csv/line-id";
import { QuoteRepository } from "./quote.repository";
import { RESOURCE_KEY } from "./quote-constants";
import { buildQuoteItemInsertRow } from "./quote-item-mapper";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

// Item4-f: quote.service.tsから分割。CSVエクスポート・インポートを担当
export class QuoteCsvService {
  private repo: QuoteRepository;

  constructor(repo: QuoteRepository) {
    this.repo = repo;
  }

  // 2. CSV エクスポート
  async exportCsv(c: Context) {
    const rawData = await this.repo.findExportQuotesWithDetails();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_QUOTES_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      recordCount: rawData.length,
    }),
    );

    const headers = [
      "id",
      "title",
      "partnerId", // customerId -> partnerId
      "companyDepartment",
      "quoteDate",
      "validUntil",
      "status",
      "totalAmount",
      "taxAmount",
      "memo",
      "terms",
      "updatedBy",
      "inputPersonEmployeeNumber",
      // 明細ID。受注のCSV(sourceQuoteItemId)から見積明細を指すために使う。取り込み直しても同じIDになる
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
      const q = row.quotes;
      const item = row.quote_items;

      const qDate = q.quoteDate
        ? new Date(q.quoteDate).toISOString().split("T")[0]
        : "";
      const vUntil = q.validUntil
        ? new Date(q.validUntil).toISOString().split("T")[0]
        : "";
      const itemIdVal = item?.itemId || "";
      // Item4-d: 以前はitemIdの文字列プレフィックス("PROD"始まり)推測で判定しており、
      // 実際の商品コード体系と合わず常にDIRECT扱いになる不具合があった。保存済みの値を
      // そのまま使う(この修正より前に保存された行はinputType未設定のため空欄になる)
      const inputTypeVal = item?.inputType || "";
      // Item4-d: CSVの"updatedBy"列は実際には「自社担当者」を表す(監査用のupdatedByとは別)。
      // 列名はCSVフォーマット互換のため維持し、値のみsalesPersonEmployeeNumberに修正
      const employeeNoVal = q.salesPersonEmployeeNumber || "";
      const inputPersonVal = q.inputPersonEmployeeNumber || "";

      return [
        csvField(`${q.id}`),
        csvField(q.title),
        csvField(`${q.partnerId}`), // q.customerId -> q.partnerId
        csvField(q.companyDepartment),
        csvField(`${qDate}`),
        csvField(`${vUntil}`),
        csvField(`${q.status}`),
        q.totalAmount ?? 0,
        q.taxAmount ?? 0,
        csvField(q.memo),
        csvField(q.terms),
        csvField(employeeNoVal),
        csvField(inputPersonVal),
        csvField(item?.id),
        csvField(`${itemIdVal}`),
        csvField(item?.itemName),
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

  // 3. CSV インポート
  async bulkImportCsv(c: Context, file: File) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const text = await file.text();

    const allLines = parseCsv(text);
    if (allLines.length <= 1) {
      return {
        success: true,
        message: "同期する有効なデータがありませんでした",
      };
    }

    const headers = allLines[0].map((h) => h.toLowerCase().trim());
    const getIdx = (keys: string[]) =>
      headers.findIndex((h) => keys.map((k) => k.toLowerCase()).includes(h));

    const idxId = getIdx(["id"]);
    const idxTitle = getIdx(["title"]);
    const idxPartnerId = getIdx([
      "partnerid",
      "partner_id",
      "customerid",
      "customer_id",
    ]);
    const idxCompanyDepartment = getIdx([
      "companydepartment",
      "company_department",
      "department",
    ]);
    const idxQuoteDate = getIdx(["quotedate", "quote_date"]);
    const idxValidUntil = getIdx(["validuntil", "valid_until"]);
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
    const idxInputType = getIdx(["inputtype", "input_type"]);
    const idxQuantity = getIdx(["quantity"]);
    const idxUnitPrice = getIdx(["unitprice", "unit_price"]);
    const idxUnitCode = getIdx(["unitcode", "unit_code"]);
    const idxTaxCategoryCode = getIdx(["taxcategorycode", "tax_category_code"]);
    const idxItemMemo = getIdx(["itemmemo", "item_memo"]);

    let count = 0;
    const clearedQuoteIds = new Set<string>();
    // 受注から明細を参照されている見積は、明細を入れ替えない(受注との明細のつながりを保つ)
    const itemsLockedQuoteIds = new Set<string>();
    const checkLineId = createLineIdChecker("見積", (lineId) => this.repo.findQuoteIdOfItem(lineId));
    const quoteSortOrders = new Map<string, number>();

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    for (const cols of allLines.slice(1)) {
      if (cols.length <= idxId || !cols[idxId]) continue;
      const id = cols[idxId].trim();
      const partnerId =
        idxPartnerId !== -1 && cols[idxPartnerId]
          ? cols[idxPartnerId].trim()
          : "";
      if (!id || id === "id" || !partnerId) continue;

      const getCellVal = (idx: number) => {
        if (idx === -1 || idx >= cols.length) return null;
        const trimmed = cols[idx].trim();
        return trimmed === "" ? null : trimmed;
      };

      if (!clearedQuoteIds.has(id)) {
        const existingItems = await this.repo.findQuoteItems(id);
        if (await this.repo.hasDownstreamItemReferences(existingItems.map((item: { id: string }) => item.id))) {
          itemsLockedQuoteIds.add(id);
        } else {
          await tx.repo.deleteQuoteItems(id);
        }
        clearedQuoteIds.add(id);
        quoteSortOrders.set(id, 0);

        const rawQuoteDate = getCellVal(idxQuoteDate);
        const rawValidUntil = getCellVal(idxValidUntil);
        const rawStatus = getCellVal(idxStatus);
        const rawTotal = getCellVal(idxTotalAmount);
        const rawTax = getCellVal(idxTaxAmount);

        // Item4-d: CSVの"updatedBy"列は実際には「自社担当者」を表す(監査用のupdatedByとは別)。
        // 列名はCSVフォーマット互換のため維持し、値はsalesPersonEmployeeNumberへそのまま保存する
        // (他のemployeeNumber列と同様FK検証は行わない)。createdBy/updatedByは常に
        // インポートを実行した操作者(opId)とする(Item1の全社統一方針)
        const salesPersonEmployeeNumber = getCellVal(idxUpdatedBy);
        const inputPersonEmployeeNumber = getCellVal(idxInputPerson) || opId;

        await tx.repo.upsertQuoteFromCsv({
          id,
          title: getCellVal(idxTitle),
          partnerId, // customerId -> partnerId
          companyDepartment: getCellVal(idxCompanyDepartment),
          quoteDate: rawQuoteDate ? new Date(rawQuoteDate) : new Date(),
          validUntil: rawValidUntil ? new Date(rawValidUntil) : null,
          status: rawStatus || "DRAFT",
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
      if (itemId && !itemsLockedQuoteIds.has(id)) {
        const lineId = getCellVal(idxLineId);
        await checkLineId(lineId, id);
        const currentSortOrder = quoteSortOrders.get(id) || 0;
        const rawQty = getCellVal(idxQuantity);
        const rawPrice = getCellVal(idxUnitPrice);
        const qQty = rawQty ? Number(rawQty) : 1;
        const qPrice = rawPrice ? Number(rawPrice) : 0;

        // Item4-d: MASTER/DIRECTの判定はitemIdの文字列推測ではなく、CSVのinputType列を
        // そのまま保存する(無指定時はitemsマスタに存在するIDならMASTER、それ以外はDIRECT扱い)
        const rawInputType = getCellVal(idxInputType);
        const normalizedInputType =
          rawInputType?.toUpperCase() === "MASTER" ||
          rawInputType?.toUpperCase() === "DIRECT"
            ? rawInputType.toUpperCase()
            : null;

        await tx.repo.insertQuoteItem(
          buildQuoteItemInsertRow(
            {
              lineId,
              itemId,
              itemName: getCellVal(idxItemName),
              inputType: normalizedInputType,
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

        quoteSortOrders.set(id, currentSortOrder + 1);
      }
      count++;
    }
    await tx.commit();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_QUOTES_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
      processedCount: count,
    }),
    );

    return {
      success: true,
      message: `CSVから ${clearedQuoteIds.size} 件の見積データ(総明細行数: ${count}行)をインポート・完全同期しました`,
    };
  }
}
