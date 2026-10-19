"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { apiFetch } from "../hooks/use-api-fetch";
import { ApiListResponse } from "../api/response-types";
import { useDebouncedValue } from "../hooks/use-debounced-value";

interface CopySourceSummary {
  id: string;
  title?: string | null;
  totalAmount: number;
}

interface DocumentCopyPickerModalProps {
  /** モーダルのタイトル(例: 「📋 過去の受注から作成」) */
  title: string;
  /** 一覧取得APIのパス(例: "/api/sales-orders")。発注の再発注と同じく承認済みのみを対象にする */
  listPath: string;
  /** 伝票の呼び名(例: 「受注」)。空のときの文言に使う */
  documentLabel: string;
  onClose: () => void;
  /** 選んだ伝票のID。複写の処理(取得・引き継がない項目の除外)は一覧の「複写」と同じハンドラに任せる */
  onSelect: (id: string) => void;
}

// 新規要望(2026-10-19): 見積・受注のヘッダーから過去の伝票を選んで複写する1ステップのモーダル。
// 伝票を選ぶと丸ごとコピーする(明細の選択はしない)。この時点ではDBに書き込まない
export function DocumentCopyPickerModal({
  title,
  listPath,
  documentLabel,
  onClose,
  onSelect,
}: DocumentCopyPickerModalProps) {
  const [records, setRecords] = useState<CopySourceSummary[]>([]);
  const [search, setSearch] = useState("");
  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedSearch = useDebouncedValue(search);
  // 読み込み済みの検索語。今の検索語と違う間は読み込み中とみなす(effect内で同期的にsetStateしないため)
  const [loadedSearch, setLoadedSearch] = useState<string | null>(null);
  const loading = loadedSearch !== debouncedSearch;

  useEffect(() => {
    let cancelled = false;
    apiFetch<CopySourceSummary[] | ApiListResponse<CopySourceSummary>>(
      `${listPath}?status=APPROVED${debouncedSearch ? `&title=${encodeURIComponent(debouncedSearch)}` : ""}`,
    )
      .then((data) => {
        if (cancelled) return;
        setRecords(Array.isArray(data) ? data : data.data);
      })
      .catch((err) => {
        console.error(`${documentLabel}一覧の取得に失敗しました`, err);
        if (!cancelled) setRecords([]);
      })
      .finally(() => {
        if (!cancelled) setLoadedSearch(debouncedSearch);
      });
    return () => {
      cancelled = true;
    };
  }, [listPath, documentLabel, debouncedSearch]);

  return (
    <Modal title={title} size="2xl" onClose={onClose}>
      <div className="flex-1 overflow-y-auto space-y-3">
        <p className="text-[11px] text-slate-700">
          選んだ{documentLabel}の内容を丸ごとコピーして、新規作成のフォームを開きます。まだ保存はされません。内容を確認・調整してから保存してください。
        </p>
        <input
          type="text"
          placeholder="件名で絞り込み検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900 placeholder-slate-500 focus:border-indigo-600 focus:outline-none"
        />
        {loading ? (
          <p className="text-xs text-slate-700 text-center py-6">
            読み込み中...
          </p>
        ) : records.length === 0 ? (
          <p className="text-xs text-slate-700 text-center py-6">
            承認済みの{documentLabel}が見つかりません。
          </p>
        ) : (
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
            {records.map((record) => (
              <button
                type="button"
                key={record.id}
                onClick={() => {
                  onSelect(record.id);
                  onClose();
                }}
                className="w-full text-left px-3 py-2.5 bg-white hover:bg-indigo-50/50 transition-colors flex justify-between items-center text-xs"
              >
                <div>
                  <span className="font-mono font-bold text-indigo-600">
                    {record.id}
                  </span>
                  <span className="ml-2 font-semibold text-slate-700">
                    {record.title || "(件名なし)"}
                  </span>
                </div>
                <span className="font-mono font-bold text-slate-900">
                  ¥{Number(record.totalAmount || 0).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
