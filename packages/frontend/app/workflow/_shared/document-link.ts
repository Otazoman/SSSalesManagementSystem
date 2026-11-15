// REQ-016: 承認のプレビューから元の伝票(マスタ)を別タブで開くURLを組み立てる。
// 画面のパスは「修正して再申請」と同じ解決(バックエンドの resolveEditPath)を使い、
// 開き方は進捗確認(progress/_lib/document-href.ts)と同じ editId / openId の形にする。
//  - 伝票・マスタ: editId(編集/詳細フォームが開く)
//  - 入荷・出荷の画面: openId + openKind(状態を問わず参照用のカードで開く)
//  - 請求の画面: openId(REQ-017)
//  - 在庫・棚卸の画面: openId(棚卸は openKind=audit。品質区分変更・廃棄・返品は種類が分からないため、画面が順に探す)

const ROW_ONLY_TARGET_TYPES = ["sales_payment_receipts", "sales_cash_receipts", "purchase_payment_disbursements"];

function openKindOf(targetType: string, path: string): string | null {
  if (path === "/inventory/audit") {
    if (targetType === "inventory_audit") return "audit";
    // REQ-011(2): 一時保管は「一時保管」タブを開く(番号は動きの番号のため、タブだけ)
    if (targetType === "inventory_temporary_holdings") return "holding";
    return "";
  }
  // REQ-017: 請求の画面は、進捗確認と同じ openId で詳細のモーダルを開く
  if (path === "/sales/billing") return "";
  const isReceiving = path === "/inventory/receiving";
  const isShipping = path === "/inventory/shipping";
  if (!isReceiving && !isShipping) return null;
  if (targetType === "inventory_instructions") return "instruction";
  if (targetType === "inventory_stock") return isReceiving ? "receipt" : "shipment";
  return null;
}

export function buildApprovalDocumentHref(
  targetType: string,
  path: string | null,
  targetId: string,
): string | null {
  if (!path || !targetId) return null;
  const cleanPath = path.replace(/\/$/, "");
  // REQ-018: 入金・支払の消込は行の番号(画面で開く番号ではない)のため、画面だけを開く
  if (ROW_ONLY_TARGET_TYPES.includes(targetType)) return cleanPath;
  const id = encodeURIComponent(targetId);
  const openKind = openKindOf(targetType, cleanPath);
  if (openKind) return `${cleanPath}?openId=${id}&openKind=${openKind}`;
  if (openKind === "") return `${cleanPath}?openId=${id}`;
  return `${cleanPath}?editId=${id}`;
}
