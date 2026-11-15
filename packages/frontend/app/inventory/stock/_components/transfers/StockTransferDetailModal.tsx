"use client";

import { useEffect, useState } from "react";
import { Modal } from "../../../../_shared/ui/Modal";
import { Button } from "../../../../_shared/ui/Button";
import {
  FormField,
  formFieldInputClass,
} from "../../../../_shared/ui/FormField";
import { MessageBanner } from "../../../../_shared/ui/MessageBanner";
import { StatusBadge } from "../../../../_shared/ui/StatusBadge";
import { apiFetch } from "../../../../_shared/hooks/use-api-fetch";
import { useConfirm } from "../../../../_shared/hooks/use-confirm";
import { todayJst } from "../../../../_shared/jst-date";
import { LocationRecord } from "../../_types";
import { TableScroll } from "../../../../_shared/ui/TableScroll";
import {
  StockTransferDetail,
  TRANSFER_STATUS_LABELS,
  TRANSFER_STATUS_TONES,
  remainingOf,
} from "../../_types/stock-transfers";

// REQ-006: 倉庫間移動の詳細。入荷の画面からは、輸送中の残りを入庫できる(分けて入庫できる)。届かない分は「差異で完了」で閉じる
interface Props {
  transferId: string;
  /** 入荷の画面から開いた時(入庫・差異で完了ができる) */
  canReceive: boolean;
  locations: LocationRecord[];
  warehouseName: (id: string | null) => string;
  productName: (id: string) => string;
  locationName: (id: string | null) => string;
  onClose: () => void;
  onChanged: (message: string) => void;
}

const RECEIPT_STATUS: Record<string, string> = {
  UNAPPROVED: "承認待ち",
  APPROVED: "確定",
  REMANDED: "差戻し",
  CANCELED: "取下げ",
};

