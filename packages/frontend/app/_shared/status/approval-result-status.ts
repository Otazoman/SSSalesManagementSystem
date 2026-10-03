import { StatusBadgeSpec } from "../ui/StatusBadge";

// 棚卸履歴・検収書・納品書・廃棄履歴・在庫調整履歴・返品履歴で共通の承認結果4状態。
// これまで6ファイルに全く同じ辞書がコピーされていたのを1箇所に集約する
export const APPROVAL_RESULT_STATUS: Record<string, StatusBadgeSpec> = {
  UNAPPROVED: { label: "🟡 承認申請中", tone: "amber" },
  APPROVED: { label: "🟢 承認済み", tone: "emerald" },
  REMANDED: { label: "🔴 差戻し", tone: "red" },
  CANCELED: { label: "🔵 取下げ", tone: "sky" },
};

// 入荷指示書・出荷指示書は上記に加えて実績反映の進捗2状態を持ち、APPROVEDの文言も
// 「発行済み」に変わる(指示書自体はまだ実績が反映されるまでは"確定済み"の性質が強いため)
export const INSTRUCTION_STATUS: Record<string, StatusBadgeSpec> = {
  ...APPROVAL_RESULT_STATUS,
  APPROVED: { label: "🟢 発行済み", tone: "emerald" },
  PARTIALLY_FULFILLED: { label: "🟠 一部実績反映", tone: "orange" },
  FULFILLED: { label: "✅ 実績反映済み", tone: "emerald" },
};

export function getApprovalResultStatus(status: string): StatusBadgeSpec {
  return APPROVAL_RESULT_STATUS[status] ?? { label: status, tone: "slate" };
}

export function getInstructionStatus(status: string): StatusBadgeSpec {
  return INSTRUCTION_STATUS[status] ?? { label: status, tone: "slate" };
}
