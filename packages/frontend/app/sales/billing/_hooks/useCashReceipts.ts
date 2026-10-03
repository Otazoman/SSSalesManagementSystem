"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useDebouncedValue } from "../../../_shared/hooks/use-debounced-value";
import { BillingCandidate, CashReceipt, CashReceiptFilters, PartnerLookup } from "../_types/cash-receipts";
import { todayJst } from "../../../_shared/jst-date";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

const INITIAL_FILTERS: CashReceiptFilters = { partnerId: "", status: "all", startDate: "", endDate: "" };

export interface RegisterForm {
  partnerId: string;
  receiptDate: string;
  amount: string;
  method: "BANK_TRANSFER" | "CASH" | "OTHER";
  memo: string;
}

export const emptyRegisterForm = (): RegisterForm => ({
  partnerId: "",
  receiptDate: todayJst(),
  amount: "",
  method: "BANK_TRANSFER",
  memo: "",
});

const buildQuery = (filters: CashReceiptFilters) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === "status" && value === "all")) params.set(key, value);
  }
  return params.toString();
};

// 単体入金(請求を介さない入金)の一覧・登録・請求への紐づけ・削除・CSV出力
export function useCashReceipts(enabled: boolean) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<CashReceipt[]>([]);
  const [partners, setPartners] = useState<PartnerLookup[]>([]);
  const [draft, setDraft] = useState<CashReceiptFilters>(INITIAL_FILTERS);
  // BUG-031: 他の一覧と同じく、条件を入力するとすぐ絞り込む(入力のたびに検索しないよう、少し待つ)
  const applied = useDebouncedValue(draft);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [showRegister, setShowRegister] = useState(false);
  const [registerForm, setRegisterForm] = useState<RegisterForm>(emptyRegisterForm());
  const [saving, setSaving] = useState(false);

  const [linkTarget, setLinkTarget] = useState<CashReceipt | null>(null);
  const [billingCandidates, setBillingCandidates] = useState<BillingCandidate[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildQuery(applied);
      setRows(await apiFetch<CashReceipt[]>(`/api/sales-cash-receipts${query ? `?${query}` : ""}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "入金の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await load();
    })();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      try {
        setPartners(await apiFetch<PartnerLookup[]>("/api/partners?status=all"));
      } catch {
        // 取引先の選択肢が取れなくても一覧自体は表示できる
      }
    })();
  }, [enabled]);

  const { download, downloading } = useCsvDownload({ fileNamePrefix: "cash_receipts", onError: setError });
  const handleDownloadCsv = () => {
    const query = buildQuery(applied);
    return download(`/api/sales-cash-receipts/csv-download${query ? `?${query}` : ""}`);
  };

  const changeDraft = <K extends keyof CashReceiptFilters>(key: K, value: CashReceiptFilters[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  const handleClear = () => setDraft(INITIAL_FILTERS);

  const openRegister = () => {
    setRegisterForm(emptyRegisterForm());
    setShowRegister(true);
  };

  const submitRegister = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const amount = Number(registerForm.amount);
      const res = await apiFetch<{ id: string }>("/api/sales-cash-receipts/register", {
        method: "POST",
        json: {
          partnerId: registerForm.partnerId,
          receiptDate: registerForm.receiptDate,
          amount,
          method: registerForm.method,
          memo: registerForm.memo || null,
        },
        defaultErrorMessage: "入金の登録に失敗しました",
      });
      setMessage(`入金[${res.id}]を登録しました`);
      setShowRegister(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "入金の登録に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  // 紐づけ先の請求の候補(同じ取引先の、まだ全額消込されていない請求)
  const openLink = async (receipt: CashReceipt) => {
    setError("");
    setMessage("");
    setLinkTarget(receipt);
    setBillingCandidates([]);
    try {
      const data = await apiFetch<BillingCandidate[] | { data: BillingCandidate[] }>(
        `/api/sales-billing?partnerId=${encodeURIComponent(receipt.partnerId)}`,
      );
      const list = Array.isArray(data) ? data : data.data || [];
      setBillingCandidates(list.filter((b) => b.reconciliationStatus !== "RECONCILED"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "請求の取得に失敗しました");
    }
  };

  const submitLink = async (billingHeaderId: string) => {
    if (!linkTarget) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch<{ message?: string; reconciliationStatus?: string }>(
        `/api/sales-cash-receipts/${encodeURIComponent(linkTarget.id)}/link`,
        { method: "POST", json: { billingHeaderId }, defaultErrorMessage: "請求への紐づけに失敗しました" },
      );
      setMessage(res.message || "請求へ紐づけて消込しました");
      setLinkTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "請求への紐づけに失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (receipt: CashReceipt) => {
    if (!(await confirm(`入金[${receipt.id}]を削除します。よろしいですか？`))) return;
    setError("");
    setMessage("");
    try {
      await apiFetch(`/api/sales-cash-receipts/${encodeURIComponent(receipt.id)}`, {
        method: "DELETE",
        defaultErrorMessage: "入金の削除に失敗しました",
      });
      setMessage("入金を削除しました");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "入金の削除に失敗しました");
    }
  };

  return {
    rows,
    partners,
    draft,
    changeDraft,
    handleClear,
    loading,
    error,
    message,
    showRegister,
    setShowRegister,
    registerForm,
    setRegisterForm,
    openRegister,
    submitRegister,
    saving,
    linkTarget,
    setLinkTarget,
    billingCandidates,
    openLink,
    submitLink,
    remove,
    handleDownloadCsv,
    downloading,
  };
}
