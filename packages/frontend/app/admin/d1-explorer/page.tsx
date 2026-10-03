"use client";

import { usePagePermissions } from "../../hooks/use-page-permission";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { useD1Explorer } from "./_hooks/useD1Explorer";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";

const INPUT_CLASS =
  "border border-slate-400 rounded px-2 py-1.5 bg-white text-slate-900 placeholder-slate-500";
const BUTTON_CLASS =
  "px-4 py-1.5 border border-slate-400 rounded bg-white text-slate-800 hover:bg-slate-100 disabled:opacity-50 disabled:text-slate-500";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function D1ExplorerPage() {
  const {
    canRead,
    canUpdate,
    canDelete,
    loading: permsLoading,
  } = usePagePermissions();
  const {
    databases,
    dbKey,
    setDbKey,
    tables,
    table,
    columns,
    rows,
    page,
    pageSize,
    total,
    loading,
    error,
    message,
    selectTable,
    goToPage,
    fetchCount,
    saving,
    editKey,
    editFields,
    startEdit,
    changeEditField,
    cancelEdit,
    saveEdit,
    deleteKey,
    deleteConfirm,
    setDeleteConfirm,
    startDelete,
    cancelDelete,
    confirmDelete,
  } = useD1Explorer(canRead);

  if (permsLoading) return <LoadingGate />;
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  const currentDb = databases.find((d) => d.key === dbKey);
  const showRowActions = !!rows?.writable && (canUpdate || canDelete);

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="🗄️ D1データ参照・編集"
        description={
          <>
            D1のテーブル構造とデータを閲覧し、メインDBは主キーで指定した1行の編集・削除ができます(テーブル・列の変更はできません)。
            ログDB・仕訳DBは閲覧専用です。パスワード・トークン等の列は値を伏せ字にし、編集もできません。
            D1無料プランの読み取り行数節約のため、1ページ最大{pageSize}
            行・先頭10,000行までの表示に制限し、件数は明示操作で取得します。
            編集・削除の内容(変更前後)は操作ログに記録されます。
          </>
        }
      />

      <MessageBanner message={message} error={error} />

      <div className="flex flex-wrap items-end gap-3 text-xs">
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">
            データベース
          </span>
          <select
            value={dbKey}
            onChange={(e) => setDbKey(e.target.value)}
            className={INPUT_CLASS}
          >
            {databases.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
                {d.writable ? "" : "(閲覧専用)"}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block font-semibold text-slate-800">テーブル</span>
          <select
            value={table}
            onChange={(e) => e.target.value && void selectTable(e.target.value)}
            className={`${INPUT_CLASS} min-w-64`}
          >
            <option value="">選択してください</option>
            {tables.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.type === "view" ? " (view)" : ""}
              </option>
            ))}
          </select>
        </label>
        {table && (
          <button
            onClick={() => void fetchCount()}
            className={BUTTON_CLASS}
            title="全行を走査するため、大きなテーブルでは読み取り行数を消費します"
          >
            {total === null ? "件数を取得" : `${total.toLocaleString()} 件`}
          </button>
        )}
        {currentDb && !currentDb.writable && (
          <span className="px-2 py-1 rounded bg-amber-100 text-amber-900 font-semibold">
            閲覧専用のDBです
          </span>
        )}
      </div>

      {table && columns.length > 0 && (
        <details className="text-xs border border-slate-200 rounded-lg bg-white">
          <summary className="px-3 py-2 cursor-pointer font-semibold text-slate-800">
            列定義({columns.length}列)
          </summary>
          <table className="min-w-full text-slate-900">
            <thead className="bg-slate-100 text-slate-900">
              <tr>
                <th className="px-3 py-1.5 text-left">列名</th>
                <th className="px-3 py-1.5 text-left">型</th>
                <th className="px-3 py-1.5 text-left">NOT NULL</th>
                <th className="px-3 py-1.5 text-left">主キー</th>
                <th className="px-3 py-1.5 text-left">伏せ字</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {columns.map((col) => (
                <tr key={col.name}>
                  <td className="px-3 py-1 font-mono">{col.name}</td>
                  <td className="px-3 py-1">{col.type}</td>
                  <td className="px-3 py-1">{col.notNull ? "○" : ""}</td>
                  <td className="px-3 py-1">{col.primaryKey ? "○" : ""}</td>
                  <td className="px-3 py-1">{col.masked ? "○" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {editKey && (
        <div className="border-2 border-indigo-500 rounded-lg p-4 space-y-3 text-xs bg-white text-slate-900">
          <div className="font-bold text-sm">
            1行を編集: {table}(
            {Object.entries(editKey)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}
            )
          </div>
          <p className="text-slate-700">
            変更した項目だけが更新されます。数値の列は数値を入力してください。NULLにするにはチェックを入れます。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {editFields.map((f) => (
              <label key={f.column.name} className="space-y-1">
                <span className="block font-semibold text-slate-800">
                  <span className="font-mono">{f.column.name}</span>
                  <span className="ml-2 font-normal text-slate-700">
                    {f.column.type}
                    {f.column.notNull ? " / NOT NULL" : ""}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={f.value}
                    disabled={f.isNull}
                    onChange={(e) =>
                      changeEditField(f.column.name, { value: e.target.value })
                    }
                    className={`${INPUT_CLASS} flex-1 min-w-0 disabled:opacity-50`}
                  />
                  {!f.column.notNull && (
                    <label className="flex items-center gap-1 text-slate-800 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={f.isNull}
                        onChange={(e) =>
                          changeEditField(f.column.name, {
                            isNull: e.target.checked,
                          })
                        }
                      />
                      NULL
                    </label>
                  )}
                </div>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveEdit()} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
            <button onClick={cancelEdit} className={BUTTON_CLASS}>
              キャンセル
            </button>
          </div>
        </div>
      )}

      {deleteKey && (
        <div className="border-2 border-red-600 rounded-lg p-4 space-y-3 text-xs bg-white text-slate-900">
          <div className="font-bold text-sm text-red-800">
            1行を削除: {table}(
            {Object.entries(deleteKey)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}
            )
          </div>
          <p className="text-slate-800">
            この操作は取り消せません。他のテーブルから参照されている行は削除できない場合があります。
            確認のため、テーブル名「
            <span className="font-mono font-bold">{table}</span>
            」を入力してください。
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="テーブル名を入力"
              className={`${INPUT_CLASS} w-64`}
            />
            <Button
              variant="danger"
              size="sm"
              onClick={() => void confirmDelete()}
              disabled={saving || deleteConfirm !== table}
            >
              {saving ? "削除中..." : "削除する"}
            </Button>
            <button onClick={cancelDelete} className={BUTTON_CLASS}>
              キャンセル
            </button>
          </div>
        </div>
      )}

      {loading && <LoadingGate label="読み込み中..." />}

      {!loading && rows && (
        <>
          <div className="overflow-auto max-h-[70vh] border border-slate-200 rounded-lg">
            <table className="min-w-full text-xs text-slate-900">
              <thead className="bg-slate-100 text-slate-900">
                <tr>
                  {showRowActions && (
                    <th className="px-3 py-2 text-left sticky top-0 left-0 bg-slate-100 z-30 whitespace-nowrap">
                      操作
                    </th>
                  )}
                  {rows.columns.map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-left whitespace-nowrap font-mono sticky top-0 bg-slate-100 z-20"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={Math.max(
                        1,
                        rows.columns.length + (showRowActions ? 1 : 0),
                      )}
                      className="px-3 py-6 text-center text-slate-700"
                    >
                      データがありません
                    </td>
                  </tr>
                )}
                {rows.rows.map((row, i) => (
                  <tr key={i}>
                    {showRowActions && (
                      <td className="px-3 py-1.5 sticky left-0 bg-white z-10 whitespace-nowrap border-r border-slate-100">
                        {canUpdate && (
                          <button
                            onClick={() => void startEdit(row)}
                            className="px-2 py-0.5 mr-1 border border-indigo-600 text-indigo-800 rounded bg-white hover:bg-indigo-50 font-semibold"
                          >
                            編集
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => startDelete(row)}
                            className="px-2 py-0.5 border border-red-600 text-red-800 rounded bg-white hover:bg-red-50 font-semibold"
                          >
                            削除
                          </button>
                        )}
                      </td>
                    )}
                    {rows.columns.map((col) => (
                      <td
                        key={col}
                        className="px-3 py-1.5 max-w-96 truncate font-mono"
                        title={formatCell(row[col])}
                      >
                        {formatCell(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.writable === false && canRead && (
            <p className="text-xs text-slate-700">
              このテーブルは編集・削除できません(閲覧専用のDB、ビュー、主キーの無いテーブル、またはマイグレーション管理テーブル)。
            </p>
          )}
          <div className="flex items-center gap-3 text-xs text-slate-800">
            <button
              disabled={page <= 1}
              onClick={() => void goToPage(page - 1)}
              className={BUTTON_CLASS}
            >
              前へ
            </button>
            <span>
              {page} ページ目({(page - 1) * pageSize + 1}〜
              {(page - 1) * pageSize + rows.rows.length} 行)
            </span>
            <button
              disabled={!rows.hasMore}
              onClick={() => void goToPage(page + 1)}
              className={BUTTON_CLASS}
            >
              次へ
            </button>
          </div>
        </>
      )}
    </div>
  );
}
