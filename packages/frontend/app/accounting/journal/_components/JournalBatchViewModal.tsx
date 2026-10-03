"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { Modal } from "../../../_shared/ui/Modal";
import { JournalPairTable, type AccountNames } from "../../_components/JournalPairTable";
import type { JournalBatchDetail } from "../../journal-edit/_types";

const TYPE_LABEL: Record<string, string> = {
  ORIGINAL: "元の仕訳",
  REVERSAL: "反対仕訳",
  CORRECTION: "訂正仕訳",
};

interface JournalBatchViewModalProps {
  batchId: string;
  onClose: () => void;
}

/** 転記済みの仕訳を、借方・貸方に分けて表示する(閲覧のみ。訂正は仕訳編集画面で行う) */
export function JournalBatchViewModal({
  batchId,
  onClose,
}: JournalBatchViewModalProps) {
  const [detail, setDetail] = useState<JournalBatchDetail | null>(null);
  const [error, setError] = useState("");
  // 科目名が保存されていない古い仕訳の表示用(勘定科目コード→科目名)
  const [accountNames, setAccountNames] = useState<AccountNames>({});

  useEffect(() => {
    void (async () => {
      try {
        const accounts = await apiFetch<{ code: string; name: string }[]>("/api/accounts?status=active");
        setAccountNames(Object.fromEntries(accounts.map((a) => [a.code, a.name])));
      } catch {
        setAccountNames({});
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setDetail(
          await apiFetch<JournalBatchDetail>(
            `/api/journal-batches/${batchId}`,
            { defaultErrorMessage: "仕訳の取得に失敗しました" },
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "仕訳の取得に失敗しました");
      }
    })();
  }, [batchId]);

  return (
    <Modal title="📒 仕訳の内容" size="3xl" onClose={onClose}>
      {error ? (
        <p className="text-xs text-red-700 font-bold py-6 text-center">{error}</p>
      ) : !detail ? (
        <p className="text-xs text-slate-600 py-6 text-center">読み込み中...</p>
      ) : (
        <div className="space-y-3">
          {detail.chain.length > 1 && (
            <p className="text-xs text-slate-700">
              この仕訳は訂正されています。元の仕訳・反対仕訳・訂正仕訳の順に表示します。
            </p>
          )}
          {detail.chain.map((b) => (
            <div
              key={b.id}
              className="border border-slate-200 rounded-lg overflow-hidden"
            >
              <div className="bg-slate-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex flex-wrap items-center gap-2">
                  {detail.chain.length > 1 && (
                    <span className="font-bold text-slate-800">
                      {TYPE_LABEL[b.type] ?? b.type}
                    </span>
                  )}
                  <span className="text-slate-800">
                    計上日 {new Date(b.entryDate).toISOString().split("T")[0]}
                  </span>
                  <span className="text-slate-700">{b.description}</span>
                </span>
                <span className="font-mono text-slate-600">{b.id}</span>
              </div>
              <JournalPairTable pairs={b.pairs ?? []} accountNames={accountNames} />
              {b.memo && (
                <div className="px-3 py-1.5 text-[11px] text-slate-700 border-t border-slate-100">
                  メモ: {b.memo}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
