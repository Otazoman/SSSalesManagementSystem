"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../hooks/use-api-fetch";
import { usePagePermissions } from "../../hooks/use-page-permission";
import type { ProgressStageKey } from "../../progress/_types";

type ForcedState = "COMPLETED" | "IN_PROGRESS" | null;

interface DocumentCompletionControlProps {
  /** 進捗確認の工程キー(この伝票がどの工程の伝票か) */
  stageKey: ProgressStageKey;
  /** 対象の伝票番号。未指定(新規起票中など)の場合は何も表示しない */
  documentId: string | null | undefined;
}

interface Loaded {
  key: string;
  forced: ForcedState;
  failed: boolean;
}

const OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "自動判定" },
  { value: "COMPLETED", label: "完了にする" },
  { value: "IN_PROGRESS", label: "進行中にする" },
];

// 進捗確認(閲覧専用)に表示される、この伝票の「完了/進行中」を設定する。各伝票の詳細/編集画面に置く。
// 既定は自動判定。分納・複数計上などで自動判定が実態と合わない場合に手動で完了/進行中を指定でき、
// 「自動判定」に戻すと設定は解除される。変更できるのはこの画面の更新権限がある場合のみ
export function DocumentCompletionControl({ stageKey, documentId }: DocumentCompletionControlProps) {
  const { canUpdate } = usePagePermissions();
  const key = documentId ? `${stageKey}:${documentId}` : "";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    apiFetch<{ forcedState: ForcedState }>(`/api/document-completion/${stageKey}/${encodeURIComponent(documentId)}`)
      .then((data) => {
        if (!cancelled) setLoaded({ key, forced: data.forcedState, failed: false });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, forced: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [stageKey, documentId, key]);

  if (!documentId) return null;
  const current = loaded?.key === key ? loaded : null;

  const change = async (value: string) => {
    const forcedState = (value || null) as ForcedState;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await apiFetch(`/api/document-completion/${stageKey}/${encodeURIComponent(documentId)}`, {
        method: "PUT",
        json: { forcedState },
        defaultErrorMessage: "完了状態の更新に失敗しました",
      });
      setLoaded({ key, forced: forcedState, failed: false });
      setMessage("進捗確認の完了状態を更新しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "完了状態の更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border border-slate-200 rounded-lg bg-white px-3 py-2 text-xs text-slate-800">
      <label className="flex items-center gap-2">
        <span className="font-bold text-slate-800">進捗確認での完了状態</span>
        <select
          aria-label="進捗確認での完了状態"
          value={current?.forced ?? ""}
          disabled={!current || current.failed || !canUpdate || saving}
          onChange={(e) => void change(e.target.value)}
          className="border border-slate-400 rounded px-2 py-1 bg-white text-slate-900 disabled:opacity-50 disabled:text-slate-500"
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <span className="text-slate-700">
        分納などで自動判定が実態と合わない場合に設定します(進捗確認画面は表示のみで、ここで変更します)。
        {!canUpdate && " この画面の更新権限がないため変更できません。"}
      </span>
      {current?.failed && <span className="text-red-700 font-semibold">現在の設定を取得できませんでした</span>}
      {message && <span className="text-emerald-800 font-semibold">{message}</span>}
      {error && <span className="text-red-700 font-semibold">{error}</span>}
    </div>
  );
}
