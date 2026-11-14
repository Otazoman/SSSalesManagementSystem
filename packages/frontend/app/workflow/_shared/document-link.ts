// REQ-016: 承認のプレビューから元の伝票(マスタ)を別タブで開くURLを組み立てる。
// 画面のパスは「修正して再申請」と同じ解決(バックエンドの resolveEditPath)を使い、
// 開き方は進捗確認(progress/_lib/document-href.ts)と同じ editId / openId の形にする。
//  - 伝票・マスタ: editId(編集/詳細フォームが開く)
//  - 入荷・出荷の画面: openId + openKind(状態を問わず参照用のカードで開く)
//  - 在庫・棚卸の画面: openId(棚卸は openKind=audit。品質区分変更・廃棄・返品は種類が分からないため、画面が順に探す)

function openKindOf(targetType: string, path: string): string | null {
  if (path === "/inventory/audit") return targetType === "inventory_audit" ? "audit" : "";
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
  const id = encodeURIComponent(targetId);
  const openKind = openKindOf(targetType, cleanPath);
  if (openKind) return `${cleanPath}?openId=${id}&openKind=${openKind}`;
  if (openKind === "") return `${cleanPath}?openId=${id}`;
  return `${cleanPath}?editId=${id}`;
}
