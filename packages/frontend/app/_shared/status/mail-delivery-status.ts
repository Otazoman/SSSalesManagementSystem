import { StatusBadgeSpec } from "../ui/StatusBadge";

// メール/Slack配信ログ(mail_delivery_logs)の状態。追加要望J-2-c: MailLogTable.tsxが
// 生の英語ステータス文字列(SUCCESS/FAILED等)をそのまま表示していたのを、他の状態バッジと
// 同じ辞書+StatusBadge方式に統一する
export const MAIL_DELIVERY_STATUS: Record<string, StatusBadgeSpec> = {
  PENDING: { label: "🟡 送信待ち", tone: "amber" },
  PROCESSING: { label: "🔵 送信処理中", tone: "sky" },
  SUCCESS: { label: "🟢 送信成功", tone: "emerald" },
  FAILED: { label: "🔴 送信失敗", tone: "red" },
};

export function getMailDeliveryStatus(status: string): StatusBadgeSpec {
  return MAIL_DELIVERY_STATUS[status] ?? { label: status, tone: "slate" };
}
