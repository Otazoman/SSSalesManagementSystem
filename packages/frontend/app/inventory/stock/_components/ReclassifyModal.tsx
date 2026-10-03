"use client";

import { useEffect, useState } from "react";
import { Modal } from "../../../_shared/ui/Modal";
import { DiscardCancelButton } from "../../../_shared/ui/DiscardGuard";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { ReclassificationRecord, StockRecord } from "../_types";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

export interface ReclassificationEditTarget {
  reclassificationId: string;
  record: ReclassificationRecord;
}

interface ReclassifyModalProps {
  // 新規作成モード: 在庫一覧の行から呼び出す
  stock?: StockRecord;
  // 修正して再提出モード: 差戻し済みの品質区分変更を編集する
  editTarget?: ReclassificationEditTarget | null;
  isDamageWfEnabled: boolean;
  departments?: ApplicantDepartmentOption[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const QUALITY_LABELS: Record<string, string> = {
  NORMAL: "🟢 良品",
  DAMAGED: "🔴 破損品",
  QUARANTINE: "🟡 検品待ち",
};

const QUALITY_OPTIONS = ["NORMAL", "DAMAGED", "QUARANTINE"];

/**
 * Item6 Phase6-3-2: 在庫の品質区分変更(破損・不良品管理)。棚卸中の発見・出庫時の発見・
 * 通常の保管中点検、いずれの場合もStockTableの行から呼び出す共通のフォーム。
 * 良品⇔破損品/検品待ちどちらの向きの変更も承認対象になり得るため(is_damage_approval_enabled)、
 * 送信後は承認待ちになる場合がある。差戻し後の修正して再提出はeditTarget経由で同じフォームを使う
 * (targetTypeが入出庫と同じ"inventory_stock"のため、/inventory/stockのeditId解決フローから開かれる)。
 */
export function ReclassifyModal({
  stock,
  editTarget,
  isDamageWfEnabled,
  departments = [],
  onClose,
  onSuccess,
}: ReclassifyModalProps) {
  const itemId = editTarget ? editTarget.record.itemId : stock!.itemId;
  const warehouseId = editTarget
    ? editTarget.record.warehouseId
    : stock!.warehouseId;
  const locationId = editTarget
    ? editTarget.record.locationId
    : stock!.locationId;
  const lotNumber = editTarget ? editTarget.record.lotNumber : stock!.lotNumber;
  const accountCode = editTarget
    ? editTarget.record.accountCode
    : stock!.accountCode;
  const fromQualityStatus = editTarget
    ? editTarget.record.fromQualityStatus
    : stock!.qualityStatus;
  const itemLabel = editTarget ? itemId : stock!.itemName || stock!.itemId;
  const locationLabel = editTarget
    ? locationId
    : stock!.locationName || stock!.locationId;
  const residualQuantity = editTarget ? null : stock!.quantity;

  const [toQualityStatus, setToQualityStatus] = useState(
    editTarget?.record.toQualityStatus ||
      QUALITY_OPTIONS.find((q) => q !== fromQualityStatus) ||
      "DAMAGED",
  );
  const [quantity, setQuantity] = useState(
    editTarget ? String(editTarget.record.quantity) : "",
  );
  const [memo, setMemo] = useState(editTarget?.record.memo || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 追加要望F: 複数部門所属時の申請部門選択(初期値は所属部門の先頭=従来の暗黙動作と同じ)
  const [applicantDepartmentSurrogateId, setApplicantDepartmentSurrogateId] =
    useState<string | null>(null);
  useEffect(() => {
    if (applicantDepartmentSurrogateId === null && departments.length > 0) {
      setApplicantDepartmentSurrogateId(departments[0].surrogateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);

  const submit = async () => {
    setError("");
    const qty = Number(quantity);
    if (quantity === "" || Number.isNaN(qty) || qty <= 0) {
      setError("数量は0より大きい数値で入力してください");
      return;
    }
    if (residualQuantity !== null && qty > residualQuantity) {
      setError(`変更元の在庫残数(${residualQuantity})を超えています`);
      return;
    }

    setSubmitting(true);
    try {
      const url = editTarget
        ? `/api/stock-reclassifications/${editTarget.reclassificationId}`
        : "/api/stock-reclassifications/register";
      const defaultErrorMessage = editTarget
        ? "品質区分変更の修正・再申請に失敗しました"
        : "品質区分変更に失敗しました";
      const result = await apiFetch<{ message: string }>(url, {
        method: editTarget ? "PUT" : "POST",
        json: {
          itemId,
          warehouseId,
          locationId,
          lotNumber,
          accountCode,
          fromQualityStatus,
          toQualityStatus,
          quantity: qty,
          ...(memo.trim() ? { memo: memo.trim() } : {}),
          applicantDepartmentSurrogateId,
        },
        defaultErrorMessage,
      });
      onSuccess(result.message);
      onClose();
    } catch (err: unknown) {
      const fallback = editTarget
        ? "品質区分変更の修正・再申請に失敗しました"
        : "品質区分変更に失敗しました";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      warnOnDiscard
      title={
        <>{editTarget ? "✏️ 品質区分変更の修正・再申請" : "🔴 品質区分変更"}</>
      }
      onClose={onClose}
    >
      <div className="text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
        <p className="text-slate-600">
          対象: <span className="font-bold text-slate-900">{itemLabel}</span>{" "}
          (ロケーション: {locationLabel} / ロット: {lotNumber})
        </p>
        <p className="text-slate-600">
          変更元:{" "}
          <span className="font-bold">{QUALITY_LABELS[fromQualityStatus]}</span>
          {residualQuantity !== null && <> (残数: {residualQuantity})</>}
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-sm text-slate-600 block mb-1">
            変更先の品質区分
          </label>
          <select
            value={toQualityStatus}
            onChange={(e) => setToQualityStatus(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900 cursor-pointer"
          >
            {QUALITY_OPTIONS.filter((q) => q !== fromQualityStatus).map((q) => (
              <option key={q} value={q}>
                {QUALITY_LABELS[q]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-600 block mb-1">数量</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900 font-bold"
          />
        </div>
        <div>
          <label className="text-sm text-slate-600 block mb-1">
            理由・特記事項(任意)
          </label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            placeholder="例: 保管中に外装破損を確認"
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900"
          />
        </div>
      </div>

      {isDamageWfEnabled && (
        <ApplicantDepartmentSelect
          departments={departments}
          value={applicantDepartmentSurrogateId}
          onChange={setApplicantDepartmentSurrogateId}
        />
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="flex-1 text-sm text-white px-3 py-2 rounded font-bold cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-700 hover:to-orange-700"
        >
          {submitting
            ? "処理中..."
            : editTarget
              ? "✏️ 修正して再申請する"
              : isDamageWfEnabled
                ? "✨ 承認を申請する"
                : "品質区分変更を確定"}
        </button>
        <DiscardCancelButton
          onCancel={onClose}
          className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded font-bold cursor-pointer"
        />
      </div>
    </Modal>
  );
}
