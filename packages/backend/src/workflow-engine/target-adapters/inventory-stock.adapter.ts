/**
 * targetType = "inventory_stock" 用のTargetAdapter実装(Item6 Phase6-2: 自社倉庫の入庫/出庫)。
 * 入庫(item_receipt_headers)と出庫(item_shipment_headers)の両方をこの1つのtargetTypeで扱う
 * (承認フロー・承認者チェーンは共有。ON/OFFのフラグ自体は入庫承認/出庫承認で別々)。
 * screens.tsに既存登録済みの"inventory_stock"(在庫・入出庫管理)resourceをそのまま再利用しており、
 * このために新規screens.tsエントリは追加していない。
 *
 * quotes/warehouses等と同じく、対象の入庫/出庫は既にUNAPPROVED行としてDB上に実在する状態から
 * 申請が始まるため、REGISTER承認確定時は「新規作成」ではなく「既存UNAPPROVED行のステータス確定
 * + stocks/stock_transactionsへの反映」として扱う。
 */
import { ReceiptsRepository } from "../../routes/inventory/receipts/receipts.repository";
import { ShipmentsRepository } from "../../routes/inventory/shipments/shipments.repository";
import { ReclassificationsRepository } from "../../routes/inventory/reclassifications/reclassifications.repository";
import { DisposalsRepository } from "../../routes/inventory/disposals/disposals.repository";
import { ReturnsRepository } from "../../routes/inventory/returns/returns.repository";
import { ShipmentInstructionsRepository } from "../../routes/inventory/shipment-instructions/shipment-instructions.repository";
import { ReceiptInstructionsRepository } from "../../routes/inventory/receipt-instructions/receipt-instructions.repository";
import { DeliveryNotePdfService } from "../../routes/inventory/shipments/delivery-note-pdf.service";
import { StocksService } from "../../routes/inventory/stocks/stocks.service";
import { SalesOrderRepository } from "../../routes/sales/orders/sales-order.repository";
import { SalesOrderShipmentService } from "../../routes/sales/orders/sales-order-shipment.service";
import {
  WarehouseStockReservationRepository,
  releaseReservationForShippedQuantity,
} from "../../platform/inventory/warehouse-stock-reservation.repository";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import { SCREEN_MASTER } from "../../constants/screens";
import type {
  TargetAdapter,
  ApplyApprovedParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
  ResolveEditPathParams,
} from "./registry";

