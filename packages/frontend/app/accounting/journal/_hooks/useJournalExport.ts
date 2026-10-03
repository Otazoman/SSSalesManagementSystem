"use client";

import { useState } from "react";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";

export interface JournalExportFilters {
  sourceType: string;
  eventType: string;
  startDate: string;
  endDate: string;
  onlyOriginal: string;
}

const INITIAL_FILTERS: JournalExportFilters = {
  sourceType: "",
  eventType: "",
  startDate: "",
  endDate: "",
  onlyOriginal: "",
};

// Item11-1: 仕訳データ出力画面のCSV出力セクション。検索条件をそのままクエリパラメータへ変換し、
// バックエンドで条件に一致する全件をCSV化する(journal-edit(K-6)一覧と同じ条件セット)
export function useJournalExport() {
  const [filters, setFilters] = useState<JournalExportFilters>(INITIAL_FILTERS);
  const [error, setError] = useState("");

  const { download, downloading } = useCsvDownload({
    fileNamePrefix: "journal_export",
    onError: setError,
  });

  const handleClear = () => setFilters(INITIAL_FILTERS);

  const handleDownload = async () => {
    setError("");
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
    await download(`/api/journal-export/csv-download?${params.toString()}`);
  };

  return {
    filters,
    setFilters,
    handleClear,
    handleDownload,
    downloading,
    error,
  };
}
