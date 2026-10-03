"use client";

import { useState } from "react";
import { AuditEditTarget, useStockAuditForm } from "../_hooks/useStockAuditForm";
import { usePagePermissions } from "../../../hooks/use-page-permission";
import { BarcodeScanner } from "../../stock/_components/BarcodeScanner";
import { ManualLocationPicker } from "../../stock/_components/ManualLocationPicker";
import { ManualProductPicker } from "../../stock/_components/ManualProductPicker";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";

interface AuditScanPanelProps {
  onSuccess: (message: string) => void;
  editTarget?: AuditEditTarget | null;
  onCancelEdit?: () => void;
}

type ScanTarget = "location" | "product";

export function AuditScanPanel({ onSuccess, editTarget, onCancelEdit }: AuditScanPanelProps) {
  const { isInventoryWfEnabled, departments } = usePagePermissions();
  const form = useStockAuditForm(onSuccess, editTarget, departments);
  const [scanTarget, setScanTarget] = useState<ScanTarget>("location");
  const [scanMessage, setScanMessage] = useState("");

  const handleDetect = (text: string) => {
    if (scanTarget === "location") {
      const loc = form.findLocationById(text.trim());
      if (loc) {
        form.setSelectedLocation(loc);
        form.setError("");
        setScanMessage(`✅ ロケーションを読み取りました: ${loc.id} (${loc.name})`);
      } else {
        setScanMessage("");
        form.setError(`ロケーションコード「${text}」に該当するロケーションが見つかりません`);
      }
    } else {
      const product = form.findProductByBarcode(text.trim());
      if (product) {
        form.setSelectedProduct(product);
        form.setError("");
        setScanMessage(`✅ 品目を読み取りました: ${product.id} (${product.name})`);
      } else {
        setScanMessage("");
        form.setError(`バーコード「${text}」に該当する品目が見つかりません`);
      }
    }
  };

  return (
    <div className="space-y-4">
      {editTarget && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5">
          <p className="text-sm font-bold text-amber-800">
            ✏️ 棚卸[{editTarget.auditId}]を修正して再申請します(差戻し内容を書き換えます)
          </p>
          <button
            type="button"
            onClick={onCancelEdit}
            className="text-xs font-bold text-amber-700 hover:text-amber-900 cursor-pointer underline"
          >
            編集をキャンセル
          </button>
        </div>
      )}

      <MessageBanner message={scanMessage} error={form.error} />

      <p className="text-sm text-slate-600">
        ロケーションをスキャンすると、紐づく品目と理論在庫数が自動的に呼び出されます。
        未登録のロケーション(まだ一度も計上されていない在庫)の場合は、品目を手動で選択してください。
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setScanTarget("location");
            setScanMessage("");
          }}
          className={`text-sm px-4 py-2 rounded font-bold cursor-pointer border ${
            scanTarget === "location"
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-slate-700 border-slate-300"
          }`}
        >
          ① ロケーションをスキャン
        </button>
        <button
          type="button"
          onClick={() => {
            setScanTarget("product");
            setScanMessage("");
          }}
          className={`text-sm px-4 py-2 rounded font-bold cursor-pointer border ${
            scanTarget === "product"
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-slate-700 border-slate-300"
          }`}
        >
          ② 品目をスキャン(未登録在庫の場合のみ)
        </button>
      </div>

      <BarcodeScanner
        key={scanTarget}
        label={scanTarget === "location" ? "ロケーションQRスキャン" : "品目バーコードスキャン"}
        onDetect={handleDetect}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ManualLocationPicker
          locations={form.locations}
          warehouses={form.warehouses}
          onSelect={(l) => form.setSelectedLocation(l)}
        />
        <ManualProductPicker
          products={form.products}
          onSelect={(p) => form.setSelectedProduct(p)}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end bg-slate-50 p-3 rounded-lg border border-slate-200">
        <div className="text-sm">
          <p className="text-slate-600">選択中ロケーション</p>
          <p className="font-bold text-slate-900 text-base">
            {form.selectedLocation
              ? `${form.selectedLocation.id} (${form.selectedLocation.name})`
              : "未選択"}
          </p>
        </div>
        <div className="text-sm">
          <p className="text-slate-600">選択中品目</p>
          <p className="font-bold text-slate-900 text-base">
            {form.selectedProduct ? `${form.selectedProduct.id} (${form.selectedProduct.name})` : "未選択"}
          </p>
          {form.theoreticalQuantity !== null && (
            <p className="text-slate-600 font-semibold">理論数量: {form.theoreticalQuantity}</p>
          )}
        </div>
        <div className="text-sm">
          <label className="text-slate-600 block mb-1">実棚数量</label>
          <input
            type="number"
            value={form.countedQuantity}
            onChange={(e) => form.setCountedQuantity(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900 font-bold"
          />
        </div>
        <div className="text-sm">
          <p className="text-slate-600">差異</p>
          {form.differenceQuantity !== null ? (
            <p
              className={`font-bold text-base ${
                form.differenceQuantity === 0
                  ? "text-slate-900"
                  : form.differenceQuantity > 0
                    ? "text-emerald-700"
                    : "text-red-600"
              }`}
            >
              {form.differenceQuantity > 0 ? "+" : ""}
              {form.differenceQuantity}
            </p>
          ) : (
            <p className="text-slate-600">-</p>
          )}
        </div>
      </div>

      <div className="text-sm">
        <label className="text-slate-600 block mb-1">
          差異理由・特記事項(任意)
          {form.differenceQuantity !== null && form.differenceQuantity !== 0 && (
            <span className="text-amber-700 font-bold ml-1">
              ※理論数量と差異があります。原因が分かる場合は記録してください
            </span>
          )}
        </label>
        <textarea
          value={form.memo}
          onChange={(e) => form.setMemo(e.target.value)}
          rows={2}
          placeholder="例: 破損により廃棄予定、棚移動未反映、数え間違いの可能性 など"
          className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900"
        />
      </div>

      {isInventoryWfEnabled && (
        <ApplicantDepartmentSelect
          departments={departments}
          value={form.applicantDepartmentSurrogateId}
          onChange={form.setApplicantDepartmentSurrogateId}
        />
      )}

      <button
        type="button"
        onClick={form.submit}
        disabled={form.submitting}
        className={`w-full text-base text-white px-4 py-3 rounded font-bold disabled:bg-slate-300 disabled:cursor-not-allowed ${
          form.submitting
            ? ""
            : isInventoryWfEnabled
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 cursor-pointer"
              : "bg-amber-700 hover:bg-amber-800 cursor-pointer"
        }`}
      >
        {form.submitting
          ? editTarget
            ? "⏳ 再申請を送信中..."
            : isInventoryWfEnabled
              ? "⏳ 承認申請を送信中..."
              : "処理中..."
          : editTarget
            ? "✏️ 修正して再申請する"
            : isInventoryWfEnabled
              ? "✨ 棚卸の承認を申請する"
              : "棚卸確定"}
      </button>
    </div>
  );
}
