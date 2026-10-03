"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { useCsvDownload } from "../../_shared/hooks/use-csv-download";
import { ProgressResponse, ProgressRootKind, ProgressRow, ProgressStageKey } from "../_types";

const DEFAULT_LIMIT = 30;

export interface ProgressFilters {
  keyword: string;
  rootKind: ProgressRootKind | "";
  partnerName: string;
  // 担当者は社員マスタから選択した社員番号(完全一致)
  personEmployeeNumber: string;
  startDate: string;
  endDate: string;
  // 追加要望M-2: 複合検索(すべてAND)
  title: string;
  projectName: string;
  // 案件内のどの伝票番号(見積〜支払)にも部分一致
  docNumber: string;
  // 件名・取引先名・プロジェクト名・伝票番号を横断して部分一致
  q: string;
  // "true"なら見積から始まる案件のみ
  fromQuote: "" | "true";
}

const EMPTY_FILTERS: ProgressFilters = {
  keyword: "",
  rootKind: "",
  partnerName: "",
  personEmployeeNumber: "",
  startDate: "",
  endDate: "",
  title: "",
  projectName: "",
  docNumber: "",
  q: "",
  fromQuote: "",
};

interface UseProgressOptions {
  // ダッシュボード用: 担当者を社員番号の完全一致で固定する(画面の検索条件とは独立)
  fixedEmployeeNumber?: string;
  defaultLimit?: number;
  // 検索条件の選択肢(取引先・社員)を取得する(進捗確認画面のみtrue)
  withLookups?: boolean;
}

export interface PartnerOption {
  id: string;
  name: string;
}

export interface EmployeeOption {
  employeeNumber: string;
  name: string;
}

// Item12-1: 進捗一覧のデータ取得。D1読み取り行数節約のため常にサーバー側でページングする
// (会社設定の`is_pagination_enabled`には依存させない)
export function useProgress(enabled: boolean, options: UseProgressOptions = {}) {
  const { fixedEmployeeNumber, defaultLimit = DEFAULT_LIMIT, withLookups = false } = options;
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [total, setTotal] = useState<number | null>(0);
  // 進行中のみ表示(既定)では「続きの走査開始位置」。nullなら続きなし
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  // 追加要望M-2-b: 既定は進行中のみ。オンにすると完了した案件も表示(従来のページング)
  const [showCompleted, setShowCompleted] = useState(false);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(defaultLimit);
  // 入力中の値(検索ボタンを押すまで検索には反映しない)と、検索に使用中の値を分ける
  const [draft, setDraft] = useState<ProgressFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<ProgressFilters>(EMPTY_FILTERS);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(applied)) {
      if (value) params.set(key, value);
    }
    if (fixedEmployeeNumber) params.set("personEmployeeNumber", fixedEmployeeNumber);
    params.set("state", showCompleted ? "all" : "in_progress");
    return params;
  }, [applied, fixedEmployeeNumber, showCompleted]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = buildParams();
      params.set("pageSize", String(limit));
      if (showCompleted) params.set("page", String(page));
      const data = await apiFetch<ProgressResponse>(`/api/progress?${params.toString()}`);
      setRows(data.items);
      setTotal(data.total);
      setNextOffset(data.nextOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "進捗の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [page, limit, buildParams, showCompleted]);

  // 進行中のみ表示: 続き(走査の再開位置以降)を読み込んで一覧の末尾に追加する
  const loadMore = async () => {
    if (nextOffset === null) return;
    setLoadingMore(true);
    setError("");
    try {
      const params = buildParams();
      params.set("pageSize", String(limit));
      params.set("offset", String(nextOffset));
      const data = await apiFetch<ProgressResponse>(`/api/progress?${params.toString()}`);
      setRows((prev) => [...prev, ...data.items]);
      setNextOffset(data.nextOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "進捗の取得に失敗しました");
    } finally {
      setLoadingMore(false);
    }
  };

  const { download: downloadCsv, downloading: csvDownloading } = useCsvDownload({
    fileNamePrefix: "progress",
    onError: setError,
  });
  // 追加要望M-2-c: 現在の検索条件(表示中の検索結果)をCSV出力する
  const exportCsv = async () => {
    await downloadCsv(`/api/progress/csv-download?${buildParams().toString()}`);
  };

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await load();
    })();
  }, [enabled, load]);

  // 検索条件の選択肢: 取引先マスタ・社員マスタ(取得できなくても検索自体は継続する)
  useEffect(() => {
    if (!enabled || !withLookups) return;
    void (async () => {
      try {
        const [partnerList, userList] = await Promise.all([
          apiFetch<PartnerOption[]>("/api/partners?status=all"),
          apiFetch<(EmployeeOption & { isActive?: boolean })[]>("/api/users"),
        ]);
        setPartners(partnerList);
        setEmployees(
          userList
            .filter((u) => u.isActive !== false && !!u.employeeNumber)
            .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber)),
        );
      } catch {
        // 選択肢が取れない場合も、取引先名の手入力(部分一致)で検索できる
      }
    })();
  }, [enabled, withLookups]);

  // 案件×工程の担当者の個別割当(employeeNumber=nullで解除)。保存後に一覧を再取得する
  const assign = async (
    rootKind: ProgressRootKind,
    rootId: string,
    stageKey: ProgressStageKey,
    employeeNumber: string | null,
  ) => {
    setError("");
    try {
      await apiFetch("/api/progress/case-assignment", {
        method: "PUT",
        json: { rootKind, rootId, stageKey, employeeNumber },
        defaultErrorMessage: "担当者の設定に失敗しました",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "担当者の設定に失敗しました");
    }
  };

  const changeShowCompleted = (value: boolean) => {
    setShowCompleted(value);
    setPage(1);
  };

  const changeDraft = <K extends keyof ProgressFilters>(key: K, value: ProgressFilters[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSearch = () => {
    setPage(1);
    setApplied({
      ...draft,
      keyword: draft.keyword.trim(),
      partnerName: draft.partnerName.trim(),
      title: draft.title.trim(),
      projectName: draft.projectName.trim(),
      docNumber: draft.docNumber.trim(),
      q: draft.q.trim(),
    });
  };

  const handleClear = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const changeLimit = (value: number) => {
    setLimit(value);
    setPage(1);
  };

  return {
    rows,
    total,
    totalPages: Math.max(1, Math.ceil((total ?? 0) / limit)),
    loading,
    loadingMore,
    hasMore: nextOffset !== null,
    loadMore,
    showCompleted,
    changeShowCompleted,
    exportCsv,
    csvDownloading,
    error,
    page,
    setPage,
    limit,
    changeLimit,
    draft,
    partners,
    employees,
    changeDraft,
    assign,
    handleSearch,
    handleClear,
    reload: load,
  };
}
