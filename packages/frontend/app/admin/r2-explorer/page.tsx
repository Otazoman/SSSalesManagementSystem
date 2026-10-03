"use client";

import { useState } from "react";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { useR2Explorer } from "./_hooks/useR2Explorer";
import { R2ExplorerItem } from "./_types";

function formatBytes(bytes?: number): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Item13-a: 重要な業務資産(フォント・ロゴ・印影)が置かれているフォルダに入った際の注意喚起
function isSensitivePrefix(bucket: string, prefix: string): boolean {
  return (
    bucket === "system" &&
    (prefix.startsWith("company/") || prefix.startsWith("fonts/"))
  );
}

export default function R2ExplorerPage() {
  const {
    canRead,
    canCreate,
    canUpdate,
    canDelete,
    loading: permsLoading,
  } = usePagePermissions();
  const {
    buckets,
    bucket,
    prefix,
    result,
    loading,
    message,
    error,
    handleSelectBucket,
    handleOpenFolder,
    handleNavigateUp,
    handleDelete,
    handleRename,
    handleDownload,
    handleUpload,
  } = useR2Explorer();

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (permsLoading) return <LoadingGate />;
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  const startRename = (item: R2ExplorerItem) => {
    setRenamingPath(item.path);
    setRenameValue(item.name);
  };

  const submitRename = async (item: R2ExplorerItem) => {
    const success = await handleRename(item, renameValue);
    if (success) setRenamingPath(null);
  };

  const breadcrumbSegments = prefix.split("/").filter(Boolean);

  const onSelectUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを続けて選べるようにリセット
    if (file) await handleUpload(file);
  };

  return (
    <div className="w-full space-y-6">
      <div className="border-b pb-4 border-slate-200">
        <h1 className="text-2xl font-black text-slate-900">
          🗂️ R2ファイル管理
        </h1>
        <p className="text-sm text-slate-800 mt-1">
          各機能が保存したファイル(添付・帳票PDF等)をバケット横断で閲覧・ダウンロード・アップロード・削除・名称変更します。削除・上書きは取り消せません。アップロードは1ファイル20MBまで、表示中のフォルダに保存されます。
        </p>
      </div>

      <MessageBanner message={message} error={error} />

      <div className="flex flex-wrap gap-2">
        {buckets.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => handleSelectBucket(b.key)}
            className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer transition-colors ${
              bucket === b.key
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-white border border-slate-300 text-slate-800 hover:bg-slate-100"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded px-3 py-2">
        <span className="font-mono">/</span>
        {breadcrumbSegments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="font-mono">{seg}</span>
            <span>/</span>
          </span>
        ))}
      </div>

      {canCreate && (
        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 border border-slate-400 rounded px-3 py-1.5 bg-white cursor-pointer hover:bg-slate-100">
          ⬆️ このフォルダへアップロード
          <input
            type="file"
            className="hidden"
            onChange={(e) => void onSelectUploadFile(e)}
          />
        </label>
      )}

      {isSensitivePrefix(bucket, prefix) && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold rounded px-3 py-2">
          ⚠️
          このフォルダには会社ロゴ・印影・帳票用フォント等、アプリ全体のPDF生成で使われる重要なファイルが含まれています。削除・名称変更は慎重に行ってください。
        </div>
      )}

      {loading ? (
        <p className="text-xs text-slate-700">読み込み中...</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-900 border-b border-slate-200">
                <th className="text-left px-4 py-2 font-medium">名前</th>
                <th className="text-left px-4 py-2 font-medium">種別</th>
                <th className="text-right px-4 py-2 font-medium">サイズ</th>
                <th className="text-center px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {prefix && (
                <tr className="hover:bg-slate-50 transition-colors">
                  <td colSpan={4} className="px-4 py-2">
                    <button
                      type="button"
                      onClick={handleNavigateUp}
                      className="text-indigo-800 font-bold cursor-pointer"
                    >
                      ⬆️ 上の階層へ
                    </button>
                  </td>
                </tr>
              )}
              {result && result.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-slate-700 italic"
                  >
                    ファイルがありません。
                  </td>
                </tr>
              ) : (
                result?.items.map((item) => (
                  <tr
                    key={item.path}
                    className="hover:bg-slate-50 transition-colors border-t border-slate-100"
                  >
                    <td className="px-4 py-2 text-slate-700">
                      {item.type === "folder" ? (
                        <button
                          type="button"
                          onClick={() => handleOpenFolder(item)}
                          className="text-indigo-800 font-bold cursor-pointer"
                        >
                          📂 {item.name}
                        </button>
                      ) : renamingPath === item.path ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            className="border border-slate-400 p-1 text-base sm:text-xs rounded bg-white text-slate-900"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => void submitRename(item)}
                            className="text-emerald-800 font-bold cursor-pointer"
                          >
                            ✓ 保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingPath(null)}
                            className="text-slate-700 cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <span>📄 {item.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-800">
                      {item.type === "folder"
                        ? "フォルダ"
                        : item.contentType || "-"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-800">
                      {item.type === "file" ? formatBytes(item.size) : "-"}
                    </td>
                    <td className="px-4 py-2 text-center whitespace-nowrap">
                      {item.type === "file" && renamingPath !== item.path && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleDownload(item)}
                            className="text-xs text-indigo-800 hover:text-indigo-950 font-bold mr-3 cursor-pointer"
                          >
                            ⬇️ ダウンロード
                          </button>
                          <button
                            type="button"
                            onClick={() => startRename(item)}
                            disabled={!canUpdate}
                            className="text-xs text-slate-800 hover:text-indigo-800 font-bold mr-3 disabled:text-slate-500 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                          >
                            ✏️ 名称変更
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(item)}
                            disabled={!canDelete}
                            className="text-xs text-red-700 hover:text-red-900 font-bold disabled:text-slate-500 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                          >
                            🗑️ 削除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
