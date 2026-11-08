"use client";

import {
  RoleRecord,
  PermissionRecord,
  ScreenOption,
  ActionOption,
} from "../_types";

interface MatrixTableProps {
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  screenOptions: ScreenOption[];
  dynamicHeaderActions: ActionOption[];
  selectedRoleId: string;
  checkedPermissionIds: string[];
  canUpdate: boolean;
  isSaving: boolean;
  onRoleChange: (roleId: string) => void;
  onSave: () => void;
  // BUG-082: 一括操作は「すべてON」「すべてOFF」を明示して指定する
  onSetColumn: (actionKey: string, enabled: boolean) => void;
  onSetRow: (resourceKey: string, enabled: boolean) => void;
  onCellChange: (permissionId: string) => void;
}

// 一括操作の「すべてON」「すべてOFF」ボタン(状態は持たず、押した時にまとめて変えるだけ)
function BulkButtons({
  disabled,
  targetLabel,
  onSet,
  vertical = false,
}: {
  disabled: boolean;
  targetLabel: string;
  onSet: (enabled: boolean) => void;
  vertical?: boolean;
}) {
  const buttonClass =
    "px-1.5 py-0.5 rounded border border-slate-300 bg-white text-slate-800 text-[10px] font-bold whitespace-nowrap hover:bg-slate-100 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <div className={`inline-flex gap-1 ${vertical ? "flex-col" : ""}`}>
      <button
        type="button"
        className={buttonClass}
        disabled={disabled}
        onClick={() => onSet(true)}
        aria-label={`${targetLabel}をすべてON`}
        title={`${targetLabel}をすべてONにします(保存するまで確定しません)`}
      >
        すべてON
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={disabled}
        onClick={() => onSet(false)}
        aria-label={`${targetLabel}をすべてOFF`}
        title={`${targetLabel}をすべてOFFにします(保存するまで確定しません)`}
      >
        すべてOFF
      </button>
    </div>
  );
}

