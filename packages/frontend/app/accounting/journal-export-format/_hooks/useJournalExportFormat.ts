"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  JournalExportFormat,
  JournalExportColumnKey,
  JournalExportLayout,
  LINE_LAYOUT_COLUMN_KEYS,
  PAIR_LAYOUT_COLUMN_KEYS,
} from "../_types";

export function useJournalExportFormat(enabled: boolean) {
  const [format, setFormat] = useState<JournalExportFormat | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<JournalExportFormat>("/api/journal-export-format");
      setFormat(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "設定の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await load();
    })();
  }, [enabled, load]);

  const moveColumn = (index: number, direction: -1 | 1) => {
    setFormat((prev) => {
      if (!prev) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.columns.length) return prev;
      const columns = [...prev.columns];
      [columns[index], columns[target]] = [columns[target], columns[index]];
      return { ...prev, columns };
    });
  };

  const toggleColumn = (key: JournalExportColumnKey, enabledValue: boolean) => {
    setFormat((prev) =>
      prev
        ? { ...prev, columns: prev.columns.map((c) => (c.key === key ? { ...c, enabled: enabledValue } : c)) }
        : prev,
    );
  };

  const relabelColumn = (key: JournalExportColumnKey, label: string) => {
    setFormat((prev) =>
      prev ? { ...prev, columns: prev.columns.map((c) => (c.key === key ? { ...c, label } : c)) } : prev,
    );
  };

  const setDelimiter = (delimiter: JournalExportFormat["delimiter"]) => {
    setFormat((prev) => (prev ? { ...prev, delimiter } : prev));
  };

  const setDateFormat = (dateFormat: JournalExportFormat["dateFormat"]) => {
    setFormat((prev) => (prev ? { ...prev, dateFormat } : prev));
  };

  // 1行の単位を切り替え、その形式で使う列を出力し、使わない列を出力しないようにまとめて切り替える
  // (切り替えたあとで、列ごとに出力する・しないを変えられる)
  const setLayout = (layout: JournalExportLayout) => {
    const [on, off] =
      layout === "PAIR"
        ? [PAIR_LAYOUT_COLUMN_KEYS, LINE_LAYOUT_COLUMN_KEYS]
        : [LINE_LAYOUT_COLUMN_KEYS, PAIR_LAYOUT_COLUMN_KEYS];
    setFormat((prev) =>
      prev
        ? {
            ...prev,
            layout,
            columns: prev.columns.map((c) =>
              on.includes(c.key) ? { ...c, enabled: true } : off.includes(c.key) ? { ...c, enabled: false } : c,
            ),
          }
        : prev,
    );
  };

  const setIncludeHeaderRow = (includeHeaderRow: boolean) => {
    setFormat((prev) => (prev ? { ...prev, includeHeaderRow } : prev));
  };

  const save = async () => {
    if (!format) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await apiFetch("/api/journal-export-format", { method: "PUT", json: format });
      setMessage("保存しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return {
    format,
    loading,
    saving,
    message,
    error,
    moveColumn,
    toggleColumn,
    relabelColumn,
    setDelimiter,
    setDateFormat,
    setIncludeHeaderRow,
    setLayout,
    save,
    reload: load,
  };
}
