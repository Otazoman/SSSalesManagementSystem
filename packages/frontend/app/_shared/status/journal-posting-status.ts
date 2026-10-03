import { StatusBadgeSpec } from "../ui/StatusBadge";

// 仕訳起票イベント(journal_posting_events)の状態。承認ワークフロー系(approval-result-status.ts)や
// 伝票ライフサイクル系(document-lifecycle-status.ts)とは別の語彙のため独立させる
export const JOURNAL_POSTING_STATUS: Record<string, StatusBadgeSpec> = {
  PENDING: { label: "🟡 未転記", tone: "amber" },
  PROCESSING: { label: "🔵 転記中", tone: "sky" },
  POSTED: { label: "🟢 転記済み", tone: "emerald" },
  FAILED: { label: "🔴 転記失敗", tone: "red" },
};

export function getJournalPostingStatus(status: string): StatusBadgeSpec {
  return JOURNAL_POSTING_STATUS[status] ?? { label: status, tone: "slate" };
}
