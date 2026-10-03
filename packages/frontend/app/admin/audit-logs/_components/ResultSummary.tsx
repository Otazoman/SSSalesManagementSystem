"use client";

interface ResultSummaryProps {
  count: number;
}

export function ResultSummary({ count }: ResultSummaryProps) {
  return (
    <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
      <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
        📊 該当ログ件数:{" "}
        <span className="text-sm font-black text-indigo-600 font-mono">
          {count}
        </span>{" "}
        件
      </span>
    </div>
  );
}
