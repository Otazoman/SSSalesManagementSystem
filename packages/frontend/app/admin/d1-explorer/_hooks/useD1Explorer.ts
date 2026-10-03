"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

export interface D1DatabaseInfo {
  key: string;
  label: string;
  writable: boolean;
}

export interface D1Table {
  name: string;
  type: string;
}

export interface D1Column {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  masked: boolean;
}

interface RowsResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  primaryKeys: string[];
  writable: boolean;
}

type RowKey = Record<string, string | number>;

// 編集フォームの1項目(文字列で編集し、保存時にbackendが列型に応じて変換する)
export interface EditField {
  column: D1Column;
  original: unknown;
  value: string;
  isNull: boolean;
}

const PAGE_SIZE = 20;

// Item13-b: D1参照・編集。DB→テーブル→列定義+行(ページング)の順に辿る。
// 件数は全行スキャンで読み取り行数を消費するため、自動では取得せず明示ボタンで取得する。
// 編集・削除は主キーで1行を特定して行う(書込可否はbackendがrowsの応答で返す)
export function useD1Explorer(enabled: boolean) {
  const [databases, setDatabases] = useState<D1DatabaseInfo[]>([]);
  const [dbKey, setDbKey] = useState("");
  const [tables, setTables] = useState<D1Table[]>([]);
  const [table, setTable] = useState("");
  const [columns, setColumns] = useState<D1Column[]>([]);
  const [rows, setRows] = useState<RowsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [editKey, setEditKey] = useState<RowKey | null>(null);
  const [editFields, setEditFields] = useState<EditField[]>([]);
  const [deleteKey, setDeleteKey] = useState<RowKey | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const query = (extra: Record<string, string>) => new URLSearchParams(extra).toString();
  const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      try {
        const list = await apiFetch<D1DatabaseInfo[]>("/api/d1-explorer/databases");
        setDatabases(list);
        if (list.length > 0) setDbKey(list[0].key);
      } catch (err) {
        setError(errorText(err, "DB一覧の取得に失敗しました"));
      }
    })();
  }, [enabled]);

  useEffect(() => {
    if (!dbKey) return;
    void (async () => {
      setError("");
      setMessage("");
      setTable("");
      setColumns([]);
      setRows(null);
      setTotal(null);
      setEditKey(null);
      setDeleteKey(null);
      try {
        setTables(await apiFetch<D1Table[]>(`/api/d1-explorer/tables?${query({ db: dbKey })}`));
      } catch (err) {
        setError(errorText(err, "テーブル一覧の取得に失敗しました"));
      }
    })();
  }, [dbKey]);

  const loadRows = useCallback(
    async (targetTable: string, targetPage: number) => {
      setLoading(true);
      setError("");
      try {
        const params = query({
          db: dbKey,
          table: targetTable,
          page: String(targetPage),
          pageSize: String(PAGE_SIZE),
        });
        setRows(await apiFetch<RowsResponse>(`/api/d1-explorer/rows?${params}`));
        setPage(targetPage);
      } catch (err) {
        setError(errorText(err, "行の取得に失敗しました"));
      } finally {
        setLoading(false);
      }
    },
    [dbKey],
  );

  const selectTable = async (name: string) => {
    setTable(name);
    setTotal(null);
    setColumns([]);
    setEditKey(null);
    setDeleteKey(null);
    setMessage("");
    try {
      setColumns(await apiFetch<D1Column[]>(`/api/d1-explorer/schema?${query({ db: dbKey, table: name })}`));
    } catch (err) {
      setError(errorText(err, "列定義の取得に失敗しました"));
    }
    await loadRows(name, 1);
  };

  const fetchCount = async () => {
    try {
      const res = await apiFetch<{ total: number }>(`/api/d1-explorer/count?${query({ db: dbKey, table })}`);
      setTotal(res.total);
    } catch (err) {
      setError(errorText(err, "件数の取得に失敗しました"));
    }
  };

  const keyOf = (row: Record<string, unknown>): RowKey => {
    const key: RowKey = {};
    for (const pk of rows?.primaryKeys ?? []) key[pk] = row[pk] as string | number;
    return key;
  };

  // ---- 編集 ----
  const startEdit = async (row: Record<string, unknown>) => {
    setError("");
    setMessage("");
    setDeleteKey(null);
    const key = keyOf(row);
    try {
      const res = await apiFetch<{ row: Record<string, unknown>; columns: D1Column[] }>(
        `/api/d1-explorer/row?${query({ db: dbKey, table, key: JSON.stringify(key) })}`,
      );
      setEditFields(
        res.columns
          .filter((col) => !col.primaryKey && !col.masked)
          .map((col) => {
            const original = res.row[col.name];
            return {
              column: col,
              original,
              value: original === null || original === undefined ? "" : String(original),
              isNull: original === null || original === undefined,
            };
          }),
      );
      setEditKey(key);
    } catch (err) {
      setError(errorText(err, "編集対象の取得に失敗しました"));
    }
  };

  const changeEditField = (name: string, patch: Partial<Pick<EditField, "value" | "isNull">>) => {
    setEditFields((prev) => prev.map((f) => (f.column.name === name ? { ...f, ...patch } : f)));
  };

  const cancelEdit = () => setEditKey(null);

  const saveEdit = async () => {
    if (!editKey) return;
    const values: Record<string, string | null> = {};
    for (const f of editFields) {
      const originalIsNull = f.original === null || f.original === undefined;
      const originalText = originalIsNull ? "" : String(f.original);
      if (f.isNull) {
        if (!originalIsNull) values[f.column.name] = null;
      } else if (originalIsNull || f.value !== originalText) {
        values[f.column.name] = f.value;
      }
    }
    if (Object.keys(values).length === 0) {
      setError("変更された項目がありません");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/d1-explorer/rows/update", {
        method: "POST",
        json: { db: dbKey, table, key: editKey, values },
        defaultErrorMessage: "更新に失敗しました",
      });
      setMessage("1行を更新しました");
      setEditKey(null);
      await loadRows(table, page);
    } catch (err) {
      setError(errorText(err, "更新に失敗しました"));
    } finally {
      setSaving(false);
    }
  };

  // ---- 削除 ----
  const startDelete = (row: Record<string, unknown>) => {
    setError("");
    setMessage("");
    setEditKey(null);
    setDeleteConfirm("");
    setDeleteKey(keyOf(row));
  };

  const cancelDelete = () => setDeleteKey(null);

  const confirmDelete = async () => {
    if (!deleteKey) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/d1-explorer/rows/delete", {
        method: "POST",
        json: { db: dbKey, table, key: deleteKey, confirmTable: deleteConfirm },
        defaultErrorMessage: "削除に失敗しました",
      });
      setMessage("1行を削除しました");
      setDeleteKey(null);
      await loadRows(table, page);
    } catch (err) {
      setError(errorText(err, "削除に失敗しました"));
    } finally {
      setSaving(false);
    }
  };

  return {
    databases,
    dbKey,
    setDbKey,
    tables,
    table,
    columns,
    rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    loading,
    error,
    message,
    selectTable,
    goToPage: (p: number) => loadRows(table, p),
    fetchCount,
    saving,
    editKey,
    editFields,
    startEdit,
    changeEditField,
    cancelEdit,
    saveEdit,
    deleteKey,
    deleteConfirm,
    setDeleteConfirm,
    startDelete,
    cancelDelete,
    confirmDelete,
  };
}
