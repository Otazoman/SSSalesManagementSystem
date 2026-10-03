"use client";

import { useEffect, useState } from "react";
import { Modal } from "../../../_shared/ui/Modal";
import { DiscardCancelButton } from "../../../_shared/ui/DiscardGuard";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { ReturnRecord, StockRecord } from "../_types";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";
import { todayJst } from "../../../_shared/jst-date";

export interface ReturnEditTarget {
  returnId: string;
  record: ReturnRecord;
}

interface ReturnModalProps {
  // 新規作成モード: 在庫一覧の行から呼び出す
  stock?: StockRecord;
  // 修正して再提出モード: 差戻し済みの返品を編集する
  editTarget?: ReturnEditTarget | null;
  isReturnWfEnabled: boolean;
  departments?: ApplicantDepartmentOption[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const QUALITY_LABELS: Record<string, string> = {
  NORMAL: "🟢 良品",
  DAMAGED: "🔴 破損品",
  QUARANTINE: "🟡 検品待ち",
};

const DIRECTION_LABELS: Record<string, string> = {
  OUTBOUND: "仕入先へ返品(在庫減少)",
  INBOUND: "得意先から返品(在庫増加)",
};

function todayInputValue() {
  return todayJst();
}

/**
 * Item6 Phase6-3-3: 在庫の返品登録。仕入先へ返品(自社在庫減少)/得意先から返品(自社在庫増加)の
 * 両方向に対応する。品質区分は問わない。StockTableの行から呼び出す共通のフォーム。承認対象になり
 * 得るため(is_return_approval_enabled)、送信後は承認待ちになる場合がある。差戻し後の修正して
 * 再提出はeditTarget経由で同じフォームを使う(targetTypeが入出庫と同じ"inventory_stock"のため、
 * /inventory/stockのeditId解決フローから開かれる)。
 */
export function ReturnModal({
  stock,
  editTarget,
  isReturnWfEnabled,
  departments = [],
  onClose,
  onSuccess,
}: ReturnModalProps) {
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
  const qualityStatus = editTarget
    ? editTarget.record.qualityStatus
    : stock!.qualityStatus;
  const itemLabel = editTarget ? itemId : stock!.itemName || stock!.itemId;
  const locationLabel = editTarget
    ? locationId
    : stock!.locationName || stock!.locationId;
  const availableQuantity = editTarget ? null : stock!.quantity;

  const [direction, setDirection] = useState<"OUTBOUND" | "INBOUND">(
    editTarget?.record.direction || "OUTBOUND",
  );
  const [quantity, setQuantity] = useState(
    editTarget ? String(editTarget.record.quantity) : "",
  );
  const [returnDate, setReturnDate] = useState(
    editTarget ? editTarget.record.returnDate.slice(0, 10) : todayInputValue(),
  );
  const [returnReason, setReturnReason] = useState(
    editTarget?.record.returnReason || "",
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
    if (
      direction === "OUTBOUND" &&
      availableQuantity !== null &&
      qty > availableQuantity
    ) {
      setError(`在庫残数(${availableQuantity})を超えています`);
      return;
    }
    if (!returnDate) {
      setError("返品日を指定してください");
      return;
    }

    setSubmitting(true);
    try {
      const url = editTarget
        ? `/api/stock-returns/${editTarget.returnId}`
        : "/api/stock-returns/register";
      const defaultErrorMessage = editTarget
        ? "返品の修正・再申請に失敗しました"
        : "返品に失敗しました";
      const result = await apiFetch<{ message: string }>(url, {
        method: editTarget ? "PUT" : "POST",
        json: {
          itemId,
          warehouseId,
          locationId,
          lotNumber,
          accountCode,
          qualityStatus,
          direction,
          quantity: qty,
          returnDate,
          ...(returnReason.trim() ? { returnReason: returnReason.trim() } : {}),
          ...(memo.trim() ? { memo: memo.trim() } : {}),
          applicantDepartmentSurrogateId,
        },
        defaultErrorMessage,
      });
      onSuccess(result.message);
      onClose();
    } catch (err: unknown) {
      const fallback = editTarget
        ? "返品の修正・再申請に失敗しました"
        : "返品に失敗しました";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      warnOnDiscard
      title={<>{editTarget ? "✏️ 返品の修正・再申請" : "↩️ 返品登録"}</>}
      onClose={onClose}
    >
      <div className="text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
        <p className="text-slate-600">
          対象: <span className="font-bold text-slate-900">{itemLabel}</span>{" "}
          (ロケーション: {locationLabel} / ロット: {lotNumber})
        </p>
        <p className="text-slate-600">
          品質区分:{" "}
          <span className="font-bold">
            {QUALITY_LABELS[qualityStatus] || qualityStatus}
          </span>
          {availableQuantity !== null && <> (在庫残数: {availableQuantity})</>}
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-sm text-slate-600 block mb-1">返品方向</label>
          <select
            value={direction}
            onChange={(e) =>
              setDirection(e.target.value as "OUTBOUND" | "INBOUND")
            }
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900 cursor-pointer"
          >
            {(
              Object.keys(DIRECTION_LABELS) as Array<"OUTBOUND" | "INBOUND">
            ).map((d) => (
              <option key={d} value={d}>
                {DIRECTION_LABELS[d]}
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
          <label className="text-sm text-slate-600 block mb-1">返品日</label>
          <input
            type="date"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900"
          />
        </div>
        <div>
          <label className="text-sm text-slate-600 block mb-1">
            返品理由(任意)
          </label>
          <input
            type="text"
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder="例: 数量誤発注、不良品交換"
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900"
          />
        </div>
        <div>
          <label className="text-sm text-slate-600 block mb-1">
            備考(任意)
          </label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            className="w-full text-sm border border-slate-300 rounded px-2 py-2 bg-slate-50 text-slate-900"
          />
        </div>
      </div>

      {isReturnWfEnabled && (
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
          className="flex-1 text-sm text-white px-3 py-2 rounded font-bold cursor-pointer disabled:bg-slate-300 disabled:cursor-not-allowed bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700"
        >
          {submitting
            ? "処理中..."
            : editTarget
              ? "✏️ 修正して再申請する"
              : isReturnWfEnabled
                ? "✨ 承認を申請する"
                : "返品を確定"}
        </button>
        <DiscardCancelButton
          onCancel={onClose}
          className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded font-bold cursor-pointer"
        />
      </div>
    </Modal>
  );
}
