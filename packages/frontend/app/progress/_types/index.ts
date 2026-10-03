// Item12-1/12-3: 進捗確認画面。backend `routes/progress/progress.schema.ts` のレスポンス形と対応

export const PROGRESS_STAGE_KEYS = [
  "quote",
  "sales_order",
  "purchase_request",
  "purchase_order",
  "receipt_instruction",
  "item_receipt",
  "purchase_recognition",
  "shipment_instruction",
  "item_shipment",
  "sales_invoice",
  "billing",
  "payment",
] as const;

export type ProgressStageKey = (typeof PROGRESS_STAGE_KEYS)[number];

export type ProgressRootKind = "sales_order" | "quote" | "purchase_request" | "purchase_order";

export interface ProgressApproval {
  requestStatus: string;
  approvedLayers: number;
  totalLayers: number;
  pendingRoleName: string | null;
}

export interface ProgressStageDoc {
  id: string;
  status: string;
  assigneeName: string | null;
  approval: ProgressApproval | null;
  // 追加要望M-2-a: この伝票自体の完了判定(自動)
  completed: boolean;
  // 伝票の画面で「完了/進行中」が手動設定されている(進捗確認は表示のみ)
  manual?: boolean;
}

// 工程セルの状態。NONE=伝票なし。manual=true は「完了にする/進行中に戻す」の手動上書き
export type ProgressStageState = "NONE" | "COMPLETED" | "IN_PROGRESS";
export interface ProgressStageStatus {
  state: ProgressStageState;
  manual: boolean;
}

// 次の処理(次工程)と、その担当(個別割当 > 工程の既定担当)
export interface ProgressNextStep {
  chain: "sales" | "purchase";
  stageKey: ProgressStageKey;
  assigneeName: string | null;
  source: "case" | "stage" | null;
}

export interface ProgressRow {
  rootKind: ProgressRootKind;
  rootId: string;
  partnerName: string | null;
  title: string | null;
  projectName: string | null;
  stages: Record<ProgressStageKey, ProgressStageDoc[]>;
  stageStatuses: Record<ProgressStageKey, ProgressStageStatus>;
  caseState: "COMPLETED" | "IN_PROGRESS";
  nextSteps: ProgressNextStep[];
  // この案件に設定済みの個別割当(工程キー→社員番号と氏名)
  assignments: Partial<Record<ProgressStageKey, { employeeNumber: string; name: string }>>;
}

// 案件の流れ(チェーン)ごとの工程。担当割当の対象工程の一覧に使う(backend progress-next-step.tsと同じ)
export const SALES_CHAIN: ProgressStageKey[] = [
  "quote",
  "sales_order",
  "shipment_instruction",
  "item_shipment",
  "sales_invoice",
  "billing",
];
export const PURCHASE_CHAIN: ProgressStageKey[] = [
  "purchase_request",
  "purchase_order",
  "receipt_instruction",
  "item_receipt",
  "purchase_recognition",
  "payment",
];

export interface ProgressResponse {
  items: ProgressRow[];
  // 進行中のみ表示(既定)の場合は総件数を求められないためnull。続きがある場合はnextOffsetが入る
  total: number | null;
  page: number;
  pageSize: number;
  nextOffset: number | null;
}

// 工程名は業務の流れ(見積→受注→購買申請→発注→入荷→入庫→仕入→出荷→出庫→売上→請求→支払)の順
export const PROGRESS_STAGE_LABELS: Record<ProgressStageKey, string> = {
  quote: "見積",
  sales_order: "受注",
  purchase_request: "購買申請",
  purchase_order: "発注",
  receipt_instruction: "入荷",
  item_receipt: "入庫",
  purchase_recognition: "仕入",
  shipment_instruction: "出荷",
  item_shipment: "出庫",
  sales_invoice: "売上",
  billing: "請求",
  payment: "支払",
};

export const ROOT_KIND_LABELS: Record<ProgressRootKind, string> = {
  sales_order: "受注起点",
  quote: "見積のみ",
  purchase_request: "購買申請起点",
  purchase_order: "発注起点",
};
