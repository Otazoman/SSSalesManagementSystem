"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { AccountLookup, JournalEventType, JournalPostingPattern, JournalPostingRuleRecord } from "../_types";

const EVENT_TYPES: JournalEventType[] = [
  "PREPAYMENT",
  "PURCHASE",
  "ADVANCE_RECEIPT",
  "SALES",
  "RECEIPT",
  "DISBURSEMENT",
];

export function useJournalPostingRules(enabled: boolean = true) {
  const [rules, setRules] = useState<Record<JournalEventType, JournalPostingRuleRecord> | null>(null);
  const [accounts, setAccounts] = useState<AccountLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEventType, setSavingEventType] = useState<JournalEventType | null>(null);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Partial<Record<JournalEventType, string>>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ruleList, accountList] = await Promise.all([
        apiFetch<JournalPostingRuleRecord[]>("/api/journal-posting-rules"),
        apiFetch<AccountLookup[]>("/api/accounts?status=active"),
      ]);
      const byEventType = {} as Record<JournalEventType, JournalPostingRuleRecord>;
      for (const rule of ruleList) {
        byEventType[rule.eventType] = rule;
      }
      setRules(byEventType);
      setAccounts(accountList);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "仕訳ルールの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload]);

  // 保存前のローカル編集のみをその場で更新する(サーバーへはsaveRuleで明示的に送信するまで反映しない)
  const updateRule = useCallback(
    (eventType: JournalEventType, patch: Partial<JournalPostingRuleRecord>) => {
      setRules((prev) => {
        if (!prev) return prev;
        return { ...prev, [eventType]: { ...prev[eventType], ...patch } };
      });
    },
    [],
  );

  const saveRule = useCallback(
    async (eventType: JournalEventType) => {
      if (!rules) return;
      const rule = rules[eventType];
      setSavingEventType(eventType);
      setMessage("");
      setErrors((prev) => ({ ...prev, [eventType]: undefined }));
      try {
        const result = await apiFetch<{ message?: string }>(`/api/journal-posting-rules/${eventType}`, {
          method: "PUT",
          json: {
            variableAccountPriority: rule.variableAccountPriority,
            variableAccountFallbackCode: rule.variableAccountFallbackCode,
            prepaidAccountCode: rule.prepaidAccountCode,
            advanceReceivedAccountCode: rule.advanceReceivedAccountCode,
            cashAccountCode: rule.cashAccountCode,
            payableAccountCode: rule.payableAccountCode,
            receivableAccountCode: rule.receivableAccountCode,
            taxAccountCode: rule.taxAccountCode,
            enabled: rule.enabled,
            memo: rule.memo,
            patterns: rule.patterns,
          },
          defaultErrorMessage: "仕訳ルールの更新に失敗しました",
        });
        setMessage(result.message || `仕訳ルール(${eventType})を更新しました`);
        await reload();
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          [eventType]: err instanceof Error ? err.message : "仕訳ルールの更新に失敗しました",
        }));
      } finally {
        setSavingEventType(null);
      }
    },
    [rules, reload],
  );

  // 組(区分×行の種類)の借方・貸方を変更する
  const updatePattern = useCallback(
    (eventType: JournalEventType, index: number, patch: Partial<JournalPostingPattern>) => {
      setRules((prev) => {
        if (!prev) return prev;
        const rule = prev[eventType];
        const patterns = rule.patterns.map((p, i) => (i === index ? { ...p, ...patch } : p));
        return { ...prev, [eventType]: { ...rule, patterns } };
      });
    },
    [],
  );

  return {
    // 取得できた種別だけを画面に出す(旧バックエンドが返さない種別で画面が壊れないようにする)
    eventTypes: EVENT_TYPES.filter((t) => rules?.[t]),
    rules,
    accounts,
    loading,
    savingEventType,
    message,
    errors,
    updateRule,
    updatePattern,
    saveRule,
  };
}
