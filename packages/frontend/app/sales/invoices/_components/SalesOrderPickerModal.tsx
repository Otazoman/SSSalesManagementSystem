import React from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { DocumentLinePickerModal } from "../../../_shared/ui/DocumentLinePickerModal";
import { SalesOrderItemProgress, SalesOrderSummary } from "../_types";

interface SalesOrderPickerModalProps {
  initialSalesOrderId?: string;
  onClose: () => void;
  onApply: (
    salesOrderId: string,
    selections: Array<{ progress: SalesOrderItemProgress; quantity: number }>,
    // 追加要望: 選択した受注のプロジェクトを売上計上へそのまま引き継ぐ
    projectId?: string | null,
    // BUG-050: 選択した受注・発注の取引先。フォーム側で取引先を切り替える。
    // 取り込めない場合は理由を返し、このモーダルに表示する
    partnerId?: string | null,
    // BUG-117: 選択した受注の件名(売上の件名が空なら引き継ぐ。仕入と同じ)
    title?: string | null,
  ) => string | undefined | void;
}

// Item8: 「受注から選択」ピッカー。売上側は欠品ではなく、会社設定に応じた基準数量(受注数量/出荷済数量)からの残数量を明細ごとに表示する。
// REQ-029: 画面と操作は共通の部品(_shared/ui/DocumentLinePickerModal)。ここでは受注の探し先・残数量の取り方・列だけを決める
export function SalesOrderPickerModal({ initialSalesOrderId, onClose, onApply }: SalesOrderPickerModalProps) {
  return (
    <DocumentLinePickerModal<SalesOrderSummary, SalesOrderItemProgress>
      docLabel="受注"
      listUrl="/api/sales-orders?status=APPROVED"
      initialSearch={initialSalesOrderId}
      loadLines={(order) => apiFetch<SalesOrderItemProgress[]>(`/api/sales-invoices/order-progress/${order.id}`)}
      lineKey={(p) => p.salesOrderItemId}
      lineName={(p) => p.itemName || p.itemId}
      remaining={(p) => p.remainingQuantity}
      columns={[
        { header: (lines) => (lines[0]?.basis === "SHIPPED" ? "出荷済数量" : "受注数量"), cell: (p) => p.basisQuantity },
        { header: "既売上済数量", cell: (p) => p.invoicedQuantity },
      ]}
      quantityHeader="計上数量"
      onClose={onClose}
      onApply={(order, selections) =>
        onApply(
          order.id,
          selections.map(({ line, quantity }) => ({ progress: line, quantity })),
          order.projectId ?? null,
          order.partnerId ?? null,
          order.title ?? null,
        )
      }
    />
  );
}
