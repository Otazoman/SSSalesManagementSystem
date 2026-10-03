"use client";

import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { Button } from "../../../_shared/ui/Button";

interface MailLogSearchFormProps {
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  documentId: string;
  setDocumentId: (v: string) => void;
  keyword: string;
  setKeyword: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClear: () => void;
}

export function MailLogSearchForm({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  documentId,
  setDocumentId,
  keyword,
  setKeyword,
  status,
  setStatus,
  loading,
  onSubmit,
  onClear,
}: MailLogSearchFormProps) {
  const inputClass = formFieldInputClass;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between border-b pb-2 border-slate-100">
        <h2 className="text-xs font-bold text-slate-700">
          🔍 メール送信履歴を絞り込み検索
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* 1. 送信開始日時 */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              送信開始日時
            </label>
            <input
              type="datetime-local"
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          {/* 2. 送信終了日時 */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              送信終了日時
            </label>
            <input
              type="datetime-local"
              className={inputClass}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          {/* 3. 伝票番号 (ID) */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              伝票番号 (ID)
            </label>
            <input
              type="text"
              className={`${inputClass} font-mono`}
              placeholder="例: QT-2026-5473-0"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
            />
          </div>

          {/* 4. 横断複合キーワード */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              横断複合キーワード
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="宛先、件名、エラー文など"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>

          {/* 5. 配信ステータス */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              配信ステータス
            </label>
            <select
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">すべて</option>
              <option value="PENDING">送信待ち</option>
              <option value="PROCESSING">送信処理中</option>
              <option value="SUCCESS">成功</option>
              <option value="FAILED">失敗</option>
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
