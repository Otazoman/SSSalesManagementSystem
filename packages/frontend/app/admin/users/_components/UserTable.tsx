"use client";

import { UserRecord } from "../_types";
import { DataTable } from "../../../_shared/ui/DataTable";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UserTableProps {
  users: UserRecord[];
  hasUpdate: boolean;
  hasDelete: boolean;
  isSubmitting?: boolean;
  onSelectRow: (user: UserRecord) => void;
  onPurgeClick: (id: string, name: string) => void;
  syncMasterData: () => void;
  sortBy?: string | null;
  sortDirection?: "asc" | "desc";
  sortKeys?: { key: string; direction: "asc" | "desc" }[];
  onSortChange?: (key: string) => void;
}

export function UserTable({
  users,
  hasUpdate,
  hasDelete,
  isSubmitting = false,
  onSelectRow,
  onPurgeClick,
  syncMasterData,
  sortBy,
  sortDirection,
  sortKeys,
  onSortChange,
}: UserTableProps) {
  const confirm = useConfirm();
  return (
    <DataTable
      columns={[
        { key: "employeeNumber", label: "従業員番号", sortable: true },
        { key: "name", label: "氏名", sortable: true },
        { key: "email", label: "メールアドレス", sortable: true },
        { key: "relations", label: "所属組織 ➔ 保持権限マトリックス一覧" },
        { key: "actions", label: "操作", align: "center", className: "w-[180px]" },
      ]}
      data={users}
      emptyMessage="該当するデータはありません"
      sortBy={sortBy}
      sortDirection={sortDirection}
      sortKeys={sortKeys}
      onSortChange={onSortChange}
      renderRow={(u) => {
        const isSystemAdminAccount = u.employeeNumber === "admin";
        const canPurge =
          (!u.relations || u.relations.length === 0) &&
          !isSystemAdminAccount &&
          hasDelete;
        return (
          <tr
            key={u.id}
            className={`hover:bg-slate-50 transition-colors ${
              !u.isActive ? "bg-slate-50/60 text-slate-600" : ""
            } cursor-pointer`}
            onClick={() => onSelectRow(u)}
          >
            <td className="px-4 py-3 font-mono font-bold text-slate-900">
              {u.employeeNumber}
            </td>
            <td className="px-4 py-3 font-semibold text-slate-900">
              <span className={!u.isActive ? "line-through text-slate-600" : ""}>
                {u.name}
              </span>
              {isSystemAdminAccount && (
                <span className="ml-2 text-[9px] bg-slate-900 text-white border border-slate-950 px-1.5 py-0.5 rounded font-mono font-bold inline-block">
                  ROOT
                </span>
              )}
              {!u.isActive && (
                <span className="ml-2 text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded font-bold inline-block">
                  無効
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-slate-600">{u.email}</td>
            <td className="px-4 py-3 space-y-1.5">
              {u.relations && u.relations.length > 0 ? (
                u.relations.map((rel, i) => (
                  <div
                    key={i}
                    className="inline-flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded px-2 py-1 mr-2 shadow-sm"
                  >
                    <span className="text-[11px] font-bold text-slate-700">
                      {rel.departmentName}
                    </span>
                    <span className="text-slate-600 text-xs">➔</span>
                    <span
                      className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded ${
                        rel.roleId === "admin"
                          ? "bg-rose-50 text-rose-700 border border-rose-100"
                          : "bg-indigo-50 text-indigo-700 border border-indigo-100"
                      }`}
                    >
                      {rel.roleName}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-slate-600 italic text-[11px]">
                  未設定(所属・権限なし)
                </span>
              )}
            </td>
            <td
              className="px-4 py-3 text-center space-x-3 whitespace-nowrap w-[180px]"
              onClick={(e) => e.stopPropagation()}
            >
              {u.isActive ? (
                <>
                  <button
                    onClick={() => onSelectRow(u)}
                    disabled={!hasUpdate || isSubmitting}
                    className={`font-bold ${
                      hasUpdate && !isSubmitting
                        ? "text-indigo-600 hover:underline cursor-pointer"
                        : "text-slate-600 no-underline cursor-not-allowed"
                    }`}
                  >
                    変更
                  </button>

                  {!isSystemAdminAccount &&
                    (hasUpdate ? (
                      <button
                        onClick={async () => {
                          if (
                            !(await confirm(
                              `本当に「${u.name}」さんを無効化しますか？\n(配属されていたすべての所属・権限マトリックス設定も自動的に解除されます)`,
                            ))
                          )
                            return;
                          await apiFetch(`/api/users/${u.id}/suspend`, {
                            method: "POST",
                          });
                          void syncMasterData();
                        }}
                        disabled={isSubmitting}
                        className="text-red-600 font-bold hover:underline cursor-pointer"
                      >
                        無効化
                      </button>
                    ) : (
                      <span className="text-slate-600 font-bold cursor-not-allowed">
                        無効化
                      </span>
                    ))}
                </>
              ) : (
                <>
                  {hasUpdate ? (
                    <button
                      onClick={async () => {
                        if (
                          !(await confirm(
                            `「${u.name}」さんのアカウントを再度有効に戻しますか？`,
                          ))
                        )
                          return;
                        await apiFetch(`/api/users/${u.id}`, {
                          method: "PUT",
                          json: { name: u.name, email: u.email, isActive: true },
                        });
                        void syncMasterData();
                      }}
                      disabled={isSubmitting}
                      className="text-emerald-600 font-bold hover:underline cursor-pointer text-xs"
                    >
                      復元
                    </button>
                  ) : (
                    <span className="text-slate-600 font-bold cursor-not-allowed text-xs">
                      復元
                    </span>
                  )}

                  <button
                    disabled={!canPurge || isSubmitting}
                    onClick={() => onPurgeClick(u.id, u.name)}
                    className={`text-xs font-bold px-2 py-0.5 rounded border transition-colors ${
                      canPurge && !isSubmitting
                        ? "text-rose-700 border-rose-200 bg-rose-50 hover:bg-rose-100 cursor-pointer"
                        : "text-slate-600 border-slate-100 bg-slate-50 cursor-not-allowed"
                    }`}
                  >
                    削除
                  </button>
                </>
              )}
            </td>
          </tr>
        );
      }}
    />
  );
}
