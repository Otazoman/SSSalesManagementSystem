import React from "react";
import { SidePanel } from "../../../_shared/ui/SidePanel";

interface SalesInvoicePreviewProps {
  previewInvoice: any;
  onClose: () => void;
}

export function SalesInvoicePreview({
  previewInvoice,
  onClose,
}: SalesInvoicePreviewProps) {
  if (!previewInvoice) return null;

  return (
    <SidePanel
      eyebrow={previewInvoice.id}
      title="売上プレビュー内容の最終確認"
      onClose={onClose}
    >
      <div>
        <label className="text-slate-600 font-bold block text-[10px]">
          売上件名 / タイトル
        </label>
        <div className="font-bold text-slate-800 text-sm mt-0.5">
          {previewInvoice.title || "(無題の売上)"}
        </div>
      </div>
      <div>
        <label className="text-slate-600 font-bold block text-[10px]">
          宛先取引先情報
        </label>
        <div className="font-bold text-slate-800 mt-0.5">
          {previewInvoice.companyName || "未設定"}
        </div>
      </div>
      <div className="border-t border-slate-100 pt-3">
        <label className="text-slate-600 font-bold block text-[10px] mb-1">
          売上構成明細
        </label>
        <div className="divide-y border border-slate-200 rounded-lg bg-slate-50/50 overflow-hidden">
          {previewInvoice.items?.map((item: any, idx: number) => (
            <div
              key={idx}
              className="p-2 flex justify-between items-center bg-white"
            >
              <div className="truncate pr-2">
                <div className="font-bold text-slate-800 truncate">
                  {item.itemName || "品目項目"}
                </div>
                <div className="text-[10px] text-slate-600">
                  数量: {item.quantity} × 単価: ¥
                  {item.unitPrice.toLocaleString()}
                </div>
              </div>
              <div className="font-mono font-bold text-slate-900">
                ¥{(item.quantity * item.unitPrice).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="pt-2 text-right text-sm">
        <span className="text-slate-600 font-medium">合計金額(税込):</span>{" "}
        <span className="font-black text-indigo-600 text-sm">
          ¥{previewInvoice.totalAmount?.toLocaleString()}
        </span>
      </div>
    </SidePanel>
  );
}
