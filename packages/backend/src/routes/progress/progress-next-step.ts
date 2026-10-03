import { ProgressRootKind, ProgressStageKey } from "./progress.schema";

// Item12-4: 案件ごとの「次の処理(次工程)」の自動判定。工程は販売系・購買系の2つの流れ(チェーン)に分かれる。
// 入荷指示・出荷指示(外部倉庫向け)は内部倉庫では発行されないことがあるため、途中の工程が飛んでいても
// 「最後に伝票が存在する工程」の次を次工程とする
export const SALES_CHAIN: readonly ProgressStageKey[] = [
  "quote",
  "sales_order",
  "shipment_instruction",
  "item_shipment",
  "sales_invoice",
  "billing",
];
export const PURCHASE_CHAIN: readonly ProgressStageKey[] = [
  "purchase_request",
  "purchase_order",
  "receipt_instruction",
  "item_receipt",
  "purchase_recognition",
  "payment",
];

export interface NextStage {
  chain: "sales" | "purchase";
  stageKey: ProgressStageKey;
}

function nextInChain(
  chain: readonly ProgressStageKey[],
  present: (key: ProgressStageKey) => boolean,
): ProgressStageKey | null {
  let last = -1;
  chain.forEach((key, index) => {
    if (present(key)) last = index;
  });
  if (last < 0 || last >= chain.length - 1) return null; // 伝票なし、または最終工程まで到達済み
  return chain[last + 1];
}

export function computeNextStages(
  rootKind: ProgressRootKind,
  present: (key: ProgressStageKey) => boolean,
): NextStage[] {
  const result: NextStage[] = [];
  const salesRooted = rootKind === "sales_order" || rootKind === "quote";
  if (salesRooted) {
    const next = nextInChain(SALES_CHAIN, present);
    if (next) result.push({ chain: "sales", stageKey: next });
  }
  // 購買系: 購買起点の案件、または販売起点でも購買側の伝票が既にある案件のみ
  if (!salesRooted || PURCHASE_CHAIN.some(present)) {
    const next = nextInChain(PURCHASE_CHAIN, present);
    if (next) result.push({ chain: "purchase", stageKey: next });
  }
  return result;
}
