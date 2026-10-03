import React from "react";
import {
  formFieldInputClass,
  formFieldLabelClass,
} from "../../../_shared/ui/FormField";
import { Button } from "../../../_shared/ui/Button";
import { SearchFilters } from "../_types";

interface WorkflowSearchFormProps {
  filters: SearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
  onClear: () => void;
  isAdmin: boolean;
  userMaster: any[];
}

export function WorkflowSearchForm({
  filters,
  setFilters,
  onClear,
  isAdmin,
  userMaster,
}: WorkflowSearchFormProps) {
  const inputClass = formFieldInputClass;

  const handleChange = (field: keyof SearchFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <h2 className="text-xs font-bold text-slate-700 border-b pb-2 border-slate-100">
        🔍 決裁履歴データを絞り込み検索
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>申請者</label>
          {/* ⭕ input から select ボックスへ修正 */}
          <select
            className={`${inputClass} cursor-pointer`}
            value={filters.applicantId}
            onChange={(e) => handleChange("applicantId", e.target.value)}
          >
            <option value="">すべて(全ユーザー対象)</option>
            {userMaster.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.id.substring(0, 8)})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>申請対象(取引先名等)</label>
          <input
            type="text"
            className={inputClass}
            placeholder="名称キーワード"
            value={filters.targetName}
            onChange={(e) => handleChange("targetName", e.target.value)}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>申請種別</label>
          <select
            className={inputClass}
            value={filters.requestType}
            onChange={(e) => handleChange("requestType", e.target.value)}
          >
            <option value="">すべて</option>
            <option value="CREATE">新規登録</option>
            <option value="UPDATE">更新申請</option>
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>処理状況</label>
          <select
            className={inputClass}
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="ACTIVE_TASKS">要対応(処理中＋差戻し)</option>
            <option value="PENDING">処理中のみ</option>
            <option value="REMANDED">差戻しのみ</option>
            <option value="APPROVED">承認済み</option>
            <option value="CANCELED">取下げ済み</option>
            <option value="all">すべて</option>
          </select>
        </div>
        <div className="flex flex-col space-y-1">
          <label className={formFieldLabelClass}>申請日 (FROM)</label>
          <input
            type="date"
            className={inputClass}
            value={filters.startDate}
            onChange={(e) => handleChange("startDate", e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end pt-1">
        <Button variant="secondary" onClick={onClear}>
          🧹 条件を初期化(未処理のみに戻す)
        </Button>
      </div>
    </div>
  );
}