export function StockTransferDetailModal({
  transferId,
  canReceive,
  locations,
  warehouseName,
  productName,
  locationName,
  onClose,
  onChanged,
}: Props) {
  const [detail, setDetail] = useState<StockTransferDetail | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [receivedDate, setReceivedDate] = useState(todayJst());
  const [lines, setLines] = useState<
    Record<string, { quantity: string; locationId: string }>
  >({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    let cancelled = false;
    apiFetch<StockTransferDetail>(
      `/api/stock-transfers/${encodeURIComponent(transferId)}`,
      {
        defaultErrorMessage: "倉庫間移動の取得に失敗しました",
      },
    )
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : "倉庫間移動の取得に失敗しました",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [transferId, reloadKey]);

  if (!detail) {
    return (
      <Modal
        title={`🔁 倉庫間移動 [${transferId}]`}
        size="2xl"
        onClose={onClose}
      >
        <MessageBanner error={error} />
      </Modal>
    );
  }

  const destinationLocations = locations.filter(
    (l) => l.warehouseId === detail.destinationWarehouseId,
  );
  const inTransit =
    detail.status === "IN_TRANSIT" || detail.status === "PARTIALLY_RECEIVED";
  const receivable = canReceive && inTransit && !detail.receiptInstructionId;
  const hasPendingReceipt = detail.items.some(
    (i) => (i.pendingReceiptQuantity ?? 0) > 0,
  );
  const lineOf = (id: string) => lines[id] ?? { quantity: "", locationId: "" };
  const chosen = detail.items.filter((i) => Number(lineOf(i.id).quantity) > 0);

  const receive = async () => {
    setError("");
    setSaving(true);
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/stock-transfers/${encodeURIComponent(transferId)}/receive`,
        {
          method: "POST",
          json: {
            receivedDate,
            items: chosen.map((i) => ({
              transferItemId: i.id,
              locationId: lineOf(i.id).locationId,
              quantity: Number(lineOf(i.id).quantity),
            })),
          },
          defaultErrorMessage: "入庫に失敗しました",
        },
      );
      setLines({});
      setReloadKey((k) => k + 1);
      onChanged(data.message || "入庫しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "入庫に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    if (
      !(await confirm(
        "届いていない数量を差異として記録し、この倉庫間移動を完了しますか？(在庫は戻りません)",
      ))
    )
      return;
    setError("");
    try {
      const data = await apiFetch<{ message?: string }>(
        `/api/stock-transfers/${encodeURIComponent(transferId)}/close`,
        {
          method: "POST",
          json: { reason },
          defaultErrorMessage: "差異で完了できませんでした",
        },
      );
      setReloadKey((k) => k + 1);
      onChanged(data.message || "差異で完了しました");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "差異で完了できませんでした",
      );
    }
  };

  return (
    <Modal
      title={`🔁 倉庫間移動 [${transferId}]`}
      size="2xl"
      onClose={onClose}
      warnOnDiscard
      // 入庫・差異で完了に成功したら(読み直したら)、未保存の編集の印を消す(保存した後の✕で確認を出さない)
      discardResetKey={reloadKey}
    >
      <div className="space-y-3 text-xs">
        <MessageBanner error={error} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 rounded-lg p-3 border border-slate-200">
          <Info
            label="移動元 → 移動先"
            value={`${warehouseName(detail.sourceWarehouseId)} → ${warehouseName(detail.destinationWarehouseId)}`}
          />
          <Info label="出庫日" value={detail.shippedDate.slice(0, 10)} />
          <div>
            <span className="block font-bold text-slate-600">状態</span>
            <StatusBadge
              label={TRANSFER_STATUS_LABELS[detail.status]}
              tone={TRANSFER_STATUS_TONES[detail.status]}
            />
          </div>
          <Info
            label="出庫・指示書"
            value={
              [
                detail.shipment ? `出庫 ${detail.shipment.id}` : "",
                detail.shipmentInstructionId
                  ? `出荷指示 ${detail.shipmentInstructionId}`
                  : "",
                detail.receiptInstructionId
                  ? `入荷指示 ${detail.receiptInstructionId}`
                  : "",
              ]
                .filter(Boolean)
                .join(" / ") || "-"
            }
          />
        </div>
        {detail.closedReason && (
          <p className="font-bold text-red-700">
            差異で完了した理由: {detail.closedReason}
          </p>
        )}
        {detail.receiptInstructionId && inTransit && (
          <p className="text-slate-700">
            移動先が外部倉庫のため、入荷の画面の「入荷実績入力」で入荷指示の実績を取り込むと入庫されます。
          </p>
        )}

        <div className="border border-slate-200 rounded-lg">
          <TableScroll minWidth={640}>
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-2">品目</th>
                  <th className="px-3 py-2">移動元のロケーション</th>
                  <th className="px-3 py-2 text-right">出庫数</th>
                  <th className="px-3 py-2 text-right">入庫済み</th>
                  <th className="px-3 py-2 text-right">差異</th>
                  <th className="px-3 py-2 text-right">輸送中</th>
                  {receivable && (
                    <th className="px-3 py-2">入庫する数量・ロケーション</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {detail.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      {productName(item.itemId)}
                      {item.lotNumber !== "NONE" && (
                        <span className="block text-slate-600">
                          ロット {item.lotNumber}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {locationName(item.sourceLocationId) || "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {item.quantity}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {item.receivedQuantity}
                      {!!item.pendingReceiptQuantity && (
                        <span className="block text-amber-800">
                          承認待ち {item.pendingReceiptQuantity}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {item.differenceQuantity || ""}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold">
                      {inTransit ? remainingOf(item) : 0}
                    </td>
                    {receivable && (
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <input
                            aria-label={`${productName(item.itemId)}の入庫する数量`}
                            type="number"
                            min={0}
                            step="any"
                            className={`${formFieldInputClass} w-24`}
                            value={lineOf(item.id).quantity}
                            onChange={(e) =>
                              setLines({
                                ...lines,
                                [item.id]: {
                                  ...lineOf(item.id),
                                  quantity: e.target.value,
                                },
                              })
                            }
                          />
                          <select
                            aria-label={`${productName(item.itemId)}の入庫するロケーション`}
                            className={formFieldInputClass}
                            value={lineOf(item.id).locationId}
                            onChange={(e) =>
                              setLines({
                                ...lines,
                                [item.id]: {
                                  ...lineOf(item.id),
                                  locationId: e.target.value,
                                },
                              })
                            }
                          >
                            <option value="">-- ロケーション --</option>
                            {destinationLocations.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>

        {receivable && (
          <div className="flex flex-wrap items-end justify-end gap-2">
            <FormField label="入庫日" required>
              <input
                type="date"
                className={formFieldInputClass}
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
              />
            </FormField>
            <Button
              variant="success"
              onClick={() => void receive()}
              disabled={
                saving ||
                chosen.length === 0 ||
                chosen.some((i) => !lineOf(i.id).locationId)
              }
            >
              入庫する
            </Button>
          </div>
        )}

        {detail.receipts.length > 0 && (
          <div className="border border-slate-200 rounded-lg p-3">
            <p className="font-bold text-slate-700 mb-1">入庫</p>
            <ul className="space-y-0.5 text-slate-800">
              {detail.receipts.map((r) => (
                <li key={r.id}>
                  {r.receivedDate.slice(0, 10)} 入庫 {r.id}(
                  {RECEIPT_STATUS[r.status] ?? r.status})
                </li>
              ))}
            </ul>
          </div>
        )}

        {canReceive && inTransit && (
          <div className="border border-slate-200 rounded-lg p-3 space-y-2">
            <p className="font-bold text-slate-800">差異で完了する</p>
            <p className="text-slate-700">
              届かない数量を差異として記録し、この移動を完了します(在庫は戻りません)。
            </p>
            {hasPendingReceipt && (
              <p className="font-bold text-amber-800">
                承認待ちの入庫があるため、まだ完了できません。
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <FormField label="理由" required>
                <input
                  className={`${formFieldInputClass} w-72`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </FormField>
              <Button
                variant="danger"
                onClick={() => void close()}
                disabled={!reason.trim() || hasPendingReceipt}
              >
                差異で完了する
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block font-bold text-slate-600">{label}</span>
      <span className="font-bold text-slate-800 break-all">{value}</span>
    </div>
  );
}
