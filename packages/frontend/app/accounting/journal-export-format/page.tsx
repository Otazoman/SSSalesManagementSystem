"use client";

import Link from "next/link";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { useJournalExportFormat } from "./_hooks/useJournalExportFormat";
import { ColumnFormatTable } from "./_components/ColumnFormatTable";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import type { JournalExportLayout } from "./_types";

const DELIMITER_OPTIONS: { value: "," | "\t" | ";"; label: string }[] = [
  { value: ",", label: "カンマ(,)" },
  { value: "\t", label: "タブ" },
  { value: ";", label: "セミコロン(;)" },
];

const DATE_FORMAT_OPTIONS: {
  value: "YYYY-MM-DD" | "YYYY/MM/DD" | "MM/DD/YYYY";
  label: string;
}[] = [
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
  { value: "YYYY/MM/DD", label: "YYYY/MM/DD" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
];

const LAYOUT_OPTIONS: { value: JournalExportLayout; label: string; description: string }[] = [
  {
    value: "PAIR",
    label: "1行 = 借方と貸方の組",
    description: "「借方科目・借方金額・貸方科目・貸方金額」を1行に並べます(借方・貸方の列を使います)。",
  },
  {
    value: "LINE",
    label: "1行 = 借方か貸方の片側(従来の形)",
    description: "借方の行と貸方の行を別々に出し、「貸借区分」の列で区別します。",
  },
];

export default function JournalExportFormatPage() {
  const { canRead, canUpdate, loading: permsLoading } = usePagePermissions();
  const {
    format,
    loading,
    saving,
    message,
    error,
    moveColumn,
    toggleColumn,
    relabelColumn,
    setDelimiter,
    setDateFormat,
    setIncludeHeaderRow,
    setLayout,
    save,
  } = useJournalExportFormat(!permsLoading && canRead);

  if (permsLoading) return <LoadingGate />;
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="🧾 仕訳CSV出力フォーマット設定"
        description={
          <>
            <Link
              href="/accounting/journal"
              className="text-indigo-600 hover:underline"
            >
              仕訳データ出力
            </Link>
            画面でダウンロードするCSVの列構成・見出し名・区切り文字・日付形式をカスタマイズします。
            出力できるデータの種類自体は固定です(列の追加・削除はできません)。
          </>
        }
      />

      <MessageBanner message={message} error={error} />

      {loading || !format ? (
        <p className="text-xs text-slate-600">読み込み中...</p>
      ) : (
        <div className="space-y-4">
          <fieldset className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
            <legend className="px-1 text-xs font-bold text-slate-800">1行の単位</legend>
            {LAYOUT_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-start gap-2 text-xs text-slate-800 cursor-pointer">
                <input
                  type="radio"
                  name="journal-export-layout"
                  className="mt-0.5"
                  checked={(format.layout ?? "LINE") === o.value}
                  onChange={() => setLayout(o.value)}
                />
                <span>
                  <span className="font-bold">{o.label}</span>
                  <span className="block text-slate-700">{o.description}</span>
                </span>
              </label>
            ))}
            <p className="text-[11px] text-slate-700">
              切り替えると、その形式で使う列を出力し、使わない列を出力しない設定にまとめて変更します(下の表で列ごとに変更できます)。
            </p>
          </fieldset>

          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap gap-6">
            <label className="text-xs text-slate-800 flex items-center gap-2">
              区切り文字
              <select
                className="border border-slate-300 p-1.5 rounded text-base sm:text-xs bg-white text-slate-900"
                value={format.delimiter}
                onChange={(e) =>
                  setDelimiter(e.target.value as typeof format.delimiter)
                }
              >
                {DELIMITER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-800 flex items-center gap-2">
              日付形式
              <select
                className="border border-slate-300 p-1.5 rounded text-base sm:text-xs bg-white text-slate-900"
                value={format.dateFormat}
                onChange={(e) =>
                  setDateFormat(e.target.value as typeof format.dateFormat)
                }
              >
                {DATE_FORMAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-800 flex items-center gap-2">
              <input
                type="checkbox"
                checked={format.includeHeaderRow}
                onChange={(e) => setIncludeHeaderRow(e.target.checked)}
              />
              見出し行を出力する
            </label>
          </div>

          <ColumnFormatTable
            columns={format.columns}
            onMove={moveColumn}
            onToggle={toggleColumn}
            onRelabel={relabelColumn}
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canUpdate || saving}
              className={`text-xs px-4 py-2 rounded font-bold text-white shadow-sm transition-colors ${
                canUpdate && !saving
                  ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
                  : "bg-slate-300 text-slate-500 cursor-not-allowed"
              }`}
            >
              {saving ? "保存中..." : "💾 保存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
