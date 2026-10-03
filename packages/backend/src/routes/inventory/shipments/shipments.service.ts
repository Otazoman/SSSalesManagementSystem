import { Context } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { ShipmentsRepository, ResolvedShipmentItem } from "./shipments.repository";
import { CreateShipmentInput, GetShipmentsQuery, createShipmentSchema } from "./shipments.schema";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { StockRepository } from "../stocks/stocks.repository";
import { StocksService } from "../stocks/stocks.service";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { PartnersRepository } from "../../master/partners/partners.repository";
import { ShipmentInstructionsRepository } from "../shipment-instructions/shipment-instructions.repository";
import { SalesOrderRepository } from "../../sales/orders/sales-order.repository";
import { SalesOrderShipmentService } from "../../sales/orders/sales-order-shipment.service";
import {
  WarehouseStockReservationRepository,
  releaseReservationForShippedQuantity,
} from "../../../platform/inventory/warehouse-stock-reservation.repository";
import { DeliveryNotePdfService } from "./delivery-note-pdf.service";
import { NotFoundError, BadRequestError, ConflictError } from "../../../platform/http/http-error";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import {
  isShippingWorkflowGloballyEnabled,
  isShippingResultWorkflowGloballyEnabled,
} from "../../../workflow-engine/settings";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "inventory_stock";

export class ShipmentsService {
  constructor(private repo: ShipmentsRepository) {}

