import { drizzle } from "drizzle-orm/d1";
import { and, or, gte, isNull, lte, eq, asc, count } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { WorkflowTasksRepository } from "../../workflow/workflow-tasks/workflow-tasks.repository";

// ヘッダクリックソート(追加要望D)の許可カラム
const APPROVAL_FLOWS_SORT_COLUMNS = {
  name: schema.approvalFlows.name,
  requestType: schema.approvalFlows.requestType,
  minAmount: schema.approvalFlows.minAmount,
  maxAmount: schema.approvalFlows.maxAmount,
  isActive: schema.approvalFlows.isActive,
};

export class ApprovalFlowsRepository {
  private db;

  constructor(env: Env) {
    this.db = drizzle(env.DB, { schema });
  }

  // 全承認フロー取得
  async findAllFlows(sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, APPROVAL_FLOWS_SORT_COLUMNS);
    const base = this.db.select().from(schema.approvalFlows);
    return await (orderBy ? base.orderBy(...orderBy) : base);
  }

  async findFlowsPage(params: PaginationParams, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, APPROVAL_FLOWS_SORT_COLUMNS);
    const base = this.db.select().from(schema.approvalFlows);
    const q = orderBy ? base.orderBy(...orderBy) : base;
    return await q.limit(params.limit).offset(toOffset(params));
  }

  async countFlows(): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.approvalFlows);
    return result[0]?.value || 0;
  }

  // 全ステップ（ロール・部署結合）取得
  async findAllStepsWithDetails() {
    return await this.db
      .select({
        id: schema.approvalFlowSteps.id,
        flowId: schema.approvalFlowSteps.flowId,
        stepOrder: schema.approvalFlowSteps.stepOrder,
        approverRoleId: schema.approvalFlowSteps.approverRoleId,
        roleName: schema.roles.name,
        targetDepartmentSurrogateId:
          schema.approvalFlowSteps.targetDepartmentSurrogateId,
        targetDepartmentId: schema.departments.id,
        targetDepartmentName: schema.departments.name,
        stepName: schema.approvalFlowSteps.stepName,
        memo: schema.approvalFlowSteps.memo,
      })
      .from(schema.approvalFlowSteps)
      .innerJoin(
        schema.roles,
        eq(schema.approvalFlowSteps.approverRoleId, schema.roles.id),
      )
      .leftJoin(
        schema.departments,
        eq(
          schema.approvalFlowSteps.targetDepartmentSurrogateId,
          schema.departments.surrogateId,
        ),
      )
      .orderBy(asc(schema.approvalFlowSteps.stepOrder));
  }

  // ID指定でフロー単体取得
  async findFlowById(id: string) {
    const result = await this.db
      .select()
      .from(schema.approvalFlows)
      .where(eq(schema.approvalFlows.id, id))
      .limit(1);
    return result[0] || null;
  }

  // 名前指定でフロー単体取得
  async findFlowByName(name: string) {
    const result = await this.db
      .select()
      .from(schema.approvalFlows)
      .where(eq(schema.approvalFlows.name, name))
      .limit(1);
    return result[0] || null;
  }

  // ID指定でステップ一覧取得
  async findStepsByFlowId(flowId: string) {
    return await this.db
      .select()
      .from(schema.approvalFlowSteps)
      .where(eq(schema.approvalFlowSteps.flowId, flowId))
      .orderBy(asc(schema.approvalFlowSteps.stepOrder));
  }

  // 部署IDにマッチする部署レコード取得（有効期限チェック込み）
  async findMatchedDepartment(deptId: string, now: Date) {
    return await this.db
      .select()
      .from(schema.departments)
      .where(
        and(
          eq(schema.departments.id, deptId),
          or(
            isNull(schema.departments.validTo),
            gte(schema.departments.validTo, now),
          ),
        ),
      )
      .orderBy(schema.departments.validFrom);
  }

  // バッチクエリ実行
  async executeBatch(queries: any[]) {
    if (queries.length === 0) return;
    return await this.db.batch(queries as any);
  }

  // 統合クエリビルダー用ヘルパー
  buildInsertFlowQuery(data: {
    id: string;
    name: string;
    requestType: string;
    minAmount: number;
    maxAmount: number;
    isActive: boolean;
    matchField?: string | null;
    matchValue?: string | null;
  }) {
    return this.db.insert(schema.approvalFlows).values(data);
  }

  buildUpdateFlowQuery(
    id: string,
    data: {
      name?: string;
      requestType?: string;
      minAmount?: number;
      maxAmount?: number;
      isActive?: boolean;
      matchField?: string | null;
      matchValue?: string | null;
    },
  ) {
    return this.db
      .update(schema.approvalFlows)
      .set(data)
      .where(eq(schema.approvalFlows.id, id));
  }

  buildDeleteStepsQuery(flowId: string) {
    return this.db
      .delete(schema.approvalFlowSteps)
      .where(eq(schema.approvalFlowSteps.flowId, flowId));
  }

  buildDeleteFlowQuery(id: string) {
    return this.db
      .delete(schema.approvalFlows)
      .where(eq(schema.approvalFlows.id, id));
  }

  buildInsertStepQuery(data: {
    id: string;
    flowId: string;
    stepOrder: number;
    approverRoleId: string;
    targetDepartmentSurrogateId: string | null;
    stepName: string | null;
    memo: string | null;
  }) {
    return this.db.insert(schema.approvalFlowSteps).values(data);
  }

  // 新規要望: 承認フローの申請経路プレビュー(2026-09-22確定)。
  // WorkflowEngine.startWorkflowと同じ「金額レンジで絞り込み→matchField/matchValueで確定」の
  // 判定に使う候補フロー群を取得する(実際の申請データは作らないread-only用途)。
  async findMatchingFlowsForPreview(requestType: string, amount: number) {
    return await this.db
      .select()
      .from(schema.approvalFlows)
      .where(
        and(
          eq(schema.approvalFlows.requestType, requestType),
          eq(schema.approvalFlows.isActive, true),
          lte(schema.approvalFlows.minAmount, amount),
          gte(schema.approvalFlows.maxAmount, amount),
        ),
      );
  }

  // プレビュー対象ユーザーが保持するロールID一覧(先頭ステップの自動通過判定・部署フォールバック用)
  async findApplicantRoleIds(userId: string): Promise<string[]> {
    const roles = await WorkflowTasksRepository.getUserRoles(this.db, userId);
    return roles.map((r) => r.roleId);
  }

  // WorkflowEngine.resolveApproversと同じロジックで、ステップごとの承認候補者を解決する
  async resolveStepApprovers(
    applicantId: string,
    approverRoleId: string,
    targetDepartmentSurrogateId: string | null,
  ): Promise<string[]> {
    return await WorkflowEngine.resolveApprovers(
      this.db,
      applicantId,
      approverRoleId,
      targetDepartmentSurrogateId,
    );
  }

  async getRoleName(roleId: string): Promise<string | null> {
    return await WorkflowTasksRepository.getRoleName(this.db, roleId);
  }

  async getUserNamesByIds(userIds: string[]): Promise<string[]> {
    return await WorkflowTasksRepository.getUserNamesByIds(this.db, userIds);
  }
}
