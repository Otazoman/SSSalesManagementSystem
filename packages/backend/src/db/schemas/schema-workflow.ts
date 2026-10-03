// ==========================================================================
// schema-workflow.ts: 承認フローエンジンの汎用定義
//
// 責務:
//   - 決裁権限(approvalAuthorities)、承認フロー定義(approvalFlows/approvalFlowSteps)、
//     ワークフローログ(workflowLogs)
//   - 特定の業務(見積・マスタ変更等)に依存しない、汎用的な承認フローの「仕組み」のみを持つ
//
// 他ファイルとの関係:
//   - schema-biz.ts: quotes・masterApprovalRequests等が本ファイルのapprovalFlows等を参照して
//     実際の承認申請を行う
//   - 分担: 「承認フローの仕組み」はここ、「承認フローを使った実際の申請履歴」はschema-biz.ts
// ==========================================================================

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { roles, departments } from "./schema-core"; // 💡 正しいインポート先

// ==========================================
// 1. 動的ワークフロー・決裁権限定義基盤
// ==========================================

export const approvalAuthorities = sqliteTable("approval_authorities", {
  id: text("id").primaryKey(),
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id),
  requestType: text("request_type").notNull(),
  maxAmount: integer("max_amount").notNull(),
  memo: text("memo"),
});

export const approvalFlows = sqliteTable("approval_flows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  requestType: text("request_type").notNull(),
  minAmount: integer("min_amount").notNull().default(0),
  maxAmount: integer("max_amount").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  // Item9: 金額レンジに加え、申請payload内の任意フィールドでも分岐できるようにする汎用マッチ軸。
  // 両方nullなら従来通りrequestType+金額レンジのみで判定(既存の全フローは無変更のまま動作する)。
  // 片方のみ設定されることは想定しない(engine.ts側でmatchField有無を判定に使う)。
  matchField: text("match_field"),
  matchValue: text("match_value"),
});

export const approvalFlowSteps = sqliteTable("approval_flow_steps", {
  id: text("id").primaryKey(),
  flowId: text("flow_id")
    .notNull()
    .references(() => approvalFlows.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  approverRoleId: text("approver_role_id")
    .notNull()
    .references(() => roles.id),
  targetDepartmentSurrogateId: text(
    "target_department_surrogate_id",
  ).references(() => departments.surrogateId),
  stepName: text("step_name"),
  memo: text("memo"),
});

export const workflowLogs = sqliteTable("workflow_logs", {
  id: text("id").primaryKey(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  approverId: text("approver_id"), // Item1: employeeNumberを保存(FK制約は意図的に外している)
  approverRoleId: text("approver_role_id")
    .notNull()
    .references(() => roles.id),
  layer: integer("layer").notNull(),
  status: text("status").notNull(),
  comment: text("comment"),
  performedAt: integer("performed_at", { mode: "timestamp" }),
  // このログがどのmasterApprovalRequests(schema-biz.ts)に属するかを明示するID。
  // schema-biz.tsが本ファイルのapprovalFlowsを参照する依存方向のため、循環importを避けるべく
  // FK制約は張らない(既存のapproverId列と同じ「意図的にFK制約を外す」規約を踏襲)。
  // nullable: このカラム追加(migration)以前に作られた既存ログ行はnullのまま(後方互換)。
  // 同一targetId/targetTypeへ複数回申請(差戻し→再提出)された場合に、各ログ行が
  // どの申請ラウンドに属するかを一意に特定するために追加(このカラムが無いと、履歴画面が
  // 「targetIdに対する最新の申請」を全ログ行に一律で紐付けてしまい、差戻し済みの古いログにも
  // 再提出後の新しい申請情報が表示されてしまう不具合があった)。
  requestId: text("request_id"),
});
