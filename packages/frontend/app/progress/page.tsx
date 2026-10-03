"use client";

import { usePagePermissions } from "../hooks/use-page-permission";
import { PageHeader } from "../_shared/ui/PageHeader";
import { Button } from "../_shared/ui/Button";
import { useProgress } from "./_hooks/useProgress";
import { ProgressTable } from "./_components/ProgressTable";
import { ProgressRootKind, ROOT_KIND_LABELS } from "./_types";
import { Pagination } from "../_shared/ui/Pagination";
import { LoadingGate } from "../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../_shared/ui/MessageBanner";

const ROOT_KIND_OPTIONS = Object.entries(ROOT_KIND_LABELS) as [
  ProgressRootKind,
  string,
][];

const INPUT_CLASS =
  "border border-slate-400 rounded px-2 py-1.5 bg-white text-slate-900 placeholder-slate-500";
const SUB_BUTTON_CLASS =
  "px-4 py-1.5 border border-slate-400 rounded bg-white text-slate-800 hover:bg-slate-100";

export default function ProgressPage() {
  const { canRead, canUpdate, loading: permsLoading } = usePagePermissions();
  const {
    rows,
    total,
    totalPages,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    showCompleted,
    changeShowCompleted,
    exportCsv,
    csvDownloading,
    error,
    page,
    setPage,
    limit,
    changeLimit,
    draft,
    partners,
    employees,
    assign,
    changeDraft,
    handleSearch,
    handleClear,
    reload,
  } = useProgress(canRead, { withLookups: true });

  if (permsLoading) return <LoadingGate />;
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  const onEnter = (e: React.KeyboardEvent) =>
    e.key === "Enter" && handleSearch();

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="🧭 進捗確認(見積〜支払)"
        description={
          <>
            見積→受注→購買申請→発注→入荷→入庫→仕入→出荷→出庫→売上→請求→支払を、案件ごとに一気通貫で確認できます。
            受注を軸に、受注明細に紐づく購買申請以降も同じ行に表示します(承認機能が有効な伝票は承認ステップの進み具合も表示)。
            伝票番号をクリックすると、その伝票の元の画面を別ウィンドウで開きます。
            各工程には「完了/進行中」のバッジを表示します(見積=受注化済、受注・発注=追加注残なし、売上=請求済、出荷指示・入荷指示=実績反映済、入庫・出庫=承認済み、購買申請=発注化済、仕入=支払済、請求・支払=消込完了)。
            分納などで自動判定が実態と合わない場合の「完了/進行中」の手動設定は、この画面ではなく各伝票の画面(詳細/編集)で行います(手動設定された工程には「手動」と表示します)。この画面での完了/進行中の変更はできません。
            既定は進行中の案件のみを表示します(完了した案件も見る場合は「完了した案件も表示」)。
            検索は「件名」「取引先」「プロジェクト」「伝票番号(案件内のどの伝票でも)」などをすべて満たす案件(AND)を探し、「キーワード」は件名・取引先名・プロジェクト名・伝票番号のどれかに一致する案件を探します。
            検索条件の担当者・取引先・日付は、案件の起点となる伝票(見積/受注/購買申請/発注)に対して適用されます。
            各案件の「次: 〇〇 / 担当:
            △△」は、最後に伝票がある工程の次の工程とその担当です(担当は「担当設定」での個別割当が、工程ごとの既定担当より優先されます。更新権限のある方は各案件で個別に割当できます)。
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            キーワード(件名・取引先・プロジェクト・伝票番号)
          </span>
          <input
            type="text"
            value={draft.q}
            onChange={(e) => changeDraft("q", e.target.value)}
            onKeyDown={onEnter}
            className={`${INPUT_CLASS} w-64`}
            placeholder="案件をまとめて検索"
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">件名</span>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => changeDraft("title", e.target.value)}
            onKeyDown={onEnter}
            className={`${INPUT_CLASS} w-44`}
            placeholder="部分一致"
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            プロジェクト名
          </span>
          <input
            type="text"
            value={draft.projectName}
            onChange={(e) => changeDraft("projectName", e.target.value)}
            onKeyDown={onEnter}
            className={`${INPUT_CLASS} w-44`}
            placeholder="部分一致"
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            伝票番号(案件内のどの伝票でも)
          </span>
          <input
            type="text"
            value={draft.docNumber}
            onChange={(e) => changeDraft("docNumber", e.target.value)}
            onKeyDown={onEnter}
            className={`${INPUT_CLASS} w-48`}
            placeholder="見積〜支払の伝票番号"
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            起点伝票番号
          </span>
          <input
            type="text"
            value={draft.keyword}
            onChange={(e) => changeDraft("keyword", e.target.value)}
            onKeyDown={onEnter}
            className={`${INPUT_CLASS} w-44`}
            placeholder="部分一致"
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">起点種別</span>
          <select
            value={draft.rootKind}
            onChange={(e) =>
              changeDraft("rootKind", e.target.value as ProgressRootKind | "")
            }
            className={INPUT_CLASS}
          >
            <option value="">すべて</option>
            {ROOT_KIND_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            取引先(入力で絞り込み・選択)
          </span>
          <input
            type="text"
            list="progress-partner-options"
            value={draft.partnerName}
            onChange={(e) => changeDraft("partnerName", e.target.value)}
            onKeyDown={onEnter}
            className={`${INPUT_CLASS} w-56`}
            placeholder="取引先名を入力または選択"
          />
          <datalist id="progress-partner-options">
            {partners.map((p) => (
              <option key={p.id} value={p.name}>
                [{p.id}] {p.name}
              </option>
            ))}
          </datalist>
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            担当者(ユーザーマスタから選択)
          </span>
          <select
            value={draft.personEmployeeNumber}
            onChange={(e) =>
              changeDraft("personEmployeeNumber", e.target.value)
            }
            className={`${INPUT_CLASS} w-56`}
          >
            <option value="">指定なし</option>
            {employees.map((emp) => (
              <option key={emp.employeeNumber} value={emp.employeeNumber}>
                {emp.name}({emp.employeeNumber})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            起点日(開始)
          </span>
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => changeDraft("startDate", e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            起点日(終了)
          </span>
          <input
            type="date"
            value={draft.endDate}
            onChange={(e) => changeDraft("endDate", e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex items-center gap-1 pb-2 font-semibold text-slate-800">
          <input
            type="checkbox"
            checked={draft.fromQuote === "true"}
            onChange={(e) =>
              changeDraft("fromQuote", e.target.checked ? "true" : "")
            }
          />
          見積起点の案件のみ
        </label>
        <label className="flex items-center gap-1 pb-2 font-semibold text-slate-800">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => changeShowCompleted(e.target.checked)}
          />
          完了した案件も表示
        </label>
        <Button size="sm" onClick={handleSearch}>
          検索
        </Button>
        <button onClick={handleClear} className={SUB_BUTTON_CLASS}>
          条件をクリア
        </button>
        <button onClick={() => void reload()} className={SUB_BUTTON_CLASS}>
          再読込
        </button>
        <button
          onClick={() => void exportCsv()}
          disabled={csvDownloading}
          className={`${SUB_BUTTON_CLASS} disabled:opacity-50`}
        >
          {csvDownloading ? "出力中..." : "CSVダウンロード"}
        </button>
      </div>

      <MessageBanner error={error} />

      {loading ? (
        <LoadingGate label="読み込み中..." />
      ) : (
        <ProgressTable
          rows={rows}
          assignment={
            canUpdate
              ? {
                  employees,
                  onAssign: (k, id, s, e) => void assign(k, id, s, e),
                }
              : undefined
          }
        />
      )}

      {showCompleted ? (
        <Pagination
          paginationEnabled
          page={page}
          totalPages={totalPages}
          total={total ?? 0}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={changeLimit}
          limitOptions={[10, 30, 50]}
        />
      ) : (
        <div className="flex items-center gap-3 text-xs text-slate-800">
          <span>進行中の案件を新しい順に{rows.length}件表示しています。</span>
          {hasMore && (
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className={`${SUB_BUTTON_CLASS} disabled:opacity-50`}
            >
              {loadingMore ? "読み込み中..." : "さらに読み込む"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