  async listShipments(
    searchParams: GetShipmentsQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.findHeadersPage(searchParams, params, sort),
      this.repo.countHeaders(searchParams),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async getShipmentDetail(id: string) {
    const header = await this.repo.findHeaderById(id);
    if (!header) throw new NotFoundError("対象の出庫が見つかりません");
    const items = await this.repo.findItemsByHeaderId(id);
    return { header, items };
  }

  // Item6 Phase6-4: 納品予定データ(CSV)。ユーザー確定要件「出荷実績を取り込んだり、
  // 出荷済となった際に出力するデータ」に基づき、出庫が確定済み(APPROVED、実際に在庫が
  // 減算された)かつ得意先(partnerId)が設定されている場合のみオンデマンドで生成する
  // (自社倉庫の即時確定・外部倉庫実績取込・ワークフロー確定のいずれの経路でも同じDB状態から
  // 生成できるため、確定時に固定生成せず都度組み立てる設計にしている)
  async generateDeliveryScheduleCsv(c: Context<{ Bindings: Env }>, id: string) {
    const header = await this.repo.findHeaderById(id);
    if (!header) throw new NotFoundError("対象の出庫が見つかりません");
    if (header.status !== "APPROVED") {
      throw new BadRequestError("出庫が確定済み(出荷済)の場合のみ納品予定データを出力できます");
    }
    if (!header.partnerId) {
      throw new BadRequestError("得意先が設定されていない出庫には納品予定データを出力できません");
    }

    const partnersRepo = new PartnersRepository(c.env.DB);
    const partner = await partnersRepo.findById(header.partnerId);
    const items = await this.repo.findItemsWithPricingByHeaderId(id);

    const headers = [
      "headerId",
      "shippedDate",
      "partnerId",
      "partnerName",
      "salesOrderId",
      "itemId",
      "lotNumber",
      "quantity",
      "accountCode",
      "unitPrice",
      "amount",
    ];
    const rows = items.map((item: any) =>
      [
        csvField(id),
        csvField(new Date(header.shippedDate).toISOString().slice(0, 10)),
        csvField(header.partnerId),
        csvField(partner?.name || ""),
        csvField(header.salesOrderId || ""),
        csvField(item.itemId),
        csvField(item.lotNumber),
        csvField(item.shippedQuantity),
        csvField(item.accountCode),
        csvField(item.unitPrice ?? ""),
        csvField(item.amount ?? ""),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, rows));
  }

  // 入出庫履歴一覧のCSV出力(検索条件に一致する全件、1行1明細のフラット形式)
  async generateCsv(searchParams: GetShipmentsQuery) {
    const rows = await this.repo.findAllForCsv(searchParams);
    const headers = [
      "headerId",
      "shippedDate",
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
      "qualityStatus",
      "partnerId",
      "shipmentInstructionId",
    ];
    const csvRows = rows.map((r: any) =>
      [
        csvField(r.headerId),
        csvField(r.shippedDate ? new Date(r.shippedDate).toISOString().slice(0, 10) : ""),
        csvField(r.status),
        csvField(r.headerMemo),
        csvField(r.createdBy),
        csvField(r.createdAt ? new Date(r.createdAt).toISOString() : ""),
        csvField(r.itemId),
        csvField(r.warehouseId),
        csvField(r.locationId),
        csvField(r.lotNumber),
        csvField(r.shippedQuantity),
        csvField(r.accountCode),
        csvField(r.qualityStatus),
        csvField(r.partnerId),
        csvField(r.shipmentInstructionId),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, csvRows));
  }

  // CSV一括登録: generateCsv()が出力した形式をそのまま再取込できるようにするため、
  // headerId列があればそれでグルーピングして複数出庫として登録する(1つのCSVエクスポートに
  // 含まれる複数件の出庫履歴を、そのまま再インポートすると同じ件数の出庫として復元される)。
  // headerId列が無い手作成CSV(単純な一括登録用)の場合は、ファイル全体を1件の出庫として扱う
  // (ヘッダー項目は先頭明細行の値を使う)。既存のcreateShipment()をそのまま呼ぶことで、
  // ロケーションからの品目自動解決・承認要否判定・在庫反映等のロジックを再利用する
  async bulkImportCsv(c: Context<{ Bindings: Env }>, csvData: string) {
    const allRows = parseCsv(csvData);
    if (allRows.length <= 1) {
      throw new BadRequestError("CSVにデータ行が含まれていません");
    }

    const header = allRows[0].map((h) => h.trim());
    const idxHeaderId = header.indexOf("headerId");
    const idxShippedDate = header.indexOf("shippedDate");
    const idxMemo = header.indexOf("memo");
    const idxLocationId = header.indexOf("locationId");
    const idxItemId = header.indexOf("itemId");
    const idxQuantity = header.indexOf("quantity");
    const idxLotNumber = header.indexOf("lotNumber");
    const idxQualityStatus = header.indexOf("qualityStatus");
    const idxPartnerId = header.indexOf("partnerId");
    const idxShipmentInstructionId = header.indexOf("shipmentInstructionId");

    if (idxShippedDate === -1 || idxLocationId === -1 || idxItemId === -1 || idxQuantity === -1) {
      throw new BadRequestError(
        "CSVに必要な列(shippedDate, locationId, itemId, quantity)がありません",
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
        locationId: cols[idxLocationId],
        itemId: cols[idxItemId],
        quantity: Number(cols[idxQuantity]),
        lotNumber: idxLotNumber !== -1 ? cols[idxLotNumber] || null : null,
        qualityStatus: idxQualityStatus !== -1 ? cols[idxQualityStatus] || null : null,
      }));

      const input = v.parse(createShipmentSchema, {
        shippedDate: rows[0][idxShippedDate],
        memo: idxMemo !== -1 ? rows[0][idxMemo] || null : null,
        items,
        partnerId: idxPartnerId !== -1 ? rows[0][idxPartnerId] || null : null,
        shipmentInstructionId:
          idxShipmentInstructionId !== -1 ? rows[0][idxShipmentInstructionId] || null : null,
      });

      const result = await this.createShipment(c, input);
      importedCount += 1;
      lastHeaderId = result.headerId;
    }

