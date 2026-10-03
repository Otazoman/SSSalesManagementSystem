"use client";

import { useState } from "react";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { Button } from "../../_shared/ui/Button";
import { useAnnouncements } from "./_hooks/useAnnouncements";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { HtmlEditor } from "../../_shared/ui/HtmlEditor";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { ScreenDescriptionsManager } from "./_components/ScreenDescriptionsManager";
import { todayJst } from "../../_shared/jst-date";

const INPUT_CLASS =
  "border border-slate-400 rounded px-2 py-1.5 bg-white text-slate-900 placeholder-slate-500";
const SUB_BUTTON_CLASS =
  "px-4 py-1.5 border border-slate-400 rounded bg-white text-slate-800 hover:bg-slate-100";

function statusOf(item: {
  isPublished: boolean;
  publishDate: string;
  endDate: string | null;
}) {
  const today = todayJst();
  if (!item.isPublished) return "下書き(非公開)";
  if (item.publishDate > today) return "掲載前";
  if (item.endDate && item.endDate < today) return "掲載終了";
  return "掲載中";
}

export default function AnnouncementsPage() {
  const [tab, setTab] = useState<"announcements" | "screens">("announcements");
  const {
    canRead,
    canCreate,
    canUpdate,
    canDelete,
    loading: permsLoading,
  } = usePagePermissions();
  const {
    items,
    loading,
    error,
    message,
    editingId,
    form,
    saving,
    changeForm,
    startEdit,
    resetForm,
    save,
    remove,
  } = useAnnouncements(canRead);

  if (permsLoading) return <LoadingGate />;
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  const canSubmit = editingId ? canUpdate : canCreate;

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="📢 システムからのお知らせ管理"
        description={
          <>
            ダッシュボードの最上段に表示するお知らせを登録します。「公開」にして掲載日になった時点から表示され、掲載終了日を過ぎると表示されなくなります。
            重要なお知らせは強調され、先頭に表示されます。
          </>
        }
      />

      <StatusTabs
        options={[
          { value: "announcements", label: "📢 お知らせ" },
          { value: "screens", label: "📝 各画面の説明" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "screens" && (
        <ScreenDescriptionsManager
          canUpdate={canUpdate}
          canDelete={canDelete}
        />
      )}

      <MessageBanner
        message={tab === "announcements" ? message : ""}
        error={tab === "announcements" ? error : ""}
      />

      {tab === "announcements" && (canCreate || (editingId && canUpdate)) && (
        <div className="border border-slate-300 rounded-lg p-4 space-y-3 text-base sm:text-xs bg-white text-slate-900">
          <h2 className="text-sm font-bold">
            {editingId ? "お知らせを編集" : "お知らせを新規登録"}
          </h2>
          <label className="block space-y-1">
            <span className="block font-semibold text-slate-800">
              タイトル(必須)
            </span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => changeForm("title", e.target.value)}
              className={`${INPUT_CLASS} w-full`}
              maxLength={200}
            />
          </label>
          <div className="block space-y-1">
            <span className="block font-semibold text-slate-800">
              本文(任意。リンク・書式を入れられます)
            </span>
            <HtmlEditor
              value={form.body}
              onChange={(v) => changeForm("body", v)}
              previewUrl="/api/announcements/preview"
              rows={6}
            />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="space-y-1">
              <span className="block font-semibold text-slate-800">掲載日</span>
              <input
                type="date"
                value={form.publishDate}
                onChange={(e) => changeForm("publishDate", e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="space-y-1">
              <span className="block font-semibold text-slate-800">
                掲載終了日(任意)
              </span>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => changeForm("endDate", e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex items-center gap-1 text-slate-800 font-semibold">
              <input
                type="checkbox"
                checked={form.isImportant}
                onChange={(e) => changeForm("isImportant", e.target.checked)}
              />
              重要(強調して先頭に表示)
            </label>
            <label className="flex items-center gap-1 text-slate-800 font-semibold">
              <input
                type="checkbox"
                checked={form.isPublished}
                onChange={(e) => changeForm("isPublished", e.target.checked)}
              />
              公開する
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={
                saving || !canSubmit || !form.title.trim() || !form.publishDate
              }
            >
              {saving ? "保存中..." : editingId ? "保存" : "登録"}
            </Button>
            {editingId && (
              <button onClick={resetForm} className={SUB_BUTTON_CLASS}>
                編集をやめる
              </button>
            )}
          </div>
        </div>
      )}

      {tab === "announcements" &&
        (loading ? (
          <LoadingGate label="読み込み中..." />
        ) : (
          <div className="overflow-auto border border-slate-200 rounded-lg bg-white">
            <table className="min-w-full text-xs text-slate-900">
              <thead className="bg-slate-100 text-slate-900">
                <tr>
                  <th className="px-3 py-2 text-left">状態</th>
                  <th className="px-3 py-2 text-left">掲載日</th>
                  <th className="px-3 py-2 text-left">掲載終了日</th>
                  <th className="px-3 py-2 text-left">タイトル</th>
                  <th className="px-3 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-slate-700"
                    >
                      お知らせは登録されていません
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-1.5 whitespace-nowrap font-semibold">
                      {statusOf(item)}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono">
                      {item.publishDate}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono">
                      {item.endDate ?? ""}
                    </td>
                    <td className="px-3 py-1.5">
                      {item.isImportant && (
                        <span className="mr-2 px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-bold">
                          重要
                        </span>
                      )}
                      {item.title}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {canUpdate && (
                        <button
                          onClick={() => startEdit(item)}
                          className="px-2 py-0.5 mr-1 border border-indigo-600 text-indigo-800 rounded bg-white hover:bg-indigo-50 font-semibold"
                        >
                          編集
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => void remove(item)}
                          className="px-2 py-0.5 border border-red-600 text-red-800 rounded bg-white hover:bg-red-50 font-semibold"
                        >
                          削除
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
