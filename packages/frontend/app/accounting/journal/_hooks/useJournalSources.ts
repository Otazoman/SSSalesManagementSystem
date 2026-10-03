"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import type { JournalPair } from "../../_components/JournalPairTable";
import {
  AdvanceCandidate,
  JournalSourceCandidate,
  JournalSourceKind,
  JournalSourcePostResult,
} from "../_types";

export const JOURNAL_SOURCE_KIND_OPTIONS: {
  value: JournalSourceKind;
  label: string;
}[] = [
  { value: "purchase_order", label: "前払(発注)" },
  { value: "sales_order", label: "前受(受注)" },
  { value: "cash_receipt", label: "前受(単体入金)" },
  { value: "sales_invoice", label: "売上" },
  { value: "purchase_recognition", label: "仕入" },
  { value: "payment_receipt", label: "入金(入金消込)" },
  { value: "payment_disbursement", label: "支払(支払消込)" },
];

export interface JournalSourceFilters {
  from: string;
  to: string;
  partnerId: string;
}

const EMPTY_FILTERS: JournalSourceFilters = { from: "", to: "", partnerId: "" };

// 選んだ売上へ充当する単体入金ごとの金額(単体入金ID→金額)
export type AdvanceDraft = Record<string, number>;

// 仕訳の確認(作成前のプレビュー)の状態
export interface JournalPreviewState {
  loading: boolean;
  error?: string;
  pairs?: JournalPair[];
}

const toApplications = (draft: AdvanceDraft | undefined) =>
  Object.entries(draft ?? {})
    .filter(([, amount]) => amount > 0)
    .map(([cashReceiptId, amount]) => ({ cashReceiptId, amount }));

/**
 * 伝票を選んで仕訳を作る(V-4)。種別を選んで未転記の伝票を一覧し、複数を選んで1件ずつ仕訳にする
 * (1リクエスト=1件。無料プランのD1のクエリ数に収めるため、フロントが順に呼ぶ)。
 * 売上は、単体入金の前受金を充当できる。
 */
