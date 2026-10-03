"use client";

import { DepartmentRecord, RoleRecord } from "../_types";
import { SearchPanelShell } from "../../../_shared/ui/SearchPanelShell";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface SearchPanelProps {
  searchEmpNum: string;
  setSearchEmpNum: (v: string) => void;
  searchName: string;
  setSearchName: (v: string) => void;
  searchNameMode: "partial" | "exact";
  setSearchNameMode: (v: "partial" | "exact") => void;
  searchEmail: string;
  setSearchEmail: (v: string) => void;
  searchEmailMode: "partial" | "exact";
  setSearchEmailMode: (v: "partial" | "exact") => void;
  searchDeptId: string;
  setSearchDeptId: (v: string) => void;
  searchRoleId: string;
  setSearchRoleId: (v: string) => void;
  onClearSearch: () => void;
  departments: DepartmentRecord[];
  roles: RoleRecord[];
}

export function SearchPanel({
  searchEmpNum,
  setSearchEmpNum,
  searchName,
  setSearchName,
  searchNameMode,
  setSearchNameMode,
  searchEmail,
  setSearchEmail,
  searchEmailMode,
  setSearchEmailMode,
  searchDeptId,
  setSearchDeptId,
  searchRoleId,
  setSearchRoleId,
  onClearSearch,
  departments,
  roles,
}: SearchPanelProps) {
  const inputClass = formFieldInputClass;

  return (
    <SearchPanelShell onClearSearch={onClearSearch}>
        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            従業員番号
          </label>
          <input
            type="text"
            className={inputClass}
            placeholder="例: EMP202600"
            value={searchEmpNum}
            onChange={(e) => setSearchEmpNum(e.target.value)}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-bold text-slate-500">氏名</label>
            <div className="flex space-x-2 text-[9px] font-bold">
              <label className="cursor-pointer text-slate-600 flex items-center space-x-0.5">
                <input
                  type="radio"
                  checked={searchNameMode === "partial"}
                  onChange={() => setSearchNameMode("partial")}
                  className="w-2.5 h-2.5"
                />
                <span>部分</span>
              </label>
              <label className="cursor-pointer text-slate-600 flex items-center space-x-0.5">
                <input
                  type="radio"
                  checked={searchNameMode === "exact"}
                  onChange={() => setSearchNameMode("exact")}
                  className="w-2.5 h-2.5"
                />
                <span>完全</span>
              </label>
            </div>
          </div>
          <input
            type="text"
            className={inputClass}
            placeholder="ユーザー名を入力"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-bold text-slate-500">
              メールアドレス
            </label>
            <div className="flex space-x-2 text-[9px] font-bold">
              <label className="cursor-pointer text-slate-600 flex items-center space-x-0.5">
                <input
                  type="radio"
                  checked={searchEmailMode === "partial"}
                  onChange={() => setSearchEmailMode("partial")}
                  className="w-2.5 h-2.5"
                />
                <span>部分</span>
              </label>
              <label className="cursor-pointer text-slate-600 flex items-center space-x-0.5">
                <input
                  type="radio"
                  checked={searchEmailMode === "exact"}
                  onChange={() => setSearchEmailMode("exact")}
                  className="w-2.5 h-2.5"
                />
                <span>完全</span>
              </label>
            </div>
          </div>
          <input
            type="text"
            className={inputClass}
            placeholder="sample@example.com"
            value={searchEmail}
            onChange={(e) => setSearchEmail(e.target.value)}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            所属組織
          </label>
          <select
            className={`${inputClass} cursor-pointer`}
            value={searchDeptId}
            onChange={(e) => setSearchDeptId(e.target.value)}
          >
            <option value="">すべての組織・部署</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col space-y-1">
          <label className="text-[10px] font-bold text-slate-500">
            保持権限(ロール)
          </label>
          <select
            className={`${inputClass} cursor-pointer`}
            value={searchRoleId}
            onChange={(e) => setSearchRoleId(e.target.value)}
          >
            <option value="">すべての権限ロール</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
    </SearchPanelShell>
  );
}
