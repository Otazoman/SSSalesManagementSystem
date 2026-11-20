"use client";

import { useEffect, useState } from "react";
import { subscribeReportPdfIssuing } from "./issue-report-pdf";

// PERF-07 B-5: ブラウザで帳票 PDF を作っている間、画面の下に「PDF を作成しています」を出す(layout.tsx に1つだけ置く)。
// 初回はフォント(約 3.7MB)の読み込みがあるため、数秒かかることがある
export function ReportPdfIssuingNotice() {
  const [issuing, setIssuing] = useState(false);
  useEffect(() => subscribeReportPdfIssuing(setIssuing), []);
  if (!issuing) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-lg"
    >
      ⌛ PDF を作成しています…
    </div>
  );
}
