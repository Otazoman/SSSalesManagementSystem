import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { BadRequestError } from "../../../platform/http/http-error";

// BUG-050: 売上の取引先が、元の受注(ヘッダーの受注番号・明細の受注明細)の得意先と一致することを確認する。
// 画面の「受注から選択」で取引先が切り替わらず、別の得意先宛ての売上が確定まで通っていたため、
// 登録・更新・CSV取込のいずれでも検証する。受注・受注明細が見つからない場合は既存の検証(残数量など)に任せる
export async function assertSalesOrderPartnerMatches(
  repo: SalesInvoiceRepository,
  partnerId: string | null,
  salesOrderId: string | null | undefined,
  sourceOrderItemIds: Array<string | null | undefined>,
  label = "",
) {
  const orderIds = new Set<string>();
  if (salesOrderId) orderIds.add(salesOrderId);
  for (const orderItemId of sourceOrderItemIds) {
    if (!orderItemId) continue;
    const orderItem = await repo.findSalesOrderItemById(orderItemId);
    if (orderItem?.salesOrderId) orderIds.add(orderItem.salesOrderId);
  }

  for (const orderId of orderIds) {
    const order = await repo.findSalesOrderById(orderId);
    if (order && order.partnerId !== partnerId) {
      throw new BadRequestError(
        `${label}売上の取引先[${partnerId ?? "未指定"}]が、受注[${orderId}]の得意先[${order.partnerId}]と異なります`,
      );
    }
  }
}