async function applyApproved({
  db,
  reqParent,
  userId,
  now,
  c,
}: ApplyApprovedParams): Promise<void> {
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);
  const stocksService = StocksService.fromDb(db);

  // Item6 Phase6-4: 出荷指示/入荷指示は「指示書の発行」であり在庫を動かさない。
  // 承認確定時はステータスをAPPROVED(発行済み)にするのみ
  const shipmentInstructionsRepo = ShipmentInstructionsRepository.fromDb(db);
  const shipmentInstruction = await shipmentInstructionsRepo.findHeaderById(reqParent.targetId);
  if (shipmentInstruction) {
    await shipmentInstructionsRepo.updateHeaderStatus(reqParent.targetId, "APPROVED");
    return;
  }

  const receiptInstructionsRepo = ReceiptInstructionsRepository.fromDb(db);
  const receiptInstruction = await receiptInstructionsRepo.findHeaderById(reqParent.targetId);
  if (receiptInstruction) {
    await receiptInstructionsRepo.updateHeaderStatus(reqParent.targetId, "APPROVED");
    return;
  }

  const receiptsRepo = ReceiptsRepository.fromDb(db);
  const receiptHeader = await receiptsRepo.findHeaderById(reqParent.targetId);
  if (receiptHeader) {
    const items = await receiptsRepo.findItemsByHeaderId(reqParent.targetId);
    await stocksService.applyReceiptItems(
      items.map((item: any) => ({
        itemId: item.itemId,
        warehouseId: item.warehouseId,
        locationId: item.locationId,
        lotNumber: item.lotNumber,
        accountCode: item.accountCode,
        receivedQuantity: item.receivedQuantity,
        inspectionStatus: item.inspectionStatus,
        qrCodeKey: item.qrCodeKey,
      })),
      reqParent.targetId,
      approverEmployeeNumber,
      now,
    );
    await receiptsRepo.updateHeaderStatus(reqParent.targetId, "APPROVED");
    // Item6 Phase6-4: 消込。この入庫実績が入荷指示に紐づく場合、指示側の充足状況を更新する
    if (receiptHeader.receiptInstructionId) {
      const receiptInstructionsRepo = ReceiptInstructionsRepository.fromDb(db);
      await receiptInstructionsRepo.recalculateFulfillment(receiptHeader.receiptInstructionId);
    }
    return;
  }

  const shipmentsRepo = ShipmentsRepository.fromDb(db);
  const shipmentHeader = await shipmentsRepo.findHeaderById(reqParent.targetId);
  if (shipmentHeader) {
    const items = await shipmentsRepo.findItemsByHeaderId(reqParent.targetId);
    await stocksService.applyShipmentItems(
      items.map((item: any) => ({
        itemId: item.itemId,
        warehouseId: item.warehouseId,
        locationId: item.locationId,
        lotNumber: item.lotNumber,
        accountCode: item.accountCode,
        qualityStatus: item.qualityStatus,
        shippedQuantity: item.shippedQuantity,
        qrCodeKey: null,
      })),
      reqParent.targetId,
      approverEmployeeNumber,
      now,
    );
    await shipmentsRepo.updateHeaderStatus(reqParent.targetId, "APPROVED");
    // Item6 Phase6-4: 消込。この出庫実績が出荷指示に紐づく場合、指示側の充足状況を更新する
    if (shipmentHeader.shipmentInstructionId) {
      const shipmentInstructionsRepo = ShipmentInstructionsRepository.fromDb(db);
      await shipmentInstructionsRepo.recalculateFulfillment(shipmentHeader.shipmentInstructionId);
    }
    // Item7残課題6: 消込。受注明細に紐づく明細分だけ在庫引当を解放し、受注のshipment_statusを
    // 再計算する(承認機能OFF時の即時確定パスと同じロジック、ここは承認機能ON確定時)
    const linkedItems = items.filter((item: any) => item.salesOrderItemId);
    if (linkedItems.length > 0) {
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
    // Item6 Phase6-4: 得意先が設定されていれば納品書PDFを自動生成する(承認確定=実際に
    // 在庫が減算されたタイミング)。cはR2バインディングアクセスに必要
    if (shipmentHeader.partnerId && c) {
      const deliveryNotePdfService = new DeliveryNotePdfService(shipmentsRepo);
      c.executionCtx.waitUntil(deliveryNotePdfService.generateAndStore(c as any, reqParent.targetId));
    }
    return;
  }

  const reclassificationsRepo = ReclassificationsRepository.fromDb(db);
  const reclassification = await reclassificationsRepo.findById(reqParent.targetId);
  if (reclassification) {
    await stocksService.applyReclassification(
      {
        itemId: reclassification.itemId,
        warehouseId: reclassification.warehouseId,
        locationId: reclassification.locationId,
        lotNumber: reclassification.lotNumber,
        accountCode: reclassification.accountCode,
        fromQualityStatus: reclassification.fromQualityStatus,
        toQualityStatus: reclassification.toQualityStatus,
        quantity: reclassification.quantity,
        memo: reclassification.memo,
      },
      reqParent.targetId,
      approverEmployeeNumber,
      now,
    );
    await reclassificationsRepo.updateStatus(reqParent.targetId, "APPROVED");
    return;
  }

  const disposalsRepo = DisposalsRepository.fromDb(db);
  const disposal = await disposalsRepo.findById(reqParent.targetId);
  if (disposal) {
    await stocksService.applyDisposal(
      {
        itemId: disposal.itemId,
        warehouseId: disposal.warehouseId,
        locationId: disposal.locationId,
        lotNumber: disposal.lotNumber,
        accountCode: disposal.accountCode,
        qualityStatus: disposal.qualityStatus,
        quantity: disposal.quantity,
        memo: disposal.memo,
      },
      reqParent.targetId,
      approverEmployeeNumber,
      now,
    );
    await disposalsRepo.updateStatus(reqParent.targetId, "APPROVED");
    return;
  }

  const returnsRepo = ReturnsRepository.fromDb(db);
  const returnRecord = await returnsRepo.findById(reqParent.targetId);
  if (returnRecord) {
    await stocksService.applyReturn(
      {
        itemId: returnRecord.itemId,
        warehouseId: returnRecord.warehouseId,
        locationId: returnRecord.locationId,
        lotNumber: returnRecord.lotNumber,
        accountCode: returnRecord.accountCode,
        qualityStatus: returnRecord.qualityStatus,
        direction: returnRecord.direction as "OUTBOUND" | "INBOUND",
        quantity: returnRecord.quantity,
        memo: returnRecord.memo,
      },
      reqParent.targetId,
      approverEmployeeNumber,
      now,
    );
    await returnsRepo.updateStatus(reqParent.targetId, "APPROVED");
    return;
  }

  console.error(
    `在庫承認確定: targetId=${reqParent.targetId} に対応する入庫/出庫/品質区分変更/廃棄/返品レコードが見つかりませんでした`,
  );
}

