import { PurchaseOrderRepository } from "./purchase-order.repository";
import { ReceiptsRepository } from "../../inventory/receipts/receipts.repository";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";

export interface ReceiptProgressItem {
  orderItemId: string;
  itemId: string | null;
  itemName: string | null;
  inputType: string | null;
  quantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
}

// Item9: 発注→入荷の消込連携。sales-order-shipment.service.tsと同じ方針
// (SalesOrderRepository→ここではPurchaseOrderRepository+ReceiptsRepositoryのペアで合成される構成)
export class PurchaseOrderReceiptService {
  constructor(
    private repo: PurchaseOrderRepository,
    private receiptsRepo: ReceiptsRepository,
  ) {}

  async getReceiptProgress(orderId: string): Promise<ReceiptProgressItem[]> {
    const order = await this.repo.findOrderById(orderId);
    if (!order) throw new NotFoundError("対象の発注が見つかりません");

    const items = await this.repo.findOrderItems(orderId);
    const itemIds = items.map((i: any) => i.id);

    const receivedRows = await this.receiptsRepo.getReceivedQuantitiesByOrderItemIds(itemIds);
    const receivedByItemId = new Map(receivedRows.map((r) => [r.orderItemId, r.receivedQuantity]));

    return items.map((item: any) => {
      const receivedQuantity = receivedByItemId.get(item.id) || 0;
      return {
        orderItemId: item.id,
        itemId: item.itemId,
        itemName: item.itemName,
        inputType: item.inputType,
        quantity: item.quantity,
        receivedQuantity,
        remainingQuantity: Math.max(item.quantity - receivedQuantity, 0),
      };
    });
  }

  // 入庫明細作成時、対応する発注明細の残数量(発注数量-既入荷数量)を超えていないか検証する
  // (超過時はエラーでブロックする、受注→出荷指示/出庫と同じ方針)
  async validateRemainingQuantity(orderItemId: string, requestedQuantity: number): Promise<void> {
    const orderItems = await this.repo.findOrderItemById(orderItemId);
    if (!orderItems) {
      throw new NotFoundError(`発注明細が見つかりません: ${orderItemId}`);
    }
    const receivedRows = await this.receiptsRepo.getReceivedQuantitiesByOrderItemIds([orderItemId]);
    const receivedQuantity = receivedRows[0]?.receivedQuantity || 0;
    const remaining = orderItems.quantity - receivedQuantity;
    if (requestedQuantity > remaining) {
      throw new BadRequestError(
        `発注明細[${orderItemId}]の残数量(${remaining})を超えています(指定数量: ${requestedQuantity})`,
      );
    }
  }
}
