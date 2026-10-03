"use client";

import { Fragment, useState } from "react";
import { Button } from "../../../_shared/ui/Button";
import { DataTable } from "../../../_shared/ui/DataTable";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { JournalPairTable } from "../../_components/JournalPairTable";
import {
  JOURNAL_SOURCE_KIND_OPTIONS,
  useJournalSources,
} from "../_hooks/useJournalSources";

// 売上・仕入の区分の表示名(仕訳の摘要と同じ)
const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  SALE: "売上",
  PURCHASE: "仕入",
  RETURN: "返品",
  DISCOUNT: "値引",
  CORRECTION: "赤伝(訂正)",
};

const yen = (amount: number) => `¥${amount.toLocaleString("ja-JP")}`;
const formatDate = (iso: string) => iso.slice(0, 10);

interface JournalSourceSectionProps {
  enabled: boolean;
  // 更新権限が無い場合、仕訳の作成ボタンを操作不能にする
  canUpdate: boolean;
  // 仕訳を作成した後に、転記状況の一覧を読み直す
  onPosted: () => void;
}

/**
 * 伝票を選んで仕訳を作る(V-4)。種別を選び、まだ仕訳にしていない伝票を複数選んで作成する。
 * 売上は、前受金として仕訳済みの単体入金を充当できる(売掛金で計上し、充当分を 前受金/売掛金 で振り替える)。
 */