// 差戻し確定時(承認者によるREMAND)/取り下げ確定時(申請者によるCANCEL)の共通ハンドラ。
// workflow-tasks.service.tsのremandTask/cancelTaskがどちらも同じapplyRemanded()を呼ぶため、
// paramsのaction("REMAND"|"CANCEL")で区別してステータスを分ける(未指定時はREMAND扱いとして
// 後方互換を保つ)。入出庫履歴画面(一覧+詳細)で差戻し/取下の理由とともに元の申請内容
// (ロケーション/ロット/数量)を確認したうえで、修正が必要な場合は「修正して再提出」から
// 同じヘッダーIDのまま再申請する(resubmitReceipt/resubmitShipment、新規伝票は作成しない)。
async function applyRemanded({
  db,
  reqParent,
  action,
}: ApplyApprovedParams): Promise<void> {
  const status = action === "CANCEL" ? "CANCELED" : "REMANDED";

  const shipmentInstructionsRepo = ShipmentInstructionsRepository.fromDb(db);
  const shipmentInstruction = await shipmentInstructionsRepo.findHeaderById(reqParent.targetId);
  if (shipmentInstruction) {
    await shipmentInstructionsRepo.updateHeaderStatus(reqParent.targetId, status);
    return;
  }

  const receiptInstructionsRepo = ReceiptInstructionsRepository.fromDb(db);
  const receiptInstruction = await receiptInstructionsRepo.findHeaderById(reqParent.targetId);
  if (receiptInstruction) {
    await receiptInstructionsRepo.updateHeaderStatus(reqParent.targetId, status);
    return;
  }

  const receiptsRepo = ReceiptsRepository.fromDb(db);
  const receiptHeader = await receiptsRepo.findHeaderById(reqParent.targetId);
  if (receiptHeader) {
    await receiptsRepo.updateHeaderStatus(reqParent.targetId, status);
    return;
  }

  const shipmentsRepo = ShipmentsRepository.fromDb(db);
  const shipmentHeader = await shipmentsRepo.findHeaderById(reqParent.targetId);
  if (shipmentHeader) {
    await shipmentsRepo.updateHeaderStatus(reqParent.targetId, status);
    return;
  }

  const reclassificationsRepo = ReclassificationsRepository.fromDb(db);
  const reclassification = await reclassificationsRepo.findById(reqParent.targetId);
  if (reclassification) {
    await reclassificationsRepo.updateStatus(reqParent.targetId, status);
    return;
  }

  const disposalsRepo = DisposalsRepository.fromDb(db);
  const disposal = await disposalsRepo.findById(reqParent.targetId);
  if (disposal) {
    await disposalsRepo.updateStatus(reqParent.targetId, status);
    return;
  }

  const returnsRepo = ReturnsRepository.fromDb(db);
  const returnRecord = await returnsRepo.findById(reqParent.targetId);
  if (returnRecord) {
    await returnsRepo.updateStatus(reqParent.targetId, status);
    return;
  }
}

