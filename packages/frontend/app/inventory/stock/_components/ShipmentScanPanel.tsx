"use client";

import { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import {
  ShipmentEditTarget,
  useStockShipmentForm,
} from "../_hooks/useStockShipmentForm";
import { usePagePermissions } from "../../../hooks/use-page-permission";
import { BarcodeScanner } from "./BarcodeScanner";
import { ManualLocationPicker } from "./ManualLocationPicker";
import { ManualProductPicker } from "./ManualProductPicker";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { DataTable } from "../../../_shared/ui/DataTable";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";

interface ShipmentScanPanelProps {
  onSuccess: (message: string) => void;
  editTarget?: ShipmentEditTarget | null;
  onCancelEdit?: () => void;
  // Item6 Phase6-4: /inventory/instructions(外部倉庫実績入力)から使う場合は"EXTERNAL"を渡す
  warehouseType?: "INTERNAL" | "EXTERNAL";
}

type ScanTarget = "location" | "product";

export function ShipmentScanPanel({
  onSuccess,
  editTarget,
  onCancelEdit,
  warehouseType = "INTERNAL",
}: ShipmentScanPanelProps) {
  const { isShippingWfEnabled, departments } = usePagePermissions();
  const form = useStockShipmentForm(
    onSuccess,
    editTarget,
    warehouseType,
    departments,
  );
  const [scanTarget, setScanTarget] = useState<ScanTarget>("location");
  const [scanMessage, setScanMessage] = useState("");

  const handleDetect = (text: string) => {
    if (scanTarget === "location") {
      const loc = form.findLocationById(text.trim());
      if (loc) {
        form.setSelectedLocation(loc);
        form.setError("");
        setScanMessage(
          `✅ ロケーションを読み取りました: ${loc.id} (${loc.name})`,
        );
      } else {
        setScanMessage("");
        form.setError(
          `ロケーションコード「${text}」に該当するロケーションが見つかりません`,
        );
      }
    } else {
      const product = form.findProductByBarcode(text.trim());
      if (product) {
        form.setSelectedProduct(product);
        form.setError("");
        setScanMessage(
          `✅ 品目を読み取りました: ${product.id} (${product.name})`,
        );
      } else {
        setScanMessage("");
        form.setError(`バーコード「${text}」に該当する品目が見つかりません`);
      }
    }
  };

  const matched =
    form.selectedLocation && form.selectedProduct
      ? form.matchedStock(form.selectedLocation.id, form.selectedProduct.id)
      : null;

  const selectedInstruction =
    form.instructions.find((i) => i.id === form.shipmentInstructionId) || null;

  return (
    <div className="space-y-4">
      {editTarget && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5">
          <p className="text-sm font-bold text-amber-800">
            ✏️ 出庫[{editTarget.headerId}
            ]を修正して再申請します(差戻し内容を書き換えます)
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

      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
        <div>
          <label className="text-sm text-slate-600 block mb-1">
            消込対象の出荷指示(任意・指定すると指示の充足状況を更新します)
          </label>
          <select
            value={form.shipmentInstructionId}
            onChange={(e) => form.setShipmentInstructionId(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-white text-slate-900 font-bold"
          >
            <option value="">指定しない</option>
            {form.instructions
              .filter(
                (i) =>
                  warehouseType !== "EXTERNAL" ||
                  !form.selectedLocation ||
                  i.warehouseId === form.selectedLocation.warehouseId,
              )
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id} (
                  {i.salesOrderId ? `受注: ${i.salesOrderId}` : "単独作成"})
                </option>
              ))}
          </select>
        </div>
        {form.shipmentInstructionId && (
          <p
            className={`text-xs font-bold px-2.5 py-1.5 rounded border ${
              selectedInstruction?.salesOrderId
                ? "bg-indigo-50 border-indigo-200 text-indigo-800"
                : "bg-slate-100 border-slate-200 text-slate-600"
            }`}
          >
            {selectedInstruction?.salesOrderId
              ? `🔗 この出荷指示は受注[${selectedInstruction.salesOrderId}]から作成されています`
              : "この出荷指示は受注に紐づかない単独作成です"}
          </p>
        )}
        {form.shipmentInstructionId && form.instructionItems.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-slate-600">
              指示の明細をクリックすると、品目・数量を入力欄へ反映します(ロケーションは別途選択してください)
            </p>
            <div className="flex flex-wrap gap-2">
              {form.instructionItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => form.applyInstructionItem(item)}
                  className="text-xs border border-indigo-300 bg-white hover:bg-indigo-50 text-indigo-700 px-2.5 py-1.5 rounded font-bold cursor-pointer"
                >
                  {item.itemId} / {item.lotNumber} / {item.instructedQuantity}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
        <div>
          <label className="text-sm text-slate-600 block mb-1">
            受注から選ぶ(任意・出荷指示を経由せず受注残と直接消込します)
          </label>
          <select
            value={form.salesOrderId}
            onChange={(e) => form.setSalesOrderId(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-white text-slate-900 font-bold"
          >
            <option value="">指定しない</option>
            {form.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id}
              </option>
            ))}
          </select>
        </div>
        {form.salesOrderId && form.orderItems.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-slate-600">
              受注の明細(残数量のある品目のみ)をクリックすると、品目・数量を入力欄へ反映します(ロケーションは別途選択してください)
            </p>
            <div className="flex flex-wrap gap-2">
              {form.orderItems.map((item) => (
                <button
                  key={item.salesOrderItemId}
                  type="button"
                  onClick={() => form.applyOrderItem(item)}
                  className="text-xs border border-indigo-300 bg-white hover:bg-indigo-50 text-indigo-700 px-2.5 py-1.5 rounded font-bold cursor-pointer"
                >
                  {item.itemName || item.itemId} / 残{item.remainingQuantity}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-3">
        <div>
          <label className="text-sm text-slate-700 block mb-1">
            得意先(任意・設定すると出庫確定時に納品書を発行します)
          </label>
          <select
            value={form.partnerId}
            onChange={(e) => form.setPartnerId(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-white text-slate-900 font-bold"
          >
            <option value="">指定しない</option>
            {form.partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} ({p.name})
              </option>
            ))}
          </select>
        </div>

        {/* 新規要望(2026-09-23): 倉庫間移動。得意先の代わりに移動先倉庫を選べる(排他) */}
        <div>
          <label className="text-sm text-slate-700 block mb-1">
            移動先倉庫(任意・倉庫間移動の場合。得意先とは同時に指定できません)
          </label>
          <select
            value={form.destinationWarehouseId}
            onChange={(e) => form.setDestinationWarehouseId(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-white text-slate-900 font-bold"
          >
            <option value="">指定しない</option>
            {form.allWarehouses.map((w) => (
              <option key={w.id} value={w.id}>
                [{w.id}] {w.name}({w.warehouseType === "EXTERNAL" ? "外部" : "自社"})
              </option>
            ))}
          </select>
        </div>
      </div>

      {warehouseType === "INTERNAL" && (
        <>
          <p className="text-sm text-slate-600">
            ロケーションと品目バーコードの両方をスキャンして出庫対象を特定します。
            ロケーションに出庫できる品目が1つだけの場合は、ロケーションを選ぶだけで品目が決まり、数量の入力だけで出庫できます。
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
              ② 品目バーコードをスキャン
            </button>
          </div>

          <BarcodeScanner
            key={scanTarget}
            label={
              scanTarget === "location"
                ? "ロケーションQRスキャン"
                : "品目バーコードスキャン"
            }
            onDetect={handleDetect}
            resultMessage={scanMessage}
            resultError={form.error}
          />
        </>
      )}

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
            {form.selectedProduct
              ? `${form.selectedProduct.id} (${form.selectedProduct.name})`
              : "未選択"}
          </p>
          {form.productAutoSelected && (
            <p className="text-indigo-700 text-xs font-semibold">
              📦 このロケーションには品目が1つだけのため、自動で選択しました
            </p>
          )}
          {form.selectedLocation &&
            form.selectedProduct &&
            (matched ? (
              <p className="text-emerald-700 font-semibold">
                在庫残数: {matched.quantity}
              </p>
            ) : (
              <p className="text-red-600 font-semibold">
                このロケーションに該当品目の在庫がありません
              </p>
            ))}
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="text-sm text-slate-600 block mb-1">数量</label>
          <input
            type="number"
            value={form.quantity}
            onChange={(e) => form.setQuantity(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900 font-bold"
          />
        </div>
      </div>

      <Button onClick={form.addLine}>＋ 明細に追加</Button>

      {form.lines.length > 0 && (
        <DataTable
          columns={[
            { key: "location", label: "ロケーション" },
            { key: "item", label: "品目" },
            { key: "quantity", label: "数量", align: "right" },
            { key: "actions", label: "" },
          ]}
          data={form.lines}
          renderRow={(l) => (
            <tr key={l.key} className="hover:bg-slate-50 text-sm">
              <td className="px-4 py-2 font-semibold">
                {l.locationId} ({l.locationName})
              </td>
              <td className="px-4 py-2 font-semibold">
                {l.itemId} ({l.itemName})
              </td>
              <td className="px-4 py-2 text-right">
                <input
                  type="number"
                  value={l.quantity}
                  onChange={(e) =>
                    form.updateLineQuantity(l.key, Number(e.target.value))
                  }
                  className="w-24 text-right text-sm font-bold border border-slate-300 rounded px-2 py-1 bg-slate-50 text-slate-900"
                />
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  type="button"
                  onClick={() => form.removeLine(l.key)}
                  className="text-red-600 hover:text-red-800 cursor-pointer text-sm font-bold"
                >
                  削除
                </button>
              </td>
            </tr>
          )}
        />
      )}

      {isShippingWfEnabled && (
        <ApplicantDepartmentSelect
          departments={departments}
          value={form.applicantDepartmentSurrogateId}
          onChange={form.setApplicantDepartmentSurrogateId}
        />
      )}

      <button
        type="button"
        onClick={form.submit}
        disabled={form.submitting || form.lines.length === 0}
        className={`w-full text-base text-white px-4 py-3 rounded font-bold disabled:bg-slate-300 disabled:cursor-not-allowed ${
          form.submitting || form.lines.length === 0
            ? ""
            : isShippingWfEnabled
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 cursor-pointer"
              : "bg-amber-700 hover:bg-amber-800 cursor-pointer"
        }`}
      >
        {form.submitting
          ? editTarget
            ? "⏳ 再申請を送信中..."
            : isShippingWfEnabled
              ? "⏳ 承認申請を送信中..."
              : "処理中..."
          : editTarget
            ? `✏️ 修正して再申請する(${form.lines.length}件)`
            : isShippingWfEnabled
              ? `✨ 出庫の承認を申請する(${form.lines.length}件)`
              : `出庫確定(${form.lines.length}件)`}
      </button>
    </div>
  );
}
