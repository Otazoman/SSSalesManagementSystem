"use client";

import { useEffect, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface PartnerDeliveryDestinationRecord {
  id: string;
  partnerId: string;
  name: string;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  memo: string | null;
  status: string;
}

interface PartnerDeliveryDestinationsModalProps {
  partnerId: string;
  partnerName: string;
  canUpdate: boolean;
  onClose: () => void;
}

// 新規要望(2026-09-23): 取引先マスタの複数納品先(受注の納品先選択で使う)管理モーダル。
// warehouses画面のWarehouseContactsModal(承認ワークフローなしの簡易版)と同じ方式
export function PartnerDeliveryDestinationsModal({
  partnerId,
  partnerName,
  canUpdate,
  onClose,
}: PartnerDeliveryDestinationsModalProps) {
  const confirm = useConfirm();
  const [destinations, setDestinations] = useState<PartnerDeliveryDestinationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refetch = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PartnerDeliveryDestinationRecord[]>(
        `/api/partner-delivery-destinations?partnerId=${encodeURIComponent(partnerId)}&status=all`,
      );
      setDestinations(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "納品先の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  const handleAdd = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!name.trim()) {
      setError("納品先名を入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiFetch<{ message: string }>("/api/partner-delivery-destinations/register", {
        method: "POST",
        json: {
          partnerId,
          name,
          postalCode: postalCode || null,
          address: address || null,
          phone: phone || null,
          memo: null,
        },
        defaultErrorMessage: "納品先の登録に失敗しました",
      });
      setMessage(result.message);
      setName("");
      setPostalCode("");
      setAddress("");
      setPhone("");
      await refetch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "納品先の登録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSuspend = async (id: string) => {
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<{ message: string }>(
        `/api/partner-delivery-destinations/${id}/suspend`,
        { method: "POST", defaultErrorMessage: "納品先の無効化に失敗しました" },
      );
      setMessage(result.message);
      await refetch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "納品先の無効化に失敗しました");
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm("この納品先を完全に削除しますか？"))) return;
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<{ message: string }>(`/api/partner-delivery-destinations/${id}`, {
        method: "DELETE",
        defaultErrorMessage: "納品先の削除に失敗しました",
      });
      setMessage(result.message);
      await refetch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "納品先の削除に失敗しました");
    }
  };

  return (
    <Modal
      title={
        <>
          📦 納品先管理: {partnerName} ({partnerId})
        </>
      }
      size="2xl"
      onClose={onClose}
    >
      <p className="text-xs text-slate-600">
        ここに登録した納品先が、受注の「納品場所」選択で使えます(複数登録可)。あわせて手入力も引き続き使えます。
      </p>

      <MessageBanner message={message} error={error} />

      {canUpdate && (
        <form
          onSubmit={handleAdd}
          className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2"
        >
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input
              type="text"
              placeholder="納品先名(必須)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={formFieldInputClass}
            />
            <input
              type="text"
              placeholder="郵便番号"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className={formFieldInputClass}
            />
            <input
              type="text"
              placeholder="住所"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={formFieldInputClass}
            />
            <input
              type="text"
              placeholder="電話番号"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={formFieldInputClass}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? "登録中..." : "＋ 納品先を追加"}
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {loading && <p className="text-xs text-slate-600 italic">読み込み中...</p>}
        {!loading && destinations.length === 0 && (
          <p className="text-xs text-slate-600 italic">登録済みの納品先がありません。</p>
        )}
        {destinations.map((d) => (
          <div
            key={d.id}
            className={`p-3 rounded-lg border space-y-1 ${
              d.status === "suspended"
                ? "bg-slate-50 border-slate-200 opacity-60"
                : "bg-white border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <p className="font-bold text-slate-900">
                  {d.name}
                  {d.status === "suspended" && (
                    <span className="text-[10px] text-red-600 font-bold ml-1">無効化済み</span>
                  )}
                </p>
                <p className="text-slate-700 text-xs">
                  〒{d.postalCode || "-"} {d.address || ""}
                </p>
                {d.phone && <p className="text-slate-700 text-xs">TEL: {d.phone}</p>}
              </div>
              {canUpdate && (
                <div className="space-x-3 shrink-0">
                  {d.status !== "suspended" ? (
                    <button
                      type="button"
                      onClick={() => void handleSuspend(d.id)}
                      className="text-xs font-bold text-amber-600 hover:underline cursor-pointer"
                    >
                      無効化
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleDelete(d.id)}
                      className="text-xs font-bold text-red-600 hover:underline cursor-pointer"
                    >
                      完全に削除
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