async function getTaskPreview({
  db,
  targetId,
}: TaskPreviewParams): Promise<TaskPreviewResult> {
  const shipmentInstructionsRepo = ShipmentInstructionsRepository.fromDb(db);
  const shipmentInstruction = await shipmentInstructionsRepo.findHeaderById(targetId);
  if (shipmentInstruction) {
    const items = await shipmentInstructionsRepo.findItemsByHeaderId(targetId);
    return {
      targetName: `出荷指示[${targetId}]`,
      previewData: { header: shipmentInstruction, items },
    };
  }

  const receiptInstructionsRepo = ReceiptInstructionsRepository.fromDb(db);
  const receiptInstruction = await receiptInstructionsRepo.findHeaderById(targetId);
  if (receiptInstruction) {
    const items = await receiptInstructionsRepo.findItemsByHeaderId(targetId);
    return {
      targetName: `入荷指示[${targetId}]`,
      previewData: { header: receiptInstruction, items },
    };
  }

  const receiptsRepo = ReceiptsRepository.fromDb(db);
  const receiptHeader = await receiptsRepo.findHeaderById(targetId);
  if (receiptHeader) {
    const items = await receiptsRepo.findItemsByHeaderId(targetId);
    return { targetName: `入庫[${targetId}]`, previewData: { header: receiptHeader, items } };
  }

  const shipmentsRepo = ShipmentsRepository.fromDb(db);
  const shipmentHeader = await shipmentsRepo.findHeaderById(targetId);
  if (shipmentHeader) {
    const items = await shipmentsRepo.findItemsByHeaderId(targetId);
    return { targetName: `出庫[${targetId}]`, previewData: { header: shipmentHeader, items } };
  }

  const reclassificationsRepo = ReclassificationsRepository.fromDb(db);
  const reclassification = await reclassificationsRepo.findById(targetId);
  if (reclassification) {
    // InventoryStockPreview(フロント)の{header, items}規約に合わせる。品質区分変更は
    // stock_auditsと同じ単一行のため、明細(items)は持たない
    return {
      targetName: `品質区分変更[${targetId}]`,
      previewData: { header: reclassification },
    };
  }

  const disposalsRepo = DisposalsRepository.fromDb(db);
  const disposal = await disposalsRepo.findById(targetId);
  if (disposal) {
    return {
      targetName: `廃棄[${targetId}]`,
      previewData: { header: disposal },
    };
  }

  const returnsRepo = ReturnsRepository.fromDb(db);
  const returnRecord = await returnsRepo.findById(targetId);
  if (returnRecord) {
    return {
      targetName: `返品[${targetId}]`,
      previewData: { header: returnRecord },
    };
  }

  return { targetName: "不明な入出庫", previewData: null };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const preview = await getTaskPreview({ db, requestId: "", targetId });
  return {
    targetName: preview.targetName,
    snapshotNew: preview.previewData,
    snapshotOld: null,
  };
}

// 画面構成再編フェーズ5: 「修正して再提出」の遷移先を、targetType配下の実際のレコード種別に
// 応じて業務機能別ページ(入荷/出荷/在庫・棚卸)へ動的に解決する。
function screenPath(resource: string): string | null {
  return SCREEN_MASTER.find((s) => s.resource === resource)?.path ?? null;
}

async function resolveEditPath({
  db,
  targetType,
  targetId,
}: ResolveEditPathParams): Promise<string | null> {
  if (targetType === "inventory_instructions") {
    const [shipmentInstruction, receiptInstruction] = await Promise.all([
      ShipmentInstructionsRepository.fromDb(db).findHeaderById(targetId),
      ReceiptInstructionsRepository.fromDb(db).findHeaderById(targetId),
    ]);
    if (shipmentInstruction) return screenPath("inventory_shipping");
    if (receiptInstruction) return screenPath("inventory_receiving");
    return null;
  }

  if (targetType === "inventory_stock") {
    // 画面構成再編(a): 品質区分変更・廃棄・返品は入庫/出庫と同じtargetTypeを共有するが、
    // 編集フォーム自体は/inventory/audit(在庫・棚卸)の「在庫照会」タブに集約されているため
    // そちらへ解決する
    const [receiptHeader, shipmentHeader, reclassification, disposal, returnRecord] =
      await Promise.all([
        ReceiptsRepository.fromDb(db).findHeaderById(targetId),
        ShipmentsRepository.fromDb(db).findHeaderById(targetId),
        ReclassificationsRepository.fromDb(db).findById(targetId),
        DisposalsRepository.fromDb(db).findById(targetId),
        ReturnsRepository.fromDb(db).findById(targetId),
      ]);
    if (receiptHeader) return screenPath("inventory_receiving");
    if (shipmentHeader) return screenPath("inventory_shipping");
    if (reclassification || disposal || returnRecord) return screenPath("inventory_audit");
    return null;
  }

  return null;
}

export const inventoryStockAdapter: TargetAdapter = {
  // BUG-049: 書き込みの結果を使う処理(書き込み直後の再集計など)や R2 の後始末を含むため、承認の書き込みとはまとめず、先に実行する
  requiresImmediateWrites: true,
  applyApproved,
  applyRemanded,
  getTaskPreview,
  getHistoryPreview,
  resolveEditPath,
};
