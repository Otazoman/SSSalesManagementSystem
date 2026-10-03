import { PurchaseRecognitionRepository } from "./purchase-recognition.repository";
import { BadRequestError } from "../../../platform/http/http-error";

// BUG-050: 仕入の取引先が、元の発注(ヘッダーの発注番号・明細の発注明細)の仕入先と一致することを確認する。
// 画面の「発注から選択」で取引先が切り替わらず、別の仕入先宛ての仕入が保存できていたため、
// 登録・更新・CSV取込のいずれでも検証する。発注・発注明細が見つからない場合は既存の検証(残数量など)に任せる
export async function assertPurchaseOrderPartnerMatches(
  repo: PurchaseRecognitionRepository,
  partnerId: string | null,
  orderId: string | null | undefined,
  sourceOrderItemIds: Array<string | null | undefined>,
  label = "",
) {
  const orderIds = new Set<string>();
  if (orderId) orderIds.add(orderId);
  for (const orderItemId of sourceOrderItemIds) {
    if (!orderItemId) continue;
    const orderItem = await repo.findOrderItemById(orderItemId);
    if (orderItem?.orderId) orderIds.add(orderItem.orderId);
  }

  for (const id of orderIds) {
    const order = await repo.findOrderById(id);
    if (order && order.partnerId !== partnerId) {
      throw new BadRequestError(
        `${label}仕入の取引先[${partnerId ?? "未指定"}]が、発注[${id}]の仕入先[${order.partnerId}]と異なります`,
      );
    }
  }
}
