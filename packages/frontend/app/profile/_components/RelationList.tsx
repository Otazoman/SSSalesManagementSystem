import { BelongRelation } from "../_types";

interface RelationListProps {
  loading: boolean;
  userRelations: BelongRelation[];
}

export function RelationList({ loading, userRelations }: RelationListProps) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-3 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800">所属組織 ✕ 役職権限</h3>

      {loading ? (
        <p className="text-xs text-slate-600 italic animate-pulse">
          所属マトリックスの整合性を検証中...
        </p>
      ) : (
        <div className="space-y-2">
          {userRelations.length > 0 ? (
            userRelations.map((rel, i) => (
              <div
                key={i}
                className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-xs shadow-sm w-fit"
              >
                <span className="font-bold text-slate-700">
                  {rel.departmentName}
                </span>
                <span className="text-slate-600">➔</span>
                <span
                  className={`font-extrabold px-1.5 py-0.5 rounded ${
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
            <p className="text-xs text-slate-600 italic">
              所属組織およびシステム権限ロールが設定されていません(未設定)。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