    return {
      success: true,
      message: `CSVから ${importedCount} 件の出庫を登録しました`,
      headerId: lastHeaderId,
    };
  }

  // createShipment/resubmitShipmentの両方から呼ぶ共通のロケーション在庫解決ロジック。
  // Item6 Phase6-4: 明細の倉庫種別(INTERNAL/EXTERNAL)もあわせて返し、呼び出し元が
  // 参照する承認フラグ(自社出庫承認 or 外部倉庫出荷実績反映承認)を選べるようにする。
  // 1伝票内で倉庫種別が混在すると承認フラグの判定が一意にできないため、混在時はエラーとする。
  private async resolveShipmentItems(
    c: Context<{ Bindings: Env }>,
    input: CreateShipmentInput,
  ): Promise<{
    resolvedItems: ResolvedShipmentItem[];
    warehouseType: string;
    effectivePartnerId: string | null;
    destinationWarehouseId: string | null;
    salesOrderId: string | null;
  }> {
    const db = createDb(c.env.DB);
    const stockRepo = StockRepository.fromDb(db);
    const warehousesRepo = new WarehousesRepository(c.env.DB);
    const salesOrderRepo = new SalesOrderRepository(c.env.DB);
    const salesOrderShipmentService = new SalesOrderShipmentService(salesOrderRepo);

    if (input.partnerId) {
      const partnersRepo = new PartnersRepository(c.env.DB);
      const partner = await partnersRepo.findById(input.partnerId);
      if (!partner) throw new NotFoundError(`取引先が見つかりません: ${input.partnerId}`);
    }

    // 新規要望(2026-09-23): 倉庫間移動。得意先と移動先倉庫は同時に指定できない(宛先が
    // 一意に決まらなくなるため)
    if (input.partnerId && input.destinationWarehouseId) {
      throw new BadRequestError("得意先と移動先倉庫は同時に指定できません");
    }
    if (input.destinationWarehouseId) {
      const destinationWarehouse = await warehousesRepo.findById(input.destinationWarehouseId);
      if (!destinationWarehouse) {
        throw new NotFoundError(`移動先倉庫が見つかりません: ${input.destinationWarehouseId}`);
      }
    }

    // partnerId未指定でも出荷指示が紐づく場合は指示側の得意先を自動コピーする(納品書発行のため)
    let effectivePartnerId = input.partnerId || null;

    // Item6 Phase6-4: 消込用。出荷指示を指定した場合、発行済み(APPROVED/PARTIALLY_FULFILLED)の
    // 指示であることを検証する(指示のIDだけ存在すればよく、明細内容の一致までは強制しない=
    // 現場の実出荷数を優先する設計)
    if (input.shipmentInstructionId) {
      const instructionsRepo = ShipmentInstructionsRepository.fromDb(db);
      const instruction = await instructionsRepo.findHeaderById(input.shipmentInstructionId);
      if (!instruction) {
        throw new NotFoundError(`出荷指示が見つかりません: ${input.shipmentInstructionId}`);
      }
      if (instruction.status !== "APPROVED" && instruction.status !== "PARTIALLY_FULFILLED") {
        throw new BadRequestError(
          `出荷指示[${input.shipmentInstructionId}]は発行済み状態ではないため実績を紐づけられません(現在の状態: ${instruction.status})`,
        );
      }
      if (!effectivePartnerId) {
        effectivePartnerId = instruction.partnerId;
      }
    }

    const resolvedItems: ResolvedShipmentItem[] = [];
    let warehouseType: string | null = null;
    let salesOrderId: string | null = null;
    for (const item of input.items) {
      const candidates = await stockRepo.findAvailableStocksAtLocation(item.locationId);
      let filtered = candidates.filter((s) => s.itemId === item.itemId);
      if (item.lotNumber) {
        filtered = filtered.filter((s) => s.lotNumber === item.lotNumber);
      }
      if (item.qualityStatus) {
        filtered = filtered.filter((s) => s.qualityStatus === item.qualityStatus);
      }

      if (filtered.length === 0) {
        throw new NotFoundError(
          `指定されたロケーションに出庫可能な在庫が見つかりません(ロケーション:${item.locationId} 品目:${item.itemId})`,
        );
      }
      if (filtered.length > 1) {
        const candidateSummary = filtered
          .map((s) => `品目:${s.itemId} ロット:${s.lotNumber} 品質区分:${s.qualityStatus}`)
          .join(" / ");
        throw new BadRequestError(
          `このロケーションには複数の在庫候補があります。lotNumber/qualityStatusを指定して絞り込んでください(候補: ${candidateSummary})`,
        );
      }

      const stock = filtered[0];
      if (stock.quantity < item.quantity) {
        throw new ConflictError(
          `出庫数量が在庫残数を超えています(ロケーション:${item.locationId} 在庫残数:${stock.quantity})`,
        );
      }

      const warehouse = await warehousesRepo.findById(stock.warehouseId);
      const stockWarehouseType = warehouse?.warehouseType || "INTERNAL";
      if (warehouseType === null) {
        warehouseType = stockWarehouseType;
      } else if (warehouseType !== stockWarehouseType) {
        throw new BadRequestError(
          "1件の出庫内で自社倉庫と外部倉庫の明細を混在させることはできません",
        );
      }

      // Item7残課題6: 受注明細に紐づく場合、残数量(受注数量-既出荷数量)を超えていないか
      // 検証する(超過時はエラーでブロックする、ユーザー確認済み)。1件でも紐付けがあれば
      // そのヘッダー全体をその受注の出庫実績として記録する
      if (item.salesOrderItemId) {
        await salesOrderShipmentService.validateRemainingQuantity(item.salesOrderItemId, item.quantity);
        const orderItem = await salesOrderRepo.findOrderItemById(item.salesOrderItemId);
        if (orderItem && salesOrderId && salesOrderId !== orderItem.salesOrderId) {
          throw new BadRequestError("1件の出庫内に異なる受注の明細を混在させることはできません");
        }
        if (orderItem) salesOrderId = orderItem.salesOrderId;
      }

      resolvedItems.push({
        id: crypto.randomUUID(),
        itemId: stock.itemId,
        warehouseId: stock.warehouseId,
        locationId: stock.locationId,
        lotNumber: stock.lotNumber,
        qualityStatus: stock.qualityStatus,
        accountCode: stock.accountCode,
        shippedQuantity: item.quantity,
        salesOrderItemId: item.salesOrderItemId || null,
      });
    }

    // 新規要望(2026-09-23): 移動先倉庫が出庫元倉庫と同じ場合は倉庫間移動として成立しない
    if (
      input.destinationWarehouseId &&
      resolvedItems.some((item) => item.warehouseId === input.destinationWarehouseId)
    ) {
      throw new BadRequestError("移動先倉庫が出庫元倉庫と同じです");
    }

    return {
      resolvedItems,
      warehouseType: warehouseType || "INTERNAL",
      effectivePartnerId,
      destinationWarehouseId: input.destinationWarehouseId || null,
      salesOrderId,
    };
  }

  // Item7残課題6: 出庫実績が確定(在庫が実際に減算)したタイミングで、受注明細に紐づく
  // 明細分だけ在庫引当を解放し、受注のshipment_statusを再計算する。出荷指示の発行時点
  // (在庫は動かない)では呼ばない。承認機能OFFの即時確定・ワークフロー確定の両方から呼ぶ
  private async releaseReservationsForShippedItems(
    db: ReturnType<typeof createDb>,
    items: ResolvedShipmentItem[],
    now: Date,
  ) {
    const linkedItems = items.filter((item) => item.salesOrderItemId);
    if (linkedItems.length === 0) return;

    const warehouseReservationRepo = WarehouseStockReservationRepository.fromDb(db);
    const salesOrderRepo = SalesOrderRepository.fromDb(db);
    const salesOrderShipmentService = new SalesOrderShipmentService(salesOrderRepo);

    const affectedOrderIds = new Set<string>();
    for (const item of linkedItems) {
      const orderItem = await salesOrderRepo.findOrderItemById(item.salesOrderItemId!);
      if (!orderItem || !orderItem.itemId) continue;
      await releaseReservationForShippedQuantity(
        warehouseReservationRepo,
        item.salesOrderItemId!,
        orderItem.itemId,
        item.warehouseId,
        item.shippedQuantity,
        now,
      );
      affectedOrderIds.add(orderItem.salesOrderId);
    }
    for (const orderId of affectedOrderIds) {
      await salesOrderShipmentService.recalculateShipmentStatus(orderId);
    }
  }

  async createShipment(c: Context<{ Bindings: Env }>, input: CreateShipmentInput) {
    const db = createDb(c.env.DB);
    const { resolvedItems, warehouseType, effectivePartnerId, destinationWarehouseId, salesOrderId } =
      await this.resolveShipmentItems(c, input);

    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    // Item7フィードバック: 従来UUIDだったIDを、会社設定(document_number_formats)で
    // 制御可能な管理番号形式に変更(既存レコードはUUIDのまま、新規作成分のみこの形式になる)
    const headerId = await resolveConfiguredDocumentId(
      c,
      "shipment",
      (id) => this.repo.findHeaderById(id).then((row) => !!row),
      null,
    );
    const now = new Date();

    await this.repo.createShipment(
      headerId,
      new Date(input.shippedDate),
      input.memo || null,
      resolvedItems,
      "UNAPPROVED",
      operatorId,
      now,
      effectivePartnerId,
      input.shipmentInstructionId || null,
      salesOrderId,
      destinationWarehouseId,
    );

    const csv = this.buildCsv(headerId, resolvedItems);
    const wfEnabled =
      warehouseType === "EXTERNAL"
        ? await isShippingResultWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS)
        : await isShippingWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateHeaderStatus(headerId, "APPROVED");
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyShipmentItems(resolvedItems, headerId, operatorId, now);
      await this.releaseReservationsForShippedItems(db, resolvedItems, now);
      if (input.shipmentInstructionId) {
        const instructionsRepo = ShipmentInstructionsRepository.fromDb(db);
        await instructionsRepo.recalculateFulfillment(input.shipmentInstructionId);
      }
      if (effectivePartnerId) {
        const deliveryNotePdfService = new DeliveryNotePdfService(this.repo);
        c.executionCtx.waitUntil(deliveryNotePdfService.generateAndStore(c, headerId));
      }

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_SHIPMENT_DIRECT", RESOURCE_KEY, headerId, null, {
          status: "APPROVED",
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、出庫を確定しました",
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
      comment: `出庫[${headerId}]の承認申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      await this.repo.deleteShipment(headerId);
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `出庫[${headerId}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_STOCK_SHIPMENT_FOR_APPROVAL", RESOURCE_KEY, headerId, null, {
        status: "UNAPPROVED",
      }),
    );

    return {
      success: true,
      message: "出庫の承認を申請しました",
      headerId,
      csv,
    };
  }

  // 修正して再提出: 差戻し(REMANDED)された出庫を、新規伝票を作らず同じheaderIdのまま
  // 内容を書き換えて再申請する。WorkflowEngine.startWorkflow()は同一targetIdの既存
  // PENDING/REMANDED申請を自動でSUPERSEDEDにする仕組みを持つため、それをそのまま利用する
  async resubmitShipment(c: Context<{ Bindings: Env }>, headerId: string, input: CreateShipmentInput) {
    const db = createDb(c.env.DB);
    const header = await this.repo.findHeaderById(headerId);
    if (!header) throw new NotFoundError("対象の出庫が見つかりません");
    if (header.status !== "REMANDED") {
      throw new BadRequestError("差戻し状態の出庫のみ修正して再申請できます");
    }

    const { resolvedItems, warehouseType, effectivePartnerId, destinationWarehouseId, salesOrderId } =
      await this.resolveShipmentItems(c, input);
    const operatorId = await resolveOperatorEmployeeNumber(c, db);
    const now = new Date();

    const wfEnabled =
      warehouseType === "EXTERNAL"
        ? await isShippingResultWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS)
        : await isShippingWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.replaceShipmentItems(
        headerId,
        new Date(input.shippedDate),
        input.memo || null,
        resolvedItems,
        "APPROVED",
        effectivePartnerId,
        salesOrderId,
        destinationWarehouseId,
      );
      const stocksService = StocksService.fromDb(db);
      await stocksService.applyShipmentItems(resolvedItems, headerId, operatorId, now);
      await this.releaseReservationsForShippedItems(db, resolvedItems, now);
      if (effectivePartnerId) {
        const deliveryNotePdfService = new DeliveryNotePdfService(this.repo);
        c.executionCtx.waitUntil(deliveryNotePdfService.generateAndStore(c, headerId));
      }

      c.executionCtx.waitUntil(
        logAuditEvent(c, "CONFIRM_STOCK_SHIPMENT_DIRECT", RESOURCE_KEY, headerId, null, {
          status: "APPROVED",
        }),
      );

      return {
        success: true,
        message: "承認機能が無効のため、出庫を確定しました",
        headerId,
        csv: this.buildCsv(headerId, resolvedItems),
      };
    }

    await this.repo.replaceShipmentItems(
      headerId,
      new Date(input.shippedDate),
      input.memo || null,
      resolvedItems,
      "UNAPPROVED",
      effectivePartnerId,
      salesOrderId,
      destinationWarehouseId,
    );

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
      comment: `出庫[${headerId}]の再申請`,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `出庫[${headerId}]の再申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RESUBMIT_STOCK_SHIPMENT_FOR_APPROVAL", RESOURCE_KEY, headerId, null, {
        status: "UNAPPROVED",
      }),
    );

    return {
      success: true,
      message: "出庫の再申請しました",
      headerId,
      csv: this.buildCsv(headerId, resolvedItems),
    };
  }

  private buildCsv(headerId: string, items: ResolvedShipmentItem[]) {
    const headers = [
      "headerId",
      "itemId",
      "warehouseId",
      "locationId",
      "lotNumber",
      "qualityStatus",
      "accountCode",
      "quantity",
    ];
    const rows = items.map((item) =>
      [
        csvField(headerId),
        csvField(item.itemId),
        csvField(item.warehouseId),
        csvField(item.locationId),
        csvField(item.lotNumber),
        csvField(item.qualityStatus),
        csvField(item.accountCode),
        csvField(item.shippedQuantity),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, rows));
  }
}
