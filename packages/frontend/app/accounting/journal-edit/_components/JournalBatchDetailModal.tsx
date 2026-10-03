import React from "react";
import { Button } from "../../../_shared/ui/Button";
import { Modal } from "../../../_shared/ui/Modal";
import { AccountLabel, accountDisplayName, JournalPairTable } from "../../_components/JournalPairTable";
import {
  JournalBatchDetail,
  AccountLookup,
  CorrectLineForm,
  JournalBatchType,
} from "../_types";

interface JournalBatchDetailModalProps {
  detail: JournalBatchDetail | null;
  loading: boolean;
  canUpdate: boolean;
  accounts: AccountLookup[];
  isCorrecting: boolean;
  correctDescription: string;
  setCorrectDescription: (value: string) => void;
  correctMemo: string;
  setCorrectMemo: (value: string) => void;
  correctLines: CorrectLineForm[];
  onStartCorrecting: () => void;
  onCancelCorrecting: () => void;
  onCorrectLineAccountChange: (lineId: string, accountCode: string) => void;
  isSubmittingCorrection: boolean;
  onSubmitCorrection: () => void;
  onClose: () => void;
}

const TYPE_LABEL: Record<JournalBatchType, string> = {
  ORIGINAL: "元バッチ",
  REVERSAL: "反対仕訳",
  CORRECTION: "訂正仕訳",
};

const TYPE_CLASS: Record<JournalBatchType, string> = {
  ORIGINAL: "text-slate-700 bg-slate-100",
  REVERSAL: "text-red-700 bg-red-50",
  CORRECTION: "text-emerald-700 bg-emerald-50",
};

function TypeBadge({ type }: { type: JournalBatchType }) {
  return (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TYPE_CLASS[type]}`}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}

export function JournalBatchDetailModal({
  detail,
  loading,
  canUpdate,
  accounts,
  isCorrecting,
  correctDescription,
  setCorrectDescription,
  correctMemo,
  setCorrectMemo,
  correctLines,
  onStartCorrecting,
  onCancelCorrecting,
  onCorrectLineAccountChange,
  isSubmittingCorrection,
  onSubmitCorrection,
  onClose,
}: JournalBatchDetailModalProps) {
  if (!detail && !loading) return null;
  // 科目名が保存されていない古い仕訳の表示用(勘定科目コード→科目名)
  const accountNames = Object.fromEntries(accounts.map((a) => [a.code, a.name]));

  return (
    <Modal title="📝 仕訳バッチ詳細" size="3xl" onClose={onClose}>
      {loading || !detail ? (
        <p className="text-xs text-slate-600 py-6 text-center">読み込み中...</p>
      ) : (
        <>
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-700">
              連鎖(元バッチ→反対仕訳→訂正仕訳)
            </h4>
            {detail.chain.map((b) => (
              <div
                key={b.id}
                className="border border-slate-200 rounded-lg overflow-hidden"
              >
                <div className="bg-slate-50 px-3 py-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs">
                    <TypeBadge type={b.type} />
                    <span className="font-mono text-slate-600">{b.id}</span>
                    <span className="text-slate-700">{b.description}</span>
                  </span>
                  <span className="text-[11px] text-slate-600">
                    {new Date(b.postedAt).toLocaleString("ja-JP")}
                  </span>
                </div>
                <JournalPairTable pairs={b.pairs ?? []} accountNames={accountNames} />
                {b.memo && (
                  <div className="px-3 py-1.5 text-[11px] text-slate-600 border-t border-slate-100">
                    メモ: {b.memo}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!isCorrecting ? (
            canUpdate && (
              <div className="flex justify-end pt-2 border-t border-slate-100">
                <Button onClick={onStartCorrecting}>
                  ✏️ この内容を訂正する
                </Button>
              </div>
            )
          ) : (
            <div className="border border-indigo-200 rounded-lg p-4 space-y-3 bg-indigo-50/30">
              <h4 className="text-xs font-bold text-slate-700">
                訂正内容の入力(反対仕訳+訂正仕訳をセットで起票します)
              </h4>
              <p className="text-[11px] text-slate-600">
                金額・消費税区分・税率は変更できません(元伝票との整合性のため)。勘定科目・摘要・メモのみ編集可能です。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col space-y-1">
                  <label className="text-[10px] font-bold text-slate-800">
                    摘要
                  </label>
                  <input
                    type="text"
                    className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900"
                    value={correctDescription}
                    onChange={(e) => setCorrectDescription(e.target.value)}
                  />
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="text-[10px] font-bold text-slate-800">
                    メモ
                  </label>
                  <input
                    type="text"
                    className="w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900"
                    value={correctMemo}
                    onChange={(e) => setCorrectMemo(e.target.value)}
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-700">
                借方・貸方それぞれの勘定科目を選び直してください(同じ明細が複数の組に出る場合は、どちらで変えても同じ明細が変わります)。
              </p>
              <JournalPairTable
                pairs={detail.chain[detail.chain.length - 1].pairs ?? []}
                accountNames={accountNames}
                renderAccount={(line, side) => (
                  <div className="space-y-1">
                    <span className="block text-[10px] text-slate-700">
                      訂正前: <AccountLabel line={line} names={accountNames} className="text-slate-800" />
                    </span>
                    <select
                      aria-label={`${side === "DEBIT" ? "借方" : "貸方"}の勘定科目(${accountDisplayName(line, accountNames)})`}
                      className="w-full border border-slate-300 p-1.5 text-base sm:text-xs rounded bg-white text-slate-900"
                      value={
                        correctLines.find((c) => c.lineId === line.id)
                          ?.accountCode ?? line.accountCode
                      }
                      onChange={(e) =>
                        onCorrectLineAccountChange(line.id, e.target.value)
                      }
                    >
                      {accounts.map((a) => (
                        <option key={a.code} value={a.code}>
                          [{a.code}] {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              />

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onCancelCorrecting}
                  className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-bold rounded-lg transition-colors"
                >
                  キャンセル
                </button>
                <Button
                  onClick={onSubmitCorrection}
                  disabled={isSubmittingCorrection}
                >
                  {isSubmittingCorrection
                    ? "起票中..."
                    : "反対仕訳・訂正仕訳を起票する"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
