import React from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { DocumentLinePickerModal } from "../../../_shared/ui/DocumentLinePickerModal";
import { OrderItemProgress, OrderSummary } from "../_types";

interface OrderPickerModalProps {
  initialOrderId?: string;
  onClose: () => void;
  onApply: (
    orderId: string,
    selections: Array<{ progress: OrderItemProgress; quantity: number }>,
    // 追加要望: 選択した発注のプロジェクトを仕入計上へそのまま引き継ぐ
    projectId?: string | null,
    // BUG-050: 選択した受注・発注の取引先。フォーム側で取引先を切り替える。
    // 取り込めない場合は理由を返し、このモーダルに表示する
    partnerId?: string | null,
    // BUG-117: 選択した発注の件名(仕入の件名が空なら引き継ぐ)
    title?: string | null,
  ) => string | undefined | void;
}

// Item10: 「発注から選択」ピッカー。仕入側は会社設定に応じた基準数量(発注数量/入荷済数量)からの残数量を明細ごとに表示する。
// REQ-029: 画面と操作は共通の部品(_shared/ui/DocumentLinePickerModal)。ここでは発注の探し先・残数量の取り方・列だけを決める。
// purchase/requisitions/_components/PurchaseOrderPickerModal.tsx(別用途・同名コンポーネント)との
// 衝突を避けるため、このモジュール内では"OrderPickerModal"という別名にしている
export function OrderPickerModal({ initialOrderId, onClose, onApply }: OrderPickerModalProps) {
  return (
    <DocumentLinePickerModal<OrderSummary, OrderItemProgress>
      docLabel="発注"
      listUrl="/api/purchase-orders?status=APPROVED"
      initialSearch={initialOrderId}
      loadLines={(order) => apiFetch<OrderItemProgress[]>(`/api/purchase-recognitions/order-progress/${order.id}`)}
      lineKey={(p) => p.sourceOrderItemId}
      lineName={(p) => p.itemName || p.itemId}
      remaining={(p) => p.remainingQuantity}
      columns={[
        { header: (lines) => (lines[0]?.basis === "RECEIVED" ? "入荷済数量" : "発注数量"), cell: (p) => p.basisQuantity },
        { header: "既仕入済数量", cell: (p) => p.recognizedQuantity },
      ]}
      quantityHeader="計上数量"
      // BUG-071: 入荷済数量が0で計上できない明細がある場合、理由と対処を示す
      notice={(lines) =>
        lines.some((p) => p.basis === "RECEIVED" && p.basisQuantity <= 0) ? (
          <p className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded p-2">
            入荷済数量が0の明細は計上できません(会社設定「仕入は入荷実績が必要」)。入荷済数量に数えるのは、
            この発注と紐づいた承認済みの入庫だけです。入荷で「発注から選ぶ」、または発注から作った入荷指示を選んで入庫し、
            承認機能を使う場合は承認されてから計上してください。
          </p>
        ) : null
      }
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
