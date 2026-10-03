"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { JournalBatchDetail, AccountLookup, CorrectLineForm } from "../_types";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";

interface UseJournalBatchActionsProps {
  syncBatches: (filters: Record<string, string>) => Promise<void>;
  setMessage: (msg: string) => void;
  setError: (msg: string) => void;
}

const INITIAL_FILTERS = {
  sourceType: "",
  eventType: "",
  startDate: "",
  endDate: "",
  onlyOriginal: "",
};

// K-6-3: 一覧の検索フィルタ+詳細モーダル(連鎖表示・訂正フォーム)の状態管理
export function useJournalBatchActions({ syncBatches, setMessage, setError }: UseJournalBatchActionsProps) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  const [detail, setDetail] = useState<JournalBatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [accounts, setAccounts] = useState<AccountLookup[]>([]);

  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctDescription, setCorrectDescription] = useState("");
  const [correctMemo, setCorrectMemo] = useState("");
  const [correctLines, setCorrectLines] = useState<CorrectLineForm[]>([]);
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);

  // BUG-031: 入力のたびに検索しないよう、少し待ってから検索する
  const debouncedFilters = useDebouncedValue(filters);
  useEffect(() => {
    void syncBatches(debouncedFilters);
  }, [debouncedFilters, syncBatches]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<AccountLookup[]>("/api/accounts?status=active");
        setAccounts(data);
      } catch (err) {
        console.error("勘定科目マスタの取得に失敗しました", err);
        setAccounts([]);
      }
    })();
  }, []);

  const handleClearSearch = () => setFilters(INITIAL_FILTERS);

  const handleOpenDetail = async (id: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const data = await apiFetch<JournalBatchDetail>(`/api/journal-batches/${id}`, {
        defaultErrorMessage: "仕訳バッチ詳細の取得に失敗しました",
      });
      setDetail(data);
      setIsCorrecting(false);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCloseDetail = () => {
    setDetail(null);
    setIsCorrecting(false);
  };

  // K-6-3: 連鎖の末尾(現在有効なバッチ)に対して訂正フォームを開く。金額・税区分・側は
  // 編集不可のため参照用にそのまま保持し、accountCodeの初期値は現在の値にしておく
  const handleStartCorrecting = () => {
    if (!detail) return;
    const current = detail.chain[detail.chain.length - 1];
    setCorrectDescription(current.description);
    setCorrectMemo(current.memo || "");
    setCorrectLines(
      current.lines.map((line) => ({
        lineId: line.id,
        side: line.side,
        originalAccountCode: line.accountCode,
        originalAccountName: line.accountName,
        amount: line.amount,
        taxCategoryCode: line.taxCategoryCode,
        accountCode: line.accountCode,
      })),
    );
    setIsCorrecting(true);
  };

  const handleCancelCorrecting = () => setIsCorrecting(false);

  const handleCorrectLineAccountChange = (lineId: string, accountCode: string) => {
    setCorrectLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, accountCode } : l)));
  };

  const handleSubmitCorrection = async () => {
    if (!detail) return false;
    const current = detail.chain[detail.chain.length - 1];

    setIsSubmittingCorrection(true);
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ message?: string }>(`/api/journal-batches/${current.id}/correct`, {
        method: "POST",
        json: {
          description: correctDescription || undefined,
          memo: correctMemo || null,
          lines: correctLines.map((l) => ({ lineId: l.lineId, accountCode: l.accountCode })),
        },
        defaultErrorMessage: "仕訳の訂正に失敗しました",
      });
      setMessage(data.message || "反対仕訳・訂正仕訳を起票しました");
      setIsCorrecting(false);
      // detail.idはchain内のどのバッチIDでも同じ連鎖が返るため、そのまま再取得すればよい
      await handleOpenDetail(detail.id);
      // 一覧側も再取得して最新の連鎖状態を反映する
      void syncBatches(filters);
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
    } finally {
      setIsSubmittingCorrection(false);
    }
  };

  return {
    filters,
    setFilters,
    handleClearSearch,
    detail,
    detailLoading,
    handleOpenDetail,
    handleCloseDetail,
    accounts,
    isCorrecting,
    correctDescription,
    setCorrectDescription,
    correctMemo,
    setCorrectMemo,
    correctLines,
    handleStartCorrecting,
    handleCancelCorrecting,
    handleCorrectLineAccountChange,
    isSubmittingCorrection,
    handleSubmitCorrection,
  };
}
