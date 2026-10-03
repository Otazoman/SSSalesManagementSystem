"use client";

import { RoleRecord, PermissionRecord, ScreenOption } from "../_types";

interface HeaderProps {
  screenOptions: ScreenOption[];
  permissions: PermissionRecord[];
  roles: RoleRecord[];
  selectedRoleId: string;
  checkedPermissionIds: string[];
  canDownload: boolean;
  isSubmitting?: boolean;
  onDownloadCsv: () => void;
}

export function Header({
  screenOptions,
  permissions,
  roles,
  selectedRoleId,
  checkedPermissionIds,
  canDownload,
  isSubmitting = false,
  onDownloadCsv,
}: HeaderProps) {
  return (
    <div className="flex justify-between items-start border-b pb-4 border-slate-200">
      <div>
        <h1 className="text-2xl font-black text-slate-900">
          🛡️ 画面・権限マスタ
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          システム共通画面マスタにあるすべての業務画面と、基本5権限(メニュー表示・CRUD)枠は最初から一括展開して表示されます。
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px]">
          <span className="inline-flex items-center bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md font-bold border border-slate-200">
            🖥️ 対象画面数:{" "}
            <strong className="text-indigo-600 ml-1 font-black text-xs">
              {screenOptions.length}
            </strong>{" "}
            件
          </span>
          <span className="inline-flex items-center bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md font-bold border border-slate-200">
            ⚡ 権限(アクション)総数:{" "}
            <strong className="text-indigo-600 ml-1 font-black text-xs">
              {permissions.length}
            </strong>{" "}
            件
          </span>
          <span className="inline-flex items-center bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md font-bold border border-slate-200">
            👥 対象ロール:{" "}
            <strong className="text-indigo-600 ml-1 font-black text-xs">
              {roles.length}
            </strong>{" "}
            件
          </span>
          {selectedRoleId && (
            <span className="inline-flex items-center bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-md font-bold border border-indigo-100">
              🔍 選択中ロール付与数:{" "}
              <strong className="text-indigo-600 ml-1 font-black text-xs">
                {checkedPermissionIds.length}
              </strong>{" "}
              / {permissions.length}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center space-x-2 shrink-0">
        <button
          onClick={onDownloadCsv}
          disabled={!canDownload || isSubmitting}
          className={`text-xs px-3 py-2 rounded font-bold text-white transition-colors shadow-sm ${
            canDownload && !isSubmitting
              ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          📥 CSVダウンロード
        </button>
      </div>
    </div>
  );
}
