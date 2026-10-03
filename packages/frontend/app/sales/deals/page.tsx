"use client";

import { usePagePermissions } from "../../hooks/use-page-permission";
import { useDeals } from "./_hooks/useDeals";
import { useDealForm } from "./_hooks/useDealForm";
import { DealFormModal } from "./_components/DealFormModal";
import { DealPreview } from "./_components/DealPreview";
import { DEAL_STATUS_LABELS, DealFilters, DealStatus } from "./_types";
import { StatusBadge, StatusTone } from "../../_shared/ui/StatusBadge";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { TableScroll } from "../../_shared/ui/TableScroll";
import { Pagination } from "../../_shared/ui/Pagination";
import { buttonClass } from "../../_shared/ui/Button";
import { downloadDealsImportTemplate } from "./_lib/import-template";
import { useConfirm } from "../../_shared/hooks/use-confirm";

const INPUT_CLASS =
  "border border-slate-400 rounded px-2 py-1.5 bg-white text-slate-900 placeholder-slate-500 text-base sm:text-xs";
const SUB_BUTTON = buttonClass({ variant: "secondary" });
const MAIN_BUTTON = buttonClass({ variant: "primary" });

const STATUS_TONE: Record<DealStatus, StatusTone> = {
  OPEN: "sky",
  WON: "emerald",
  LOST: "red",
};

