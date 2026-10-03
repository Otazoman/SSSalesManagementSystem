// アプリ全体でステータス表示の色・形を統一するための共通ピル。
// 見積・受注・発注・購買申請でバッジの見た目(英語表記 vs 日本語表記、pill有無)がずれていた問題と、
// 棚卸履歴・検収書・納品書等7画面、マスタ系(取引先/商品/倉庫等)の状態バッジがそれぞれ個別に
// ハードコードされていた問題への対応。表示内容(label/tone)は呼び出し側の
// _shared/status/*.ts の辞書から渡す(このコンポーネント自体は色の対応表のみを持つ)

export type StatusTone = "slate" | "amber" | "orange" | "emerald" | "red" | "sky";

const TONE_CLASS: Record<StatusTone, string> = {
  slate: "bg-slate-100 text-slate-600 border-slate-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  red: "bg-red-50 text-red-700 border-red-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
};

export interface StatusBadgeSpec {
  label: string;
  tone: StatusTone;
}

interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
  className?: string;
}

export function StatusBadge({ label, tone, className = "" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-extrabold whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}
    >
      {label}
    </span>
  );
}
