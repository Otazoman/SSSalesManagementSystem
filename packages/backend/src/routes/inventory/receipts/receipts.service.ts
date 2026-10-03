import { Context } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { ReceiptsRepository } from "./receipts.repository";
import { CreateReceiptInput, GetReceiptsQuery, createReceiptSchema } from "./receipts.schema";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { StocksService } from "../stocks/stocks.service";
import { ProductsRepository } from "../../master/products/products.repository";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { PartnersRepository } from "../../master/partners/partners.repository";
import { ReceiptInstructionsRepository } from "../receipt-instructions/receipt-instructions.repository";
import { LocationsRepository } from "../../master/locations/locations.repository";
import { AccountsRepository } from "../../master/accounts/accounts.repository";
import { PurchaseOrderRepository } from "../../purchase/orders/purchase-order.repository";
import { PurchaseOrderReceiptService } from "../../purchase/orders/purchase-order-receipt.service";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import {
  isReceivingWorkflowGloballyEnabled,
  isReceivingResultWorkflowGloballyEnabled,
} from "../../../workflow-engine/settings";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "inventory_stock";

export class ReceiptsService {
  constructor(private repo: ReceiptsRepository) {}

  async listReceipts(
    searchParams: GetReceiptsQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.findHeadersPage(searchParams, params, sort),
      this.repo.countHeaders(searchParams),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async getReceiptDetail(id: string) {
    const header = await this.repo.findHeaderById(id);
    if (!header) throw new NotFoundError("対象の入庫が見つかりません");
    const items = await this.repo.findItemsByHeaderId(id);
    // 検収書発行: 発行済みPDF(複数バージョン管理)の一覧もあわせて返す
    const attachments = await this.repo.findAttachmentsByReceiptId(id);
    return { header, items, attachments };
  }

  // 入出庫履歴一覧のCSV出力(検索条件に一致する全件、1行1明細のフラット形式)
  async generateCsv(searchParams: GetReceiptsQuery) {
    const rows = await this.repo.findAllForCsv(searchParams);
    const headers = [
      "headerId",
      "receivedDate",
      "supplierInvoiceNumber",
      "status",
      "memo",
      "createdBy",
      "createdAt",
      "itemId",
      "warehouseId",
      "locationId",
      "lotNumber",
      "quantity",
      "accountCode",
      "inspectionStatus",
      "partnerId",
      "receiptInstructionId",
    ];
    const csvRows = rows.map((r: any) =>
      [
        csvField(r.headerId),
        csvField(r.receivedDate ? new Date(r.receivedDate).toISOString().slice(0, 10) : ""),
        csvField(r.supplierInvoiceNumber),
        csvField(r.status),
        csvField(r.headerMemo),
        csvField(r.createdBy),
        csvField(r.createdAt ? new Date(r.createdAt).toISOString() : ""),
        csvField(r.itemId),
        csvField(r.warehouseId),
        csvField(r.locationId),
        csvField(r.lotNumber),
        csvField(r.receivedQuantity),
        csvField(r.accountCode),
        csvField(r.inspectionStatus),
        csvField(r.partnerId),
        csvField(r.receiptInstructionId),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, csvRows));
  }

  // CSV一括登録: generateCsv()が出力した形式をそのまま再取込できるようにするため、
  // headerId列があればそれでグルーピングして複数入庫として登録する(1つのCSVエクスポートに
  // 含まれる複数件の入庫履歴を、そのまま再インポートすると同じ件数の入庫として復元される)。
  // headerId列が無い手作成CSV(単純な一括登録用)の場合は、ファイル全体を1件の入庫として扱う
  // (ヘッダー項目は先頭明細行の値を使う)。既存のcreateReceipt()をそのまま呼ぶことで、
  // 商品/倉庫/ロケーション検証・承認要否判定・在庫反映等のロジックを再利用する
  async bulkImportCsv(c: Context<{ Bindings: Env }>, csvData: string) {
    const allRows = parseCsv(csvData);
    if (allRows.length <= 1) {
      throw new BadRequestError("CSVにデータ行が含まれていません");
    }

    const header = allRows[0].map((h) => h.trim());
    const idxHeaderId = header.indexOf("headerId");
    const idxReceivedDate = header.indexOf("receivedDate");
    const idxSupplierInvoiceNumber = header.indexOf("supplierInvoiceNumber");
    const idxMemo = header.indexOf("memo");
    const idxItemId = header.indexOf("itemId");
    const idxWarehouseId = header.indexOf("warehouseId");
    const idxLocationId = header.indexOf("locationId");
    const idxLotNumber = header.indexOf("lotNumber");
    const idxQuantity = header.indexOf("quantity");
    const idxAccountCode = header.indexOf("accountCode");
    const idxInspectionStatus = header.indexOf("inspectionStatus");
    const idxPartnerId = header.indexOf("partnerId");
    const idxReceiptInstructionId = header.indexOf("receiptInstructionId");

    if (
      idxReceivedDate === -1 ||
      idxItemId === -1 ||
      idxWarehouseId === -1 ||
      idxLocationId === -1 ||
      idxQuantity === -1
    ) {
      throw new BadRequestError(
        "CSVに必要な列(receivedDate, itemId, warehouseId, locationId, quantity)がありません",
      );
    }

    const dataRows = allRows.slice(1);
    const groups = new Map<string, string[][]>();
    dataRows.forEach((cols, index) => {
      const groupKey = idxHeaderId !== -1 ? cols[idxHeaderId] || `__row${index}` : "__single__";
      const group = groups.get(groupKey);
      if (group) group.push(cols);
      else groups.set(groupKey, [cols]);
    });

    let importedCount = 0;
    let lastHeaderId = "";
    for (const rows of groups.values()) {
      const items = rows.map((cols) => ({
        itemId: cols[idxItemId],
        warehouseId: cols[idxWarehouseId],
        locationId: cols[idxLocationId],
        lotNumber: idxLotNumber !== -1 ? cols[idxLotNumber] || "NONE" : "NONE",
        quantity: Number(cols[idxQuantity]),
        accountCode: idxAccountCode !== -1 ? cols[idxAccountCode] || null : null,
        inspectionStatus:
          idxInspectionStatus !== -1 ? cols[idxInspectionStatus] || "PASSED" : "PASSED",
      }));

      const input = v.parse(createReceiptSchema, {
        receivedDate: rows[0][idxReceivedDate],
        supplierInvoiceNumber:
          idxSupplierInvoiceNumber !== -1 ? rows[0][idxSupplierInvoiceNumber] || null : null,
        memo: idxMemo !== -1 ? rows[0][idxMemo] || null : null,
        items,
        partnerId: idxPartnerId !== -1 ? rows[0][idxPartnerId] || null : null,
        receiptInstructionId:
          idxReceiptInstructionId !== -1 ? rows[0][idxReceiptInstructionId] || null : null,
      });

      const result = await this.createReceipt(c, input);
      importedCount += 1;
      lastHeaderId = result.headerId;
    }

    return {
      success: true,
      message: `CSVから ${importedCount} 件の入庫を登録しました`,
      headerId: lastHeaderId,
    };
  }

  // createReceipt/resubmitReceiptの両方から呼ぶ共通の明細検証+勘定科目解決ロジック。
  // Item6 Phase6-4: 明細の倉庫種別(INTERNAL/EXTERNAL)もあわせて返し、呼び出し元が
  // 参照する承認フラグ(自社入庫承認 or 外部倉庫入荷実績反映承認)を選べるようにする。
  // 1伝票内で倉庫種別が混在すると承認フラグの判定が一意にできないため、混在時はエラーとする。
  private async validateAndResolveItems(c: Context<{ Bindings: Env }>, input: CreateReceiptInput) {
    const productsRepo = new ProductsRepository(c.env.DB);
    const warehousesRepo = new WarehousesRepository(c.env.DB);
    const locationsRepo = new LocationsRepository(c.env.DB);
    const accountsRepo = new AccountsRepository(c.env.DB);

    if (input.partnerId) {
      const partnersRepo = new PartnersRepository(c.env.DB);
      const partner = await partnersRepo.findById(input.partnerId);
      if (!partner) throw new NotFoundError(`取引先が見つかりません: ${input.partnerId}`);
    }

    // 新規要望(2026-09-23): 倉庫間移動。仕入先と移動元倉庫は同時に指定できない(仕入元が
    // 一意に決まらなくなるため)
    if (input.partnerId && input.sourceWarehouseId) {
      throw new BadRequestError("仕入先と移動元倉庫は同時に指定できません");
    }
    if (input.sourceWarehouseId) {
      const sourceWarehouse = await warehousesRepo.findById(input.sourceWarehouseId);
      if (!sourceWarehouse) {
        throw new NotFoundError(`移動元倉庫が見つかりません: ${input.sourceWarehouseId}`);
      }
    }

    // 入荷指示を指定した場合、発行済み(APPROVED/PARTIALLY_FULFILLED)の指示であることを検証し、
    // partnerId未指定なら指示側の仕入先を自動コピーする(明細内容の一致までは強制しない)
    let effectivePartnerId = input.partnerId || null;
    if (input.receiptInstructionId) {
      const db = createDb(c.env.DB);
      const instructionsRepo = ReceiptInstructionsRepository.fromDb(db);
      const instruction = await instructionsRepo.findHeaderById(input.receiptInstructionId);
      if (!instruction) {
        throw new NotFoundError(`入荷指示が見つかりません: ${input.receiptInstructionId}`);
      }
      if (instruction.status !== "APPROVED" && instruction.status !== "PARTIALLY_FULFILLED") {
        throw new BadRequestError(
          `入荷指示[${input.receiptInstructionId}]は発行済み状態ではないため実績を紐づけられません(現在の状態: ${instruction.status})`,
        );
      }
      if (!effectivePartnerId) {
        effectivePartnerId = instruction.partnerId;
      }
    }

    // Item9: 「発注から選ぶ」で紐付けた明細は、発注数量の残数量を超えていないか検証する
    // (受注→出荷指示/出庫のvalidateRemainingQuantityと同じ方針)
    const purchaseOrderReceiptService = new PurchaseOrderReceiptService(
      PurchaseOrderRepository.fromDb(createDb(c.env.DB)),
      this.repo,
    );

    const resolvedItems: Array<{ id: string; accountCode: string }> = [];
    let warehouseType: string | null = null;
    for (const item of input.items) {
      if (item.orderItemId) {
        await purchaseOrderReceiptService.validateRemainingQuantity(item.orderItemId, item.quantity);
      }

      const product = await productsRepo.findProductById(item.itemId);
      if (!product) throw new NotFoundError(`品目が見つかりません: ${item.itemId}`);

      const warehouse = await warehousesRepo.findById(item.warehouseId);
      if (!warehouse) throw new NotFoundError(`倉庫が見つかりません: ${item.warehouseId}`);
      if (warehouseType === null) {
        warehouseType = warehouse.warehouseType;
      } else if (warehouseType !== warehouse.warehouseType) {
        throw new BadRequestError(
          "1件の入庫内で自社倉庫と外部倉庫の明細を混在させることはできません",
        );
      }

      const location = await locationsRepo.findById(item.locationId);
      if (!location) throw new NotFoundError(`ロケーションが見つかりません: ${item.locationId}`);

      const accountCode = item.accountCode || product.accountCode;
      if (!accountCode) {
        throw new BadRequestError(
          `勘定科目コードを解決できません(品目:${item.itemId})。品目マスタに規定の勘定科目が未設定の場合は明示的に指定してください`,
        );
      }
      const account = await accountsRepo.findByCode(accountCode);
      if (!account) throw new NotFoundError(`勘定科目が見つかりません: ${accountCode}`);

      resolvedItems.push({ id: crypto.randomUUID(), accountCode });
    }

    // 新規要望(2026-09-23): 移動元倉庫が入庫先倉庫と同じ場合は倉庫間移動として成立しない
    if (
      input.sourceWarehouseId &&
      input.items.some((item) => item.warehouseId === input.sourceWarehouseId)
    ) {
      throw new BadRequestError("移動元倉庫が入庫先倉庫と同じです");
    }

    return {
      resolvedItems,
      warehouseType: warehouseType || "INTERNAL",
      effectivePartnerId,
    };
  }

  async createReceipt(c: Context<{ Bindings: Env }>, input: CreateReceiptInput) {
    const db = createDb(c.env.DB);
    const { resolvedItems, warehouseType, effectivePartnerId } = await this.validateAndResolveItems(
      c,
      input,
    );
    const persistedInput: CreateReceiptInput = { ...input, partnerId: effectivePartnerId };

    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const headerId = await resolveConfiguredDocumentId(
      c,
      "receipt",
      (id) => this.repo.findHeaderById(id).then((r) => !!r),
      null,
    );
    const now = new Date();

    await this.repo.createReceipt(
      headerId,
      persistedInput,
      resolvedItems,
      "UNAPPROVED",
      operatorId,
      now,
    );

    const csv = this.buildCsv(headerId, input, resolvedItems);
    const wfEnabled =
      warehouseType === "EXTERNAL"
        ? await isReceivingResultWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS)
        : await isReceivingWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateHeaderStatus(headerId, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyReceiptItems(
        input.items.map((item, i) => ({
          itemId: item.itemId,
          warehouseId: item.warehouseId,
          locationId: item.locationId,
          lotNumber: item.lotNumber || "NONE",
          accountCode: resolvedItems[i].accountCode,
          receivedQuantity: item.quantity,
          inspectionStatus: item.inspectionStatus || "PASSED",
          qrCodeKey: item.qrCodeKey,
        })),
        headerId,
        operatorId,
        now,
      );
      if (input.receiptInstructionId) {
        const instructionsRepo = ReceiptInstructionsRepository.fromDb(db);
        await instructionsRepo.recalculateFulfillment(input.receiptInstructionId);
      }

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_RECEIPT_DIRECT", RESOURCE_KEY, headerId, null, {
          status: "APPROVED",
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、入庫を確定しました",
        headerId,
        csv,
      };
    }

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: "inventory_stock",
      targetId: headerId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `入庫[${headerId}]の承認申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      await this.repo.deleteReceipt(headerId);
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `入庫[${headerId}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_STOCK_RECEIPT_FOR_APPROVAL", RESOURCE_KEY, headerId, null, {
        status: "UNAPPROVED",
      }),
    );

    return {
      success: true,
      message: "入庫の承認を申請しました",
      headerId,
      csv,
    };
  }

  // 修正して再提出: 差戻し(REMANDED)された入庫を、新規伝票を作らず同じheaderIdのまま
  // 内容を書き換えて再申請する。WorkflowEngine.startWorkflow()は同一targetIdの既存
  // PENDING/REMANDED申請を自動でSUPERSEDEDにする仕組みを持つため、それをそのまま利用する
  async resubmitReceipt(c: Context<{ Bindings: Env }>, headerId: string, input: CreateReceiptInput) {
    const db = createDb(c.env.DB);
    const header = await this.repo.findHeaderById(headerId);
    if (!header) throw new NotFoundError("対象の入庫が見つかりません");
    if (header.status !== "REMANDED") {
      throw new BadRequestError("差戻し状態の入庫のみ修正して再申請できます");
    }

    const { resolvedItems, warehouseType, effectivePartnerId } = await this.validateAndResolveItems(
      c,
      input,
    );
    const persistedInput: CreateReceiptInput = { ...input, partnerId: effectivePartnerId };
    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const now = new Date();

    const wfEnabled =
      warehouseType === "EXTERNAL"
        ? await isReceivingResultWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS)
        : await isReceivingWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.replaceReceiptItems(headerId, persistedInput, resolvedItems, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyReceiptItems(
        input.items.map((item, i) => ({
          itemId: item.itemId,
          warehouseId: item.warehouseId,
          locationId: item.locationId,
          lotNumber: item.lotNumber || "NONE",
          accountCode: resolvedItems[i].accountCode,
          receivedQuantity: item.quantity,
          inspectionStatus: item.inspectionStatus || "PASSED",
          qrCodeKey: item.qrCodeKey,
        })),
        headerId,
        operatorId,
        now,
      );

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_RECEIPT_DIRECT", RESOURCE_KEY, headerId, null, {
          status: "APPROVED",
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、入庫を確定しました",
        headerId,
        csv: this.buildCsv(headerId, input, resolvedItems),
      };
    }

    await this.repo.replaceReceiptItems(headerId, persistedInput, resolvedItems, "UNAPPROVED");

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: "inventory_stock",
      targetId: headerId,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: 0,
      comment: `入庫[${headerId}]の再申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `入庫[${headerId}]の再申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RESUBMIT_STOCK_RECEIPT_FOR_APPROVAL", RESOURCE_KEY, headerId, null, {
        status: "UNAPPROVED",
      }),
    );

    return {
      success: true,
      message: "入庫の再申請しました",
      headerId,
      csv: this.buildCsv(headerId, input, resolvedItems),
    };
  }

  private buildCsv(
    headerId: string,
    input: CreateReceiptInput,
    resolvedItems: Array<{ id: string; accountCode: string }>,
  ) {
    const headers = [
      "headerId",
      "itemId",
      "warehouseId",
      "locationId",
      "lotNumber",
      "accountCode",
      "quantity",
      "inspectionStatus",
    ];
    const rows = input.items.map((item, i) =>
      [
        csvField(headerId),
        csvField(item.itemId),
        csvField(item.warehouseId),
        csvField(item.locationId),
        csvField(item.lotNumber || "NONE"),
        csvField(resolvedItems[i].accountCode),
        csvField(item.quantity),
        csvField(item.inspectionStatus || "PASSED"),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, rows));
  }
}