// 追加要望M-1: 商談管理。見込み客への営業活動(誰と会ったか・メモ・次回までのタスク・添付・見積)を記録する
export default function DealsPage() {
  const confirm = useConfirm();
  const {
    canRead,
    canCreate,
    canUpdate,
    canDelete,
    loading: permsLoading,
  } = usePagePermissions();
  const d = useDeals(canRead);
  const form = useDealForm(d.reload);

  if (permsLoading) return <LoadingGate />;
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  const canEditForm = form.form.id === null ? canCreate : canUpdate;

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="🤝 商談管理"
        description="見込み客(取引先マスタの取引区分「見込み客」)との商談を記録します。1つの見込み客に複数の商談を登録でき、商談ごとに「誰と会ったか(見込客担当者・取引先担当者・自社の同席者・未登録の相手)」「日付・時間・メモ」「次回までのタスク」「添付ファイル」「紐づける見積」を管理できます。見込客の担当者が未登録の場合は、商談の入力中にその場で登録できます。受注が決まったら、取引先マスタで取引区分を「得意先」へ変更してください(商談の履歴はそのまま残ります)。"
      />

      <MessageBanner message={d.message} error={d.error} warning={d.warning} />
      {d.importError && (
        <div
          role="alert"
          className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded border border-red-100 space-y-1"
        >
          <div className="whitespace-pre-line">{d.importError}</div>
          <button
            type="button"
            onClick={d.clearImportError}
            className="underline text-red-800 font-semibold"
          >
            閉じる
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 text-xs">
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">取引先</span>
          <select
            value={d.draft.partnerId}
            onChange={(e) => d.changeDraft("partnerId", e.target.value)}
            className={`${INPUT_CLASS} w-full sm:w-56`}
          >
            <option value="">すべて</option>
            {d.partners.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.id}] {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">状態</span>
          <select
            value={d.draft.status}
            onChange={(e) =>
              d.changeDraft("status", e.target.value as DealFilters["status"])
            }
            className={INPUT_CLASS}
          >
            <option value="all">すべて</option>
            {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            キーワード(商談名・メモ・商談番号)
          </span>
          <input
            type="text"
            value={d.draft.keyword}
            onChange={(e) => d.changeDraft("keyword", e.target.value)}
            className={`${INPUT_CLASS} w-full sm:w-56`}
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            商談日(開始)
          </span>
          <input
            type="date"
            value={d.draft.startDate}
            onChange={(e) => d.changeDraft("startDate", e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            商談日(終了)
          </span>
          <input
            type="date"
            value={d.draft.endDate}
            onChange={(e) => d.changeDraft("endDate", e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex items-center gap-1 pb-2 font-semibold text-slate-800">
          <input
            type="checkbox"
            checked={d.draft.openTasks}
            onChange={(e) => d.changeDraft("openTasks", e.target.checked)}
          />
          未完了タスクがある商談のみ
        </label>
        {/* BUG-031: 条件は入力するとすぐ反映されるため、「検索」ボタンは置かない */}
        <button onClick={d.handleClear} className={SUB_BUTTON}>
          条件をクリア
        </button>
        <button
          onClick={() => void d.handleDownloadCsv()}
          disabled={d.downloading}
          className={SUB_BUTTON}
        >
          CSVダウンロード
        </button>
        {canCreate && (
          <button onClick={form.openNew} className={MAIN_BUTTON}>
            ➕ 商談を登録
          </button>
        )}
        {/* CSVは新規登録と既存商談の置き換えの両方ができるため、登録・更新の両権限がある場合のみ表示する */}
        {canCreate && canUpdate && (
          <>
            <label
              className={`${SUB_BUTTON} cursor-pointer ${d.importing ? "opacity-50 pointer-events-none" : ""}`}
            >
              {d.importing ? "インポート中..." : "CSVインポート"}
              <input
                type="file"
                accept=".csv"
                className="hidden"
                disabled={d.importing}
                onChange={(e) => void d.handleImportCsv(e)}
              />
            </label>
            <button
              type="button"
              onClick={downloadDealsImportTemplate}
              className={SUB_BUTTON}
            >
              インポート用テンプレート
            </button>
          </>
        )}
      </div>

      {canCreate && canUpdate && (
        <details className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-3">
          <summary className="cursor-pointer font-semibold text-slate-800">
            CSVインポートの書き方(「CSVダウンロード」したファイルをそのまま取り込めます)
          </summary>
          <ul className="list-disc pl-5 mt-2 space-y-1 leading-relaxed">
            <li>
              <b>「CSVダウンロード」で出したファイルは、編集してそのまま取り込めます</b>
              (商談番号が入っているため、同じ商談の更新になります)。
              新しい商談を足すときは、行を追加して<b>dealIdを空欄</b>にします。
            </li>
            <li>
              1つの商談を複数行で書きます。<b>groupKey</b>
              が同じ行が1つの商談です(キーはファイル内で商談を区別するための任意の値。出力では商談番号)。
              取引先・商談名・商談日などの商談本体の項目は先頭行に書き、2行目以降は空欄にします(書く場合は先頭行と同じ値)。メモは複数行でも構いません。
            </li>
            <li>
              各行に、面談者を1件(attendeeKind / attendeeValue /
              attendeeNote)と、次回までのタスクを1件(taskTitle
              など)まで書けます。 attendeeKindは PROSPECT_CONTACT(見込客担当者)/
              PARTNER_CONTACT(取引先担当者)/ EMPLOYEE(自社の同席者)/
              FREE(未登録の相手)。
              attendeeValueは、EMPLOYEEは従業員番号、それ以外は氏名(見込客・取引先担当者は、その取引先に登録済みの氏名と一致させます。
              同姓同名などで氏名で特定できない場合、出力では担当者IDが入ります)。
            </li>
            <li>
              <b>dealId</b>
              が空欄なら新規登録(商談番号は自動採番)。既存の商談番号を書くと、その商談を
              <b>全項目置き換え</b>ます
              (面談者・タスク・見積の紐づけも作り直し。タスクの完了状態はtaskIsDoneの値になります。添付ファイルは変更されません)。
              statusが空欄の場合、新規はOPEN、更新は現状のままです。
            </li>
            <li>
              日付はYYYY-MM-DD、時刻はHH:MM、taskIsDoneは
              1/0(完了/未完了)、見積は quoteIds に空白区切りで指定します。
            </li>
            <li>
              無料プランのD1の制限のため、1回に取り込める量には上限があります(目安:
              30〜40商談。面談者・タスクが多いと少なくなります。500行まで)。
              超える場合や、CSVダウンロードで「一部のみ出力」と表示された場合は、商談日などで分けてください。
              1行でも不正があると、1件も取り込まれません(不正な行は行番号つきで表示されます)。
            </li>
          </ul>
        </details>
      )}

      {d.loading ? (
        <LoadingGate label="読み込み中..." />
      ) : (
        <TableScroll minWidth={1100} className="overflow-y-auto max-h-[60vh]">
          <table className="w-full text-xs text-slate-900">
            <thead className="bg-slate-100 text-slate-900">
              <tr>
                {[
                  "商談番号",
                  "商談日",
                  "時間",
                  "取引先",
                  "商談名",
                  "状態",
                  "面談者",
                  "商談担当",
                  "未完了タスク",
                  "添付",
                  "見積",
                  "操作",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left whitespace-nowrap sticky top-0 bg-slate-100"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="px-3 py-8 text-center text-slate-700"
                  >
                    該当する商談がありません
                  </td>
                </tr>
              )}
              {d.rows.map((r) => (
                // 見積などと同じく、行をクリックすると詳細(編集権限があれば編集)を開く
                <tr
                  key={r.id}
                  onClick={() => {
                    d.closePreview();
                    void form.openEdit(r.id);
                  }}
                  className="align-top hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2 font-mono font-bold whitespace-nowrap">
                    {r.id}
                  </td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {r.dealDate}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.startTime
                      ? `${r.startTime}${r.endTime ? `〜${r.endTime}` : ""}`
                      : ""}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.partnerName ?? r.partnerId}
                  </td>
                  <td className="px-3 py-2 font-semibold">{r.title}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <StatusBadge
                      label={DEAL_STATUS_LABELS[r.status]}
                      tone={STATUS_TONE[r.status]}
                    />
                  </td>
                  <td className="px-3 py-2">{r.attendeeNames.join("、")}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.ownerName ?? ""}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.openTaskCount > 0 ? (
                      <StatusBadge
                        label={`${r.openTaskCount}件`}
                        tone="amber"
                      />
                    ) : r.taskCount > 0 ? (
                      <span>完了</span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.attachmentCount > 0 ? `${r.attachmentCount}件` : ""}
                  </td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    {r.quoteIds.join(" ")}
                  </td>
                  <td
                    className="px-3 py-2 whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => void d.openPreview(r.id)}
                      className="px-2 py-0.5 mr-1 border border-slate-500 text-slate-800 rounded bg-white hover:bg-slate-100 font-semibold"
                    >
                      プレビュー
                    </button>
                    <button
                      onClick={() => {
                        d.closePreview();
                        void form.openEdit(r.id);
                      }}
                      className="px-2 py-0.5 mr-1 border border-indigo-600 text-indigo-800 rounded bg-white hover:bg-indigo-50 font-semibold"
                    >
                      {canUpdate ? "編集" : "詳細"}
                    </button>
                    {canDelete && (
                      <button
                        onClick={async () => {
                          if (
                            (await confirm(
                              `商談[${r.id}]を削除します。面談者・タスク・添付ファイルも削除されます。よろしいですか？`,
                            ))
                          ) {
                            void d.removeDeal(r.id);
                          }
                        }}
                        className="px-2 py-0.5 border border-red-700 text-red-800 rounded bg-white hover:bg-red-50 font-semibold"
                      >
                        削除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {/* BUG-032: 会社設定の「一覧のページ分割」に従う */}
      <Pagination
        paginationEnabled={d.paginationEnabled}
        page={d.page}
        totalPages={d.totalPages}
        total={d.total}
        limit={d.limit}
        onPageChange={d.setPage}
        onLimitChange={d.setLimit}
      />

      <div className="space-y-2">
        <h2 className="text-sm font-bold text-slate-900">
          ✅ 次回までのタスク(未完了・期限の早い順)
        </h2>
        {d.openTasks.length === 0 ? (
          <p className="text-xs text-slate-700">
            {d.isPartnerFiltered
              ? "検索した取引先の未完了のタスクはありません"
              : "未完了のタスクはありません"}
          </p>
        ) : (
          <TableScroll minWidth={700} className="overflow-y-auto max-h-64">
            <table className="w-full text-xs text-slate-900">
              <thead className="bg-slate-100">
                <tr>
                  {["期限", "タスク", "担当", "商談", "取引先", ""].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left whitespace-nowrap sticky top-0 bg-slate-100"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.openTasks.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                      {t.dueDate ?? "期限なし"}
                    </td>
                    <td className="px-3 py-1.5 font-semibold">{t.title}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {t.assigneeName ?? "未設定"}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="font-mono">{t.dealId}</span>{" "}
                      {t.dealTitle}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {t.partnerName ?? ""}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {canUpdate && (
                        <button
                          onClick={() =>
                            void d.setTaskDone(t.dealId, t.id, true)
                          }
                          className="px-2 py-0.5 border border-emerald-700 text-emerald-800 rounded bg-white hover:bg-emerald-50 font-semibold"
                        >
                          完了にする
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>

      <DealFormModal
        f={form}
        partners={d.partners}
        employees={d.employees}
        canEdit={canEditForm}
      />
      <DealPreview previewDeal={d.previewDeal} onClose={d.closePreview} />
    </div>
  );
}
