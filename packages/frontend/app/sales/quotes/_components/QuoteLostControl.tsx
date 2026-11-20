"use client";

import { useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { todayJst } from "../../../_shared/jst-date";

// REQ-015: 見積の失注。承認済み(確定済み)の見積を失注にする(失注日・理由)。失注の見積は失注日・理由を出し、失注を取り消せる。
// 受注に使われている見積は、サーバーが断る(理由を画面に出す)
interface QuoteLostControlProps {
  quoteId: string;
  status: string;
  lostDate?: string | null;
  lostReason?: string | null;
  canUpdate?: boolean;
  onChanged: (message: string) => void;
}

export function QuoteLostControl({ quoteId, status, lostDate, lostReason, canUpdate = true, onChanged }: QuoteLostControlProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayJst());
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const call = async (path: string, json?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ message?: string }>(`/api/quotes/${encodeURIComponent(quoteId)}/${path}`, {
        method: "POST",
        json: json ?? {},
        defaultErrorMessage: "処理に失敗しました",
      });
      setOpen(false);
      onChanged(result.message || "処理しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (status === "LOST") {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 space-y-2">
        <p className="font-bold">⚫ この見積は失注です(編集・受注への変換・メール送信はできません。複写はできます)</p>
        <p>
          失注日: <span className="font-mono">{lostDate || "-"}</span>
          {lostReason ? <span className="ml-3">理由: {lostReason}</span> : null}
        </p>
        <MessageBanner error={error} />
        {canUpdate && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void call("cancel-lost")}>
            {busy ? "処理中..." : "↩ 失注を取り消す"}
          </Button>
        )}
      </div>
    );
  }
  if (status !== "APPROVED" || !canUpdate) return null;

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setDate(todayJst());
          setReason("");
          setError("");
          setOpen(true);
        }}
      >
        ⚫ 失注にする
      </Button>
      {open && (
        <Modal
          title="⚫ 見積を失注にする"
          onClose={() => setOpen(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                キャンセル
              </Button>
              <Button variant="danger" disabled={busy || !date} onClick={() => void call("mark-lost", { lostDate: date, lostReason: reason })}>
                {busy ? "処理中..." : "失注にする"}
              </Button>
            </div>
          }
        >
          <MessageBanner error={error} />
          <FormField label="失注日" required>
            <input type="date" aria-label="失注日" className={formFieldInputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="失注理由">
            <textarea
              aria-label="失注理由"
              className={`${formFieldInputClass} h-20`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 価格で他社に決まった"
            />
          </FormField>
        </Modal>
      )}
    </>
  );
}
