import { Context } from "hono";
import { PurchaseRequisitionRepository } from "./purchase-requisition.repository";
import { RESOURCE_KEY } from "./purchase-requisition-constants";
import { buildPurchaseRequisitionItemInsertRow } from "./purchase-requisition-item-mapper";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

// quote-csv.service.tsと同じ方針。CSVエクスポート・インポートを担当
export class PurchaseRequisitionCsvService {
  private repo: PurchaseRequisitionRepository;

  constructor(repo: PurchaseRequisitionRepository) {
    this.repo = repo;
  }

  async exportCsv(c: Context) {
    const rawData = await this.repo.findExportRequisitionsWithDetails();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_PURCHASE_REQUISITIONS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: rawData.length,
      }),
    );

    const headers = [
      "id",
      "title",
      "departmentSurrogateId",
      "applicantId",
      "inputPersonEmployeeNumber",
      "requestType",
      "status",
      "partnerId",
      "partnerName",
      "partnerInputType",
      "projectId",
      "totalAmount",
      "taxAmount",
      "memo",
      "itemId",
      "itemName",
      "inputType",
      "quantity",
      "estimatedUnitPrice",
      "unitCode",
      "taxCategoryCode",
      "itemMemo",
    ];

    const rows = rawData.map((row) => {
      const r = row.purchase_requests;
      const item = row.purchase_request_items;

      return [
        csvField(`${r.id}`),
        csvField(r.title),
        csvField(`${r.departmentSurrogateId}`),
        csvField(`${r.applicantId}`),
        csvField(`${r.inputPersonEmployeeNumber || ""}`),
        csvField(`${r.requestType}`),
        csvField(`${r.status}`),
        csvField(`${r.partnerId || ""}`),
        csvField(r.partnerName),
        csvField(`${r.partnerInputType || "MASTER"}`),
        csvField(`${r.projectId || ""}`),
        r.totalAmount ?? 0,
        r.taxAmount ?? 0,
        csvField(r.memo),
        csvField(`${item?.itemId || ""}`),
        csvField(item?.itemName),
        csvField(`${item?.inputType || "MASTER"}`),
        item?.quantity ?? 0,
        item?.estimatedUnitPrice ?? 0,
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
    const idxDept = getIdx(["departmentsurrogateid", "department_surrogate_id"]);
    const idxApplicant = getIdx(["applicantid", "applicant_id"]);
    const idxInputPerson = getIdx(["inputpersonemployeenumber", "input_person_employee_number"]);
    const idxRequestType = getIdx(["requesttype", "request_type"]);
    const idxStatus = getIdx(["status"]);
    const idxPartnerId = getIdx(["partnerid", "partner_id"]);
    const idxPartnerName = getIdx(["partnername", "partner_name"]);
    const idxPartnerInputType = getIdx(["partnerinputtype", "partner_input_type"]);
    const idxProjectId = getIdx(["projectid", "project_id"]);
    const idxTotalAmount = getIdx(["totalamount", "total_amount"]);
    const idxTaxAmount = getIdx(["taxamount", "tax_amount"]);
    const idxMemo = getIdx(["memo"]);
    const idxItemId = getIdx(["itemid", "item_id"]);
    const idxItemName = getIdx(["itemname", "item_name"]);
    const idxInputType = getIdx(["inputtype", "input_type"]);
    const idxQuantity = getIdx(["quantity"]);
    const idxUnitPrice = getIdx(["estimatedunitprice", "estimated_unit_price"]);
    const idxUnitCode = getIdx(["unitcode", "unit_code"]);
    const idxTaxCategoryCode = getIdx(["taxcategorycode", "tax_category_code"]);
    const idxItemMemo = getIdx(["itemmemo", "item_memo"]);

    let count = 0;
    const clearedIds = new Set<string>();
    const skippedIds = new Set<string>();
    const unresolvedDepartments = new Set<string>();
    const deptCache = new Map<string, string | null>();
    // 購買申請IDごとの明細の並び順。CSVの行順をそのままsortOrderへ反映する
    // (明細取得がsortOrder昇順で読むため、0固定だと複数明細の並びが不定になる)
    const nextSortOrderByRequestId = new Map<string, number>();

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    for (const cols of allLines.slice(1)) {
      if (cols.length <= idxId || !cols[idxId]) continue;
      const id = cols[idxId].trim();
      const rawDept =
        idxDept !== -1 && cols[idxDept] ? cols[idxDept].trim() : "";
      if (!id || id === "id" || !rawDept) continue;
      if (skippedIds.has(id)) continue;

      const getCellVal = (idx: number) => {
        if (idx === -1 || idx >= cols.length) return null;
        const trimmed = cols[idx].trim();
        return trimmed === "" ? null : trimmed;
      };

      if (!clearedIds.has(id)) {
        // departmentSurrogateId列は「部署コード(departments.id)」「surrogateId」の
        // どちらで渡されても解決できるようにする(CSV作成時にsurrogateIdを事前調査する
        // 手間をなくすための後方互換つき変換)
        let resolvedDept = deptCache.get(rawDept);
        if (resolvedDept === undefined) {
          resolvedDept = await this.repo.resolveDepartmentSurrogateId(rawDept);
          deptCache.set(rawDept, resolvedDept);
        }
        if (!resolvedDept) {
          skippedIds.add(id);
          unresolvedDepartments.add(rawDept);
          continue;
        }

        await tx.repo.deleteRequisitionItems(id);
        clearedIds.add(id);

        const rawTotal = getCellVal(idxTotalAmount);
        const rawTax = getCellVal(idxTaxAmount);
        const rawStatus = getCellVal(idxStatus);
        const rawRequestType = getCellVal(idxRequestType);
        const rawPartnerInputType = getCellVal(idxPartnerInputType);
        const applicantId = getCellVal(idxApplicant) || opId;

        await tx.repo.upsertRequisitionFromCsv({
          id,
          title: getCellVal(idxTitle) || "",
          departmentSurrogateId: resolvedDept,
          applicantId,
          inputPersonEmployeeNumber: getCellVal(idxInputPerson) || opId,
          requestType: rawRequestType || "ONE_TIME",
          status: rawStatus || "DRAFT",
          partnerId: getCellVal(idxPartnerId),
          partnerName: getCellVal(idxPartnerName),
          partnerInputType: rawPartnerInputType === "DIRECT" ? "DIRECT" : "MASTER",
          projectId: getCellVal(idxProjectId),
          totalAmount: rawTotal ? Number(rawTotal) : 0,
          taxAmount: rawTax ? Number(rawTax) : 0,
          memo: getCellVal(idxMemo),
          createdBy: opId,
          createdAt: new Date(),
          updatedBy: opId,
          updatedAt: new Date(),
        });
      }

      const itemId = getCellVal(idxItemId);
      if (itemId) {
        const rawQty = getCellVal(idxQuantity);
        const rawPrice = getCellVal(idxUnitPrice);
        const rawInputType = getCellVal(idxInputType);

        const sortOrder = nextSortOrderByRequestId.get(id) ?? 0;
        nextSortOrderByRequestId.set(id, sortOrder + 1);

        await tx.repo.insertRequisitionItem(
          buildPurchaseRequisitionItemInsertRow(
            {
              itemId,
              itemName: getCellVal(idxItemName),
              inputType: rawInputType === "DIRECT" ? "DIRECT" : "MASTER",
              quantity: rawQty ? Number(rawQty) : 1,
              estimatedUnitPrice: rawPrice ? Number(rawPrice) : 0,
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
      logAuditEvent(c, "BULK_IMPORT_PURCHASE_REQUISITIONS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
        processedCount: count,
        skippedCount: skippedIds.size,
        unresolvedDepartments: Array.from(unresolvedDepartments),
      }),
    );

    const skippedNote =
      unresolvedDepartments.size > 0
        ? `(部署コード解決不可のため ${skippedIds.size} 件をスキップ: ${Array.from(unresolvedDepartments).join(", ")})`
        : "";

    return {
      success: true,
      message: `CSVから ${clearedIds.size} 件の購買申請データ(総明細行数: ${count}行)をインポート・完全同期しました${skippedNote}`,
    };
  }
}