export function useJournalSources(enabled: boolean, onPosted?: () => void) {
  const [kind, setKind] = useState<JournalSourceKind>("sales_invoice");
  const [filters, setFilters] = useState<JournalSourceFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<JournalSourceCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 売上ごとの前受金の充当(伝票ID→単体入金ごとの金額)
  const [advanceDrafts, setAdvanceDrafts] = useState<
    Record<string, AdvanceDraft>
  >({});
  const [advanceCandidates, setAdvanceCandidates] = useState<
    Record<string, AdvanceCandidate[]>
  >({});
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<JournalSourcePostResult[]>([]);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  // 伝票ID→仕訳の確認(開いている行だけ持つ)
  const [previews, setPreviews] = useState<Record<string, JournalPreviewState>>({});

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      try {
        setPartners(
          await apiFetch<{ id: string; name: string }[]>(
            "/api/partners?status=active",
          ),
        );
      } catch {
        setPartners([]);
      }
    })();
  }, [enabled]);

  // BUG-031: 他の一覧と同じく、条件を入力するとすぐ絞り込む(入力のたびに検索しないよう、少し待つ)
  const debouncedFilters = useDebouncedValue(filters);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ kind });
      if (debouncedFilters.from) params.set("startDate", debouncedFilters.from);
      if (debouncedFilters.to) params.set("endDate", debouncedFilters.to);
      if (debouncedFilters.partnerId) params.set("partnerId", debouncedFilters.partnerId);
      const data = await apiFetch<JournalSourceCandidate[]>(
        `/api/journal-sources?${params.toString()}`,
        {
          defaultErrorMessage: "仕訳にしていない伝票の取得に失敗しました",
        },
      );
      setRows(data);
      setSelected(new Set());
      setAdvanceDrafts({});
      setAdvanceCandidates({});
      setPreviews({});
    } catch (err) {
      setRows([]);
      setError(
        err instanceof Error
          ? err.message
          : "仕訳にしていない伝票の取得に失敗しました",
      );
    } finally {
      setLoading(false);
    }
  }, [kind, debouncedFilters]);

  // 種別・条件を変えたら、一覧を読み直す
  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await load();
    })();
  }, [enabled, load]);

  const changeKind = useCallback((next: JournalSourceKind) => {
    setKind(next);
    setResults([]);
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) =>
      setSelected(
        checked ? new Set(rows.map((r) => r.sourceRefId)) : new Set(),
      ),
    [rows],
  );

  // 売上の前受金の充当: 充当できる単体入金を取引先ごとに1回だけ取得する
  const loadAdvanceCandidates = useCallback(
    async (partnerId: string) => {
      if (advanceCandidates[partnerId]) return;
      try {
        const data = await apiFetch<AdvanceCandidate[]>(
          `/api/journal-sources/advance-candidates?partnerId=${encodeURIComponent(partnerId)}`,
          { defaultErrorMessage: "充当できる単体入金の取得に失敗しました" },
        );
        setAdvanceCandidates((prev) => ({ ...prev, [partnerId]: data }));
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "充当できる単体入金の取得に失敗しました",
        );
      }
    },
    [advanceCandidates],
  );

  const setAdvanceAmount = useCallback(
    (sourceRefId: string, cashReceiptId: string, amount: number) => {
      setAdvanceDrafts((prev) => {
        const draft = { ...(prev[sourceRefId] ?? {}) };
        if (amount > 0) draft[cashReceiptId] = amount;
        else delete draft[cashReceiptId];
        return { ...prev, [sourceRefId]: draft };
      });
      // 充当額が変わると仕訳も変わるため、確認中の内容は閉じる(もう一度「仕訳を確認」で取り直す)
      setPreviews((prev) => {
        const next = { ...prev };
        delete next[sourceRefId];
        return next;
      });
    },
    [],
  );

  // 仕訳を作る前に、借方・貸方の組を確認する(保存はしない)。開いている行をもう一度押すと閉じる
  const togglePreview = useCallback(
    async (sourceRefId: string) => {
      if (previews[sourceRefId]) {
        setPreviews((prev) => {
          const next = { ...prev };
          delete next[sourceRefId];
          return next;
        });
        return;
      }
      setPreviews((prev) => ({ ...prev, [sourceRefId]: { loading: true } }));
      const advanceApplications = toApplications(advanceDrafts[sourceRefId]);
      try {
        const data = await apiFetch<{ pairs: JournalPair[] }>("/api/journal-sources/preview", {
          method: "POST",
          json: {
            kind,
            sourceRefId,
            ...(kind === "sales_invoice" && advanceApplications.length > 0 ? { advanceApplications } : {}),
          },
          defaultErrorMessage: "仕訳の内容を確認できませんでした",
        });
        setPreviews((prev) => ({ ...prev, [sourceRefId]: { loading: false, pairs: data.pairs } }));
      } catch (err) {
        setPreviews((prev) => ({
          ...prev,
          [sourceRefId]: {
            loading: false,
            error: err instanceof Error ? err.message : "仕訳の内容を確認できませんでした",
          },
        }));
      }
    },
    [previews, advanceDrafts, kind],
  );

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.sourceRefId)),
    [rows, selected],
  );
  const selectedTotal = useMemo(
    () => selectedRows.reduce((sum, r) => sum + r.amount, 0),
    [selectedRows],
  );

  // 選んだ伝票を1件ずつ仕訳にする。失敗した伝票があっても、残りは続けて処理する
  const createSelected = useCallback(async () => {
    const targets = rows.filter((r) => selected.has(r.sourceRefId));
    if (targets.length === 0) return;
    setPosting(true);
    setError("");
    setResults([]);
    setProgress({ done: 0, total: targets.length });
    const collected: JournalSourcePostResult[] = [];
    for (const target of targets) {
      const advanceApplications = toApplications(advanceDrafts[target.sourceRefId]);
      try {
        const result = await apiFetch<{ success: boolean; message: string }>(
          "/api/journal-sources/post",
          {
            method: "POST",
            json: {
              kind,
              sourceRefId: target.sourceRefId,
              ...(kind === "sales_invoice" && advanceApplications.length > 0
                ? { advanceApplications }
                : {}),
            },
            defaultErrorMessage: "仕訳の作成に失敗しました",
          },
        );
        collected.push({
          sourceRefId: target.sourceRefId,
          ok: result.success,
          message: result.message,
        });
      } catch (err) {
        collected.push({
          sourceRefId: target.sourceRefId,
          ok: false,
          message:
            err instanceof Error ? err.message : "仕訳の作成に失敗しました",
        });
      }
      setProgress({ done: collected.length, total: targets.length });
    }
    setResults(collected);
    setPosting(false);
    await load();
    onPosted?.();
  }, [rows, selected, advanceDrafts, kind, load, onPosted]);

  return {
    kind,
    changeKind,
    filters,
    setFilters,
    clearFilters: () => setFilters(EMPTY_FILTERS),
    partners,
    rows,
    loading,
    error,
    selected,
    toggle,
    toggleAll,
    selectedRows,
    selectedTotal,
    advanceDrafts,
    advanceCandidates,
    loadAdvanceCandidates,
    setAdvanceAmount,
    previews,
    togglePreview,
    posting,
    progress,
    results,
    load,
    createSelected,
  };
}
