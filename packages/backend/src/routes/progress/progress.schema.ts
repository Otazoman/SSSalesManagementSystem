import * as v from "valibot";

// Item12-1: 進捗一覧の検索条件。D1読み取り行数節約のため必ずページングする(1ページ最大50案件)
export const ProgressQuerySchema = v.object({
  page: v.optional(v.string()),
  pageSize: v.optional(v.string()),
  // 起点伝票番号の部分一致
  keyword: v.optional(v.string()),
  // 起点種別での絞り込み(sales_order / quote / purchase_request / purchase_order)
  rootKind: v.optional(v.picklist(["sales_order", "quote", "purchase_request", "purchase_order"])),
  // 取引先名(部分一致)
  partnerName: v.optional(v.string()),
  // 起点伝票の担当者(氏名または社員番号の部分一致。営業担当/購買担当/入力担当者/申請者のいずれか)
  person: v.optional(v.string()),
  // 起点伝票の担当者を社員番号の完全一致で絞る(ダッシュボードの「自分の担当分」用)
  personEmployeeNumber: v.optional(v.string()),
  // 起点伝票の日付範囲(YYYY-MM-DD、JST)。見積日/受注日/購買申請の作成日/発注日
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  // 追加要望M-2-d: 複合条件検索(すべてAND)。件名(起点伝票の件名)・プロジェクト名は部分一致
  title: v.optional(v.string()),
  projectName: v.optional(v.string()),
  // 案件内のどの伝票番号(見積〜支払)にも部分一致
  docNumber: v.optional(v.string()),
  // 件名・取引先名・プロジェクト名・伝票番号を横断して部分一致(OR)する案件キーワード
  q: v.optional(v.string()),
  // 追加要望M-2-e: "true"なら見積から始まる案件(見積が存在する案件)のみ
  fromQuote: v.optional(v.string()),
  // 追加要望M-2-a/b: 案件の状態。既定はin_progress(進行中のみ)。completed / all(完了も含む)
  state: v.optional(v.picklist(["in_progress", "completed", "all"])),
  // in_progress/completedの走査開始位置(起点一覧の先頭からの件数。前回応答のnextOffset)
  offset: v.optional(v.string()),
});

export type ProgressQuery = v.InferOutput<typeof ProgressQuerySchema>;

// 工程キー。表示順=見積→受注→購買申請→発注→入荷→入庫→仕入→出荷→出庫→売上→請求→支払
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

// 工程の表示名(担当設定のCSV出力など。画面側の`PROGRESS_STAGE_LABELS`と同じ名称)
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

export type ProgressRootKind = "sales_order" | "quote" | "purchase_request" | "purchase_order";

// Item12-3: 承認ワークフローの進捗(承認機能が有効で承認申請が存在する伝票のみ)
export interface ProgressApproval {
  requestStatus: string; // PENDING / APPROVED / REJECTED 等(master_approval_requests.status)
  approvedLayers: number;
  totalLayers: number;
  pendingRoleName: string | null; // 現在の承認待ちステップの承認ロール名
}

export interface ProgressStageDoc {
  id: string;
  status: string;
  assigneeName: string | null;
  approval: ProgressApproval | null;
  // 追加要望M-2-a: この伝票自体の完了判定(伝票の画面での手動設定があればそれ、無ければ自動判定)
  completed: boolean;
  // 伝票の画面で「完了/進行中」が手動設定されている(進捗確認は表示のみ)
  manual: boolean;
}

// 追加要望M-2-a: 工程セルの状態。NONE=伝票なし、COMPLETED=完了、IN_PROGRESS=進行中。
// manual=true は手動上書き(完了にする/進行中に戻す)による状態
export type ProgressStageState = "NONE" | "COMPLETED" | "IN_PROGRESS";
export interface ProgressStageStatus {
  state: ProgressStageState;
  manual: boolean;
}

// Item12-4: 次の処理(次工程)と、その担当。担当は 個別割当(case) > 工程の既定担当(stage) の順で解決する
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
  // 起点伝票の件名・プロジェクト名(検索・CSV用)
  title: string | null;
  projectName: string | null;
  stages: Record<ProgressStageKey, ProgressStageDoc[]>;
  stageStatuses: Record<ProgressStageKey, ProgressStageStatus>;
  // 案件全体の状態(伝票がある全工程が完了なら COMPLETED)
  caseState: "COMPLETED" | "IN_PROGRESS";
  nextSteps: ProgressNextStep[];
  // この案件に設定済みの個別割当(工程キー→社員番号と氏名)。画面での編集用
  assignments: Partial<Record<ProgressStageKey, { employeeNumber: string; name: string }>>;
}

const StageKeySchema = v.picklist(PROGRESS_STAGE_KEYS);

// 工程ごとの既定担当の一括保存(指定の無い工程は未設定になる)
export const StageOwnersPayloadSchema = v.object({
  owners: v.array(
    v.object({
      stageKey: StageKeySchema,
      // DEPT_ROLE: assigneeRef = "部門surrogateId:ロールID"(追加要望M-2-f)
      assigneeType: v.picklist(["USER", "ROLE", "DEPT_ROLE"]),
      assigneeRef: v.pipe(v.string(), v.trim(), v.minLength(1, "担当者/ロールを指定してください")),
    }),
  ),
});
export type StageOwnersPayload = v.InferOutput<typeof StageOwnersPayloadSchema>;

// 案件×工程の個別割当(employeeNumberがnullなら割当解除)
export const CaseAssignmentPayloadSchema = v.object({
  rootKind: v.picklist(["sales_order", "quote", "purchase_request", "purchase_order"]),
  rootId: v.pipe(v.string(), v.minLength(1)),
  stageKey: StageKeySchema,
  employeeNumber: v.nullable(v.pipe(v.string(), v.trim(), v.minLength(1))),
});
export type CaseAssignmentPayload = v.InferOutput<typeof CaseAssignmentPayloadSchema>;

