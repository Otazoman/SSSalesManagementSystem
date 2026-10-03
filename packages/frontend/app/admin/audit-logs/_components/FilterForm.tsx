"use client";

import { ResourceOption } from "../_types/index";
import { Button } from "../../../_shared/ui/Button";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

interface FilterFormProps {
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  userId: string;
  setUserId: (v: string) => void;
  action: string;
  setAction: (v: string) => void;
  resourceKey: string;
  setResourceKey: (v: string) => void;
  resourceOptions: ResourceOption[];
  loading: boolean;
  onSubmit: (e: React.SyntheticEvent) => void;
  onClear: () => void;
}

export function FilterForm({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  userId,
  setUserId,
  action,
  setAction,
  resourceKey,
  setResourceKey,
  resourceOptions,
  loading,
  onSubmit,
  onClear,
}: FilterFormProps) {
  const inputClass = formFieldInputClass;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between border-b pb-2 border-slate-100">
        <h2 className="text-xs font-bold text-slate-700">
          🔍 操作ログを絞り込み検索
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-slate-600 font-bold hover:text-slate-600 cursor-pointer transition-colors"
        >
          条件をクリア
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              開始日時
            </label>
            <input
              type="datetime-local"
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              終了日時
            </label>
            <input
              type="datetime-local"
              className={inputClass}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              ユーザーID
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="例: EMP2026"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              操作キーワード (Action)
            </label>
            <input
              type="text"
              className={`${inputClass} font-mono`}
              placeholder="例: CREATE, LOGIN"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              対象アプリケーション画面
            </label>
            <select
              className={`${inputClass} cursor-pointer`}
              value={resourceKey}
              onChange={(e) => setResourceKey(e.target.value)}
            >
              {resourceOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={loading}>
            {loading ? "処理中..." : "ログを検索 🔍"}
          </Button>
        </div>
      </form>
    </div>
  );
}
