"use client";

import { SidePanel } from "../../../_shared/ui/SidePanel";
import { formatJstDate } from "../../../_shared/jst-date";
import { ItemMaster, PartnerLookup, PurchaseOrderRecord } from "../_types";

// BUG-101: 一覧の「内容確認」で開く、発注の参照用パネル(見積の QuotePreview・購買申請の PurchaseRequisitionPreview と同じ形)
interface PurchaseOrderPreviewProps {
  order: PurchaseOrderRecord | null;
  suppliers: PartnerLookup[];
  allItems: ItemMaster[];
  onClose: () => void;
}

const dateOf = (value?: string | null) => (value ? formatJstDate(new Date(value)) : "-");

export function PurchaseOrderPreview({ order, suppliers, allItems, onClose }: PurchaseOrderPreviewProps) {
  if (!order) return null;

  const supplierName = suppliers.find((s) => s.id === order.partnerId)?.name ?? order.partnerId;
  const itemNameOf = (itemId: string, itemName?: string | null) =>
    itemName || allItems.find((i) => i.id === itemId)?.name || itemId || "品目項目";

  return (
    <SidePanel eyebrow={order.id} title="発注の内容確認" onClose={onClose}>
      <div>
        <label className="text-slate-600 font-bold block text-[10px]">件名</label>
        <div className="font-bold text-slate-800 text-sm mt-0.5">{order.title || "(無題の発注)"}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-slate-600 font-bold block text-[10px]">仕入先</label>
          <div className="font-bold text-slate-800 mt-0.5">{supplierName || "未設定"}</div>
        </div>
        <div>
          <label className="text-slate-600 font-bold block text-[10px]">発注日 / 納期</label>
          <div className="font-bold text-slate-800 mt-0.5">
            {dateOf(order.orderDate)} / {dateOf(order.deliveryDate)}
          </div>
        </div>
      </div>
      {(order.deliveryPlace || order.deliveryPlaceAddress) && (
        <div>
          <label className="text-slate-600 font-bold block text-[10px]">納品場所</label>
          <div className="font-bold text-slate-800 mt-0.5">{order.deliveryPlace || "-"}</div>
          {/* REQ-009: 納品場所の所在地 */}
          {order.deliveryPlaceAddress && <div className="text-slate-700 mt-0.5">{order.deliveryPlaceAddress}</div>}
        </div>
      )}
      {order.requestId && (
        <div>
          <label className="text-slate-600 font-bold block text-[10px]">元の購買申請</label>
          <div className="font-mono font-bold text-slate-800 mt-0.5">{order.requestId}</div>
        </div>
      )}
      <div className="border-t border-slate-100 pt-3">
        <label className="text-slate-600 font-bold block text-[10px] mb-1">明細</label>
        <div className="divide-y border border-slate-200 rounded-lg bg-slate-50/50 overflow-hidden">
          {(order.items ?? []).length === 0 && <div className="p-2 bg-white text-slate-700">明細がありません</div>}
          {(order.items ?? []).map((item, idx) => (
            <div key={item.id ?? idx} className="p-2 flex justify-between items-center bg-white">
              <div className="truncate pr-2">
                <div className="font-bold text-slate-800 truncate">{itemNameOf(item.itemId, item.itemName)}</div>
                <div className="text-[10px] text-slate-600">
                  数量: {item.quantity} × 単価: ¥{Number(item.unitPrice || 0).toLocaleString()}
                </div>
              </div>
              <div className="font-mono font-bold text-slate-900">
                ¥{(Number(item.quantity || 0) * Number(item.unitPrice || 0)).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-slate-100 pt-3">
        <label className="text-slate-600 font-bold block text-[10px] mb-1">添付</label>
        {(order.attachments ?? []).length === 0 ? (
          <div className="text-slate-600">なし</div>
        ) : (
          <ul className="space-y-1">
            {(order.attachments ?? []).map((att, idx) => (
              <li key={att.id ?? idx} className="text-slate-800 break-all">
                {att.downloadUrl ? (
                  <a
                    href={att.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-700 underline hover:text-indigo-900"
                  >
                    📎 {att.fileName}
                  </a>
                ) : (
                  <span>📎 {att.fileName}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pt-2 text-right text-sm">
        <span className="text-slate-600 font-medium">合計金額(税込):</span>{" "}
        <span className="font-black text-indigo-600 text-sm">¥{Number(order.totalAmount || 0).toLocaleString()}</span>
      </div>
    </SidePanel>
  );
}
