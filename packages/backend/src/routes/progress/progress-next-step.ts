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

// REQ-013: 「未起票」の工程。案件が通る流れ(販売・購買。購買は computeNextStages と同じ条件)のうち、起点より後で伝票が無い工程。
// 入荷指示・出荷指示は任意の工程(自社倉庫では発行しないことがある)のため、未起票にしない。
// 見積起点の案件(受注が無い)は受注だけを未起票にする。失注の見積(REQ-015)の案件は未起票を出さない
const OPTIONAL_STAGES: ReadonlySet<ProgressStageKey> = new Set(["shipment_instruction", "receipt_instruction"]);

function unissuedAfter(
  chain: readonly ProgressStageKey[],
  startIndex: number,
  present: (key: ProgressStageKey) => boolean,
): ProgressStageKey[] {
  if (startIndex < 0) return [];
  return chain.slice(startIndex + 1).filter((key) => !present(key) && !OPTIONAL_STAGES.has(key));
}

export function computeUnissuedStages(
  rootKind: ProgressRootKind,
  present: (key: ProgressStageKey) => boolean,
  options: { quoteLost?: boolean } = {},
): NextStage[] {
  const result: NextStage[] = [];
  const salesRooted = rootKind === "sales_order" || rootKind === "quote";
  if (rootKind === "quote") {
    if (!options.quoteLost && !present("sales_order")) result.push({ chain: "sales", stageKey: "sales_order" });
  } else if (rootKind === "sales_order") {
    for (const stageKey of unissuedAfter(SALES_CHAIN, SALES_CHAIN.indexOf("sales_order"), present)) {
      result.push({ chain: "sales", stageKey });
    }
  }
  if (!salesRooted || PURCHASE_CHAIN.some(present)) {
    // 購買起点は起点の工程から、販売起点は購買側で最初に伝票がある工程から後ろを見る
    const start = salesRooted ? PURCHASE_CHAIN.findIndex(present) : PURCHASE_CHAIN.indexOf(rootKind as ProgressStageKey);
    for (const stageKey of unissuedAfter(PURCHASE_CHAIN, start, present)) {
      result.push({ chain: "purchase", stageKey });
    }
  }
  return result;
}