export function MatrixTable({
  roles,
  permissions,
  screenOptions,
  dynamicHeaderActions,
  selectedRoleId,
  checkedPermissionIds,
  canUpdate,
  isSaving,
  onRoleChange,
  onSave,
  onSetColumn,
  onSetRow,
  onCellChange,
}: MatrixTableProps) {
  const displayResourceKeys = screenOptions.map((s) => s.resource);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col justify-between">
      <div>
        {/* 操作ヘッダー領域 */}
        <div className="bg-slate-50 p-4 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-bold text-slate-700">
              🎯 権限を設定するロール:
            </span>
            <select
              className="border p-1.5 text-xs bg-white text-slate-900 font-bold rounded cursor-pointer"
              value={selectedRoleId}
              onChange={(e) => onRoleChange(e.target.value)}
            >
              {roles
                .filter((r) => r.id !== "admin")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </div>

          <button
            onClick={onSave}
            disabled={isSaving || !canUpdate}
            className={`w-full sm:w-auto font-bold text-xs px-5 py-2 rounded shadow-sm transition-colors ${
              canUpdate && !isSaving
                ? "bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
                : "bg-slate-200 text-slate-600 cursor-not-allowed"
            }`}
          >
            {isSaving ? "同期書き込み中..." : "マトリクス設定を保存する 💾"}
          </button>
        </div>

        {/* BUG-082: 一括操作の説明 */}
        <p className="px-4 py-2 text-xs text-slate-700 bg-white border-b border-slate-200">
          「すべてON」「すべてOFF」は、画面上のチェックをまとめて付け外しします。
          上の「すべての画面に一括適用」の行は、その権限(列)をすべての画面で、各画面の右端の「行一括」は、その画面のすべての権限を変えます。
          <strong className="text-slate-900">「マトリクス設定を保存する」を押すまで保存されません。</strong>
        </p>

        {/* 縦横スクロール可能なコンテナ(高さの上限を設定) */}
        <div className="overflow-auto max-h-[calc(100vh-220px)] relative">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-100 text-slate-700 border-b border-slate-200 font-bold">
              {/* 1段目ヘッダー */}
              <tr>
                <th
                  className="px-4 py-3 text-left min-w-[220px] bg-slate-100 sticky top-0 z-20 border-b border-slate-200 shadow-sm"
                  rowSpan={2}
                >
                  対象アプリケーション・画面
                </th>
                {dynamicHeaderActions.map((act) => (
                  <th
                    key={act.key}
                    className="px-2 pt-2.5 pb-0.5 text-center text-slate-900 text-[11px] font-black tracking-wider whitespace-nowrap bg-slate-100 sticky top-0 z-10"
                  >
                    {act.label}
                  </th>
                ))}
                <th
                  className="px-4 py-3 text-center bg-slate-100 sticky top-0 z-20 border-b border-slate-200 shadow-sm"
                  rowSpan={2}
                >
                  行一括
                  <div className="text-[10px] font-medium text-slate-600">
                    (この画面の全権限)
                  </div>
                </th>
              </tr>
              {/* 2段目ヘッダー */}
              <tr>
                {dynamicHeaderActions.map((act) => (
                  <th
                    key={act.key}
                    className="px-2 pb-2 text-center text-[9px] text-slate-600 font-mono font-medium lowercase tracking-tight bg-slate-100 border-b border-slate-200 sticky top-[29px] z-10 shadow-sm"
                  >
                    ({act.key})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              {/* 一括適用行(固定) */}
              <tr className="bg-indigo-50/90 text-slate-900 font-semibold border-b-2 border-indigo-100 sticky top-[57px] z-10 backdrop-blur-sm shadow-xs">
                <td className="px-4 py-2.5 text-indigo-800 font-bold bg-indigo-50/90">
                  ⚡ すべての画面に一括適用
                </td>
                {dynamicHeaderActions.map((act) => {
                  const hasColumnPerms = permissions.some((p) => p.action === act.key);
                  return (
                    <td
                      key={act.key}
                      className="px-2 py-2.5 text-center bg-indigo-50/90"
                    >
                      <BulkButtons
                        vertical
                        disabled={!canUpdate || !hasColumnPerms}
                        targetLabel={`すべての画面の「${act.label}」`}
                        onSet={(enabled) => onSetColumn(act.key, enabled)}
                      />
                    </td>
                  );
                })}
                <td className="px-4 py-2.5 bg-indigo-50/90 text-center text-[10px] text-slate-700 font-medium">
                  (列ごとに
                  <br />
                  全画面へ適用)
                </td>
              </tr>

              {/* 各画面レコード */}
              {displayResourceKeys.map((resKey) => {
                const screenConfig = screenOptions.find(
                  (s) => s.resource === resKey,
                );
                const displayName = screenConfig ? screenConfig.name : resKey;

                const hasRowPerms = permissions.some((p) => p.resource === resKey);

                return (
                  <tr
                    key={resKey}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="px-4 py-3.5">
                      <div className="font-bold text-slate-900">
                        {displayName}
                      </div>
                      <div className="text-[10px] text-slate-600 font-mono mt-0.5">
                        {resKey}
                      </div>
                    </td>

                    {dynamicHeaderActions.map((act) => {
                      const targetId = `${resKey}:${act.key}`;
                      const targetPermExists = permissions.some(
                        (p) => p.id === targetId,
                      );
                      const isChecked = checkedPermissionIds.includes(targetId);

                      return (
                        <td key={act.key} className="px-2 py-3.5 text-center">
                          {targetPermExists ? (
                            <input
                              type="checkbox"
                              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer disabled:opacity-40"
                              checked={isChecked}
                              disabled={!canUpdate}
                              onChange={() => onCellChange(targetId)}
                            />
                          ) : (
                            <span className="text-slate-500 select-none">
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}

                    <td className="px-4 py-3.5 text-center">
                      <BulkButtons
                        disabled={!canUpdate || !hasRowPerms}
                        targetLabel={`「${displayName}」のすべての権限`}
                        onSet={(enabled) => onSetRow(resKey, enabled)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
