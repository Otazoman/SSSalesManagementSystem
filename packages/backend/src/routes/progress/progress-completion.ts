import { ProgressStageKey, ProgressStageState, ProgressStageStatus } from "./progress.schema";

// 追加要望M-2-a: 進捗確認の「完了/進行中」の判定ルール(ユーザー確認済みの定義)。
// 各伝票の自動判定は、伝票ごとの列(status/billingStatus等)と数量集計から求めてDoc.completedにする。
// ここでは①数量ベースの「追加注残なし」判定、②工程セル・案件全体の状態の集約、を純関数として提供する。

// 「追加注残なし」: 明細が1件以上あり、全明細で計上数量が発注/受注数量以上
export function isFullyFulfilled(
  items: { id: string; quantity: number }[],
  fulfilledById: Map<string, number>,
): boolean {
  return items.length > 0 && items.every((item) => (fulfilledById.get(item.id) ?? 0) >= item.quantity);
}

// 工程セルの状態: 伝票が全て完了なら完了、1件でも未完了なら進行中。各伝票のcompletedは、伝票の画面での手動設定
// (document_completion_overrides)があればそれを、無ければ自動判定を反映済みの値。
// manualは、その工程のいずれかの伝票が手動設定されていることを示す(進捗確認は表示のみで、設定は各伝票の画面)
export function computeStageStatus(docs: { completed: boolean; manual?: boolean }[]): ProgressStageStatus {
  if (docs.length === 0) return { state: "NONE", manual: false };
  return {
    state: docs.every((d) => d.completed) ? "COMPLETED" : "IN_PROGRESS",
    manual: docs.some((d) => d.manual),
  };
}

// 案件全体の状態: 伝票がある全工程が完了(手動上書き含む)なら完了
export function computeCaseState(
  statuses: Record<ProgressStageKey, { state: ProgressStageState }>,
): "COMPLETED" | "IN_PROGRESS" {
  const present = Object.values(statuses).filter((s) => s.state !== "NONE");
  if (present.length === 0) return "IN_PROGRESS";
  return present.every((s) => s.state === "COMPLETED") ? "COMPLETED" : "IN_PROGRESS";
}
