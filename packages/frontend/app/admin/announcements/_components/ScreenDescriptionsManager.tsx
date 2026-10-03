"use client";

import { useMemo, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { Button } from "../../../_shared/ui/Button";
import { HtmlEditor } from "../../../_shared/ui/HtmlEditor";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { usePermissionContext } from "../../../context/permissioncontext";
import { useScreenDescriptions } from "../../../context/screen-descriptions";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface ScreenDescriptionsManagerProps {
  canUpdate: boolean;
  canDelete: boolean;
}

/**
 * 各画面の見出し下に出す説明(HTML)を編集する。未設定の画面は、コードに書かれた既定の説明のまま。
 * 保存・削除の後は、画面の見出しが最新の内容を読み直す(refresh)。
 */
export function ScreenDescriptionsManager({
  canUpdate,
  canDelete,
}: ScreenDescriptionsManagerProps) {
  const confirm = useConfirm();
  const { flatScreens } = usePermissionContext();
  const { descriptions, refresh } = useScreenDescriptions();
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const screens = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return flatScreens
      .filter((s) => s.path && s.path !== "#")
      .filter(
        (s) =>
          !k ||
          s.title.toLowerCase().includes(k) ||
          s.path.toLowerCase().includes(k),
      )
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [flatScreens, keyword]);

  const select = (path: string) => {
    setSelected(path);
    setDraft(descriptions[path] ?? "");
    setError("");
    setMessage("");
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiFetch("/api/screen-descriptions", {
        method: "PUT",
        json: { path: selected, descriptionHtml: draft },
      });
      await refresh();
      setMessage("画面の説明を保存しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!selected) return;
    if (
      !(await confirm(
        "この画面の説明を削除し、既定の説明に戻します。よろしいですか？",
      ))
    )
      return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await apiFetch(
        `/api/screen-descriptions?path=${encodeURIComponent(selected)}`,
        { method: "DELETE" },
      );
      await refresh();
      setDraft("");
      setMessage("既定の説明に戻しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const current =
    screens.find((s) => s.path === selected) ??
    flatScreens.find((s) => s.path === selected);
  const isCustom = selected !== null && selected in descriptions;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="space-y-2">
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="画面名・パスで絞り込み"
          aria-label="画面を絞り込み"
          className={formFieldInputClass}
        />
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-slate-300 bg-white lg:max-h-[32rem]">
          {screens.map((s) => (
            <li key={s.path}>
              <button
                type="button"
                onClick={() => select(s.path)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs text-slate-800 hover:bg-slate-50 ${selected === s.path ? "bg-indigo-50 font-bold" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    {s.icon} {s.title}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-slate-600">
                    {s.path}
                  </span>
                </span>
                {s.path in descriptions && (
                  <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                    設定済み
                  </span>
                )}
              </button>
            </li>
          ))}
          {screens.length === 0 && (
            <li className="px-3 py-4 text-xs text-slate-600">
              該当する画面がありません
            </li>
          )}
        </ul>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-300 bg-white p-4 text-slate-900">
        {!selected || !current ? (
          <p className="text-xs text-slate-700">
            左の一覧から、説明を編集する画面を選んでください。
          </p>
        ) : (
          <>
            <div>
              <h2 className="text-sm font-bold">
                {current.icon} {current.title}
              </h2>
              <p className="font-mono text-[11px] text-slate-600">
                {current.path}
              </p>
              <p className="mt-1 text-[11px] text-slate-700">
                {isCustom
                  ? "この画面には、設定した説明が表示されています。"
                  : "この画面は、コードに書かれた既定の説明が表示されています。ここで保存すると、その説明に置き換わります。"}
              </p>
            </div>
            <MessageBanner message={message} error={error} />
            <HtmlEditor
              value={draft}
              onChange={setDraft}
              previewUrl="/api/screen-descriptions/preview"
              disabled={!canUpdate}
              rows={7}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {canDelete && isCustom && (
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void reset()}
                >
                  既定の説明に戻す
                </Button>
              )}
              {canUpdate && (
                <Button
                  disabled={saving || draft.trim() === ""}
                  onClick={() => void save()}
                >
                  {saving ? "保存中..." : "保存"}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