export function JournalSourceSection({
  enabled,
  canUpdate,
  onPosted,
}: JournalSourceSectionProps) {
  const s = useJournalSources(enabled, onPosted);
  // 前受金の充当を編集中の売上
  const [advanceOpenId, setAdvanceOpenId] = useState<string | null>(null);

  const allSelected = s.rows.length > 0 && s.selected.size === s.rows.length;
  // 展開行(前受金の充当・仕訳の確認)で表の全列にまたがるための列数
  const columnCount = s.kind === "sales_invoice" ? 7 : 6;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-black text-slate-800">
          📝 伝票を選んで仕訳を作成
        </h2>
        <p className="text-xs text-slate-600 mt-1">
          種別を選び、まだ仕訳にしていない伝票を選んで作成します。「仕訳を確認」で、作成される仕訳を「借方〇〇/貸方〇〇」の組で事前に確認できます。作成した仕訳は、下のCSV出力・転記状況に反映されます。
          仕訳ルールマスタで、その種別のルールを有効にしておく必要があります。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {JOURNAL_SOURCE_KIND_OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={s.kind === option.value ? "primary" : "secondary"}
            onClick={() => s.changeKind(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end bg-slate-50 p-3 rounded-lg border border-slate-200">
        <FormField label="日付(から)">
          <input
            type="date"
            aria-label="日付(から)"
            className={formFieldInputClass}
            value={s.filters.from}
            onChange={(e) =>
              s.setFilters({ ...s.filters, from: e.target.value })
            }
          />
        </FormField>
        <FormField label="日付(まで)">
          <input
            type="date"
            aria-label="日付(まで)"
            className={formFieldInputClass}
            value={s.filters.to}
            onChange={(e) => s.setFilters({ ...s.filters, to: e.target.value })}
          />
        </FormField>
        <FormField label="取引先">
          <select
            aria-label="取引先"
            className={`${formFieldInputClass} cursor-pointer`}
            value={s.filters.partnerId}
            onChange={(e) =>
              s.setFilters({ ...s.filters, partnerId: e.target.value })
            }
          >
            <option value="">すべて</option>
            {s.partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FormField>
        {/* BUG-031: 条件は入力するとすぐ反映されるため、「検索」ボタンは置かない */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => s.clearFilters()}
          >
            条件をクリア
          </Button>
        </div>
      </div>

      <MessageBanner error={s.error} />

      {s.loading ? (
        <p className="text-xs text-slate-600">読み込み中...</p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={s.rows.length === 0 || s.posting}
                onChange={(e) => s.toggleAll(e.target.checked)}
                className="w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
              />
              すべて選択({s.rows.length}件)
            </label>
            <p className="text-xs text-slate-700 font-bold">
              選択中: {s.selected.size}件 / 合計 {yen(s.selectedTotal)}
            </p>
          </div>

          <DataTable
            columns={[
              { key: "select", label: "選択" },
              { key: "date", label: "計上日" },
              { key: "partner", label: "取引先" },
              { key: "doc", label: "伝票" },
              { key: "amount", label: "金額", align: "right" },
              ...(s.kind === "sales_invoice"
                ? [{ key: "advance", label: "前受金の充当" }]
                : []),
              { key: "preview", label: "借方・貸方", align: "center" },
            ]}
            data={s.rows}
            emptyMessage="仕訳にしていない伝票はありません。"
            renderRow={(r) => {
              const draft = s.advanceDrafts[r.sourceRefId] ?? {};
              const draftTotal = Object.values(draft).reduce(
                (sum, a) => sum + a,
                0,
              );
              const canApply =
                s.kind === "sales_invoice" &&
                r.documentType === "SALE" &&
                !!r.partnerId;
              const candidates = r.partnerId
                ? s.advanceCandidates[r.partnerId]
                : undefined;
              return (
                <Fragment key={r.sourceRefId}>
                  <tr className="hover:bg-slate-50 text-xs text-slate-800">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label={`${r.sourceRefId}を選択`}
                        checked={s.selected.has(r.sourceRefId)}
                        disabled={s.posting}
                        onChange={() => s.toggle(r.sourceRefId)}
                        className="w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {formatDate(r.date)}
                    </td>
                    <td className="px-4 py-2">{r.partnerName ?? "-"}</td>
                    <td className="px-4 py-2">
                      <span className="font-mono">{r.sourceRefId}</span>
                      {r.documentType &&
                        r.documentType !== "SALE" &&
                        r.documentType !== "PURCHASE" && (
                          <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800">
                            {DOCUMENT_TYPE_LABEL[r.documentType] ??
                              r.documentType}
                          </span>
                        )}
                    </td>
                    <td className="px-4 py-2 text-right font-bold whitespace-nowrap">
                      {yen(r.amount)}
                    </td>
                    {s.kind === "sales_invoice" && (
                      <td className="px-4 py-2 whitespace-nowrap">
                        {canApply ? (
                          <button
                            type="button"
                            disabled={s.posting}
                            onClick={() => {
                              if (advanceOpenId === r.sourceRefId) {
                                setAdvanceOpenId(null);
                              } else {
                                setAdvanceOpenId(r.sourceRefId);
                                void s.loadAdvanceCandidates(r.partnerId!);
                              }
                            }}
                            className="text-xs font-bold text-indigo-700 hover:underline cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {draftTotal > 0
                              ? `充当 ${yen(draftTotal)}`
                              : "充当する"}
                          </button>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2 text-center whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void s.togglePreview(r.sourceRefId)}
                      >
                        {s.previews[r.sourceRefId] ? "閉じる" : "仕訳を確認"}
                      </Button>
                    </td>
                  </tr>
                  {s.previews[r.sourceRefId] && (
                    <tr className="bg-slate-50">
                      <td colSpan={columnCount} className="px-4 py-3">
                        {s.previews[r.sourceRefId].loading ? (
                          <p className="text-xs text-slate-700">仕訳の内容を確認しています...</p>
                        ) : s.previews[r.sourceRefId].error ? (
                          <p className="text-xs font-bold text-red-700">
                            ⚠️ {s.previews[r.sourceRefId].error}
                          </p>
                        ) : (
                          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                            <p className="px-3 py-1.5 text-xs font-bold text-slate-800 border-b border-slate-200">
                              作成される仕訳({r.description})
                            </p>
                            <JournalPairTable pairs={s.previews[r.sourceRefId].pairs ?? []} />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  {advanceOpenId === r.sourceRefId && (
                    <tr className="bg-slate-50">
                      <td colSpan={columnCount} className="px-4 py-3 space-y-2">
                        <p className="text-xs font-bold text-slate-800">
                          前受金として仕訳済みの単体入金から、この売上へ充当する金額を入力します
                          (売上は売掛金で計上し、充当分を「借方 前受金/貸方 売掛金」で振り替えます)
                        </p>
                        {!candidates ? (
                          <p className="text-xs text-slate-600">
                            読み込み中...
                          </p>
                        ) : candidates.length === 0 ? (
                          <p className="text-xs text-slate-700">
                            充当できる単体入金がありません。先に「前受(単体入金)」を仕訳にしてください。
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {candidates.map((c) => (
                              <div
                                key={c.cashReceiptId}
                                className="flex flex-wrap items-center gap-3 text-xs text-slate-800"
                              >
                                <span className="font-mono">
                                  {c.cashReceiptId}
                                </span>
                                <span>{formatDate(c.receiptDate)}</span>
                                <span>未充当残 {yen(c.remainingAmount)}</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={c.remainingAmount}
                                  aria-label={`${c.cashReceiptId}の充当額`}
                                  className="w-32 text-right border border-slate-300 rounded px-2 py-1 bg-white text-slate-900 font-bold"
                                  value={draft[c.cashReceiptId] ?? ""}
                                  placeholder="0"
                                  onChange={(e) =>
                                    s.setAdvanceAmount(
                                      r.sourceRefId,
                                      c.cashReceiptId,
                                      Number(e.target.value) || 0,
                                    )
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            }}
          />
        </>
      )}

      <div className="flex items-center justify-end gap-3">
        {s.posting && (
          <p className="text-xs text-slate-800 font-bold">
            作成中... {s.progress.done} / {s.progress.total}件
          </p>
        )}
        <Button
          onClick={() => void s.createSelected()}
          disabled={!canUpdate || s.posting || s.selected.size === 0}
        >
          {s.posting
            ? "作成中..."
            : `📝 選択した伝票の仕訳を作成(${s.selected.size}件)`}
        </Button>
      </div>

      {s.results.length > 0 && (
        <div
          className="bg-white border border-slate-200 rounded-lg p-3 space-y-1"
          aria-label="仕訳の作成結果"
        >
          <p className="text-xs font-black text-slate-800">
            作成結果: 成功 {s.results.filter((r) => r.ok).length}件 / 失敗{" "}
            {s.results.filter((r) => !r.ok).length}件
          </p>
          <ul className="text-xs space-y-0.5">
            {s.results.map((r) => (
              <li
                key={r.sourceRefId}
                className={r.ok ? "text-emerald-800" : "text-red-700 font-bold"}
              >
                {r.ok ? "✅" : "⚠️"}{" "}
                <span className="font-mono">{r.sourceRefId}</span>: {r.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
