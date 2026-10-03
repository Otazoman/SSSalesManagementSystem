import { eq, and, or, desc, gte, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";

// #14-2⑤: index.tsで直接drizzle()を生成していたのをRepository層へ移す(ロジック変更なし)
export function createWorkflowTasksDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

// Drizzle のスキーマ定義から直接型を抽出
export type UserRole = typeof schema.userRoles.$inferSelect;
export type User = typeof schema.users.$inferSelect;
export type WorkflowLog = typeof schema.workflowLogs.$inferSelect;
export type MasterApprovalRequest =
  typeof schema.masterApprovalRequests.$inferSelect;
export type ApprovalFlow = typeof schema.approvalFlows.$inferSelect;
export type ApprovalFlowStep = typeof schema.approvalFlowSteps.$inferSelect;
export type MasterApprovalContext =
  typeof schema.masterApprovalContexts.$inferSelect;
export type Partner = typeof schema.partners.$inferSelect; // Customer -> Partner に変更

export class WorkflowTasksRepository {
  /** ユーザーのロール一覧を取得 */
  static async getUserRoles(db: any, userId: string): Promise<UserRole[]> {
    return await db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));
  }

  /** 有効なユーザーであるか確認 */
  static async checkActiveUser(db: any, userId: string): Promise<User | null> {
    const res = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), eq(schema.users.isActive, true)))
      .limit(1);
    return res[0] || null;
  }

  /** PENDING状態のログを取得 */
  static async getPendingLogs(db: any): Promise<WorkflowLog[]> {
    return await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.status, "PENDING"));
  }

  /** IDからログを取得 */
  static async getLogById(db: any, logId: string): Promise<WorkflowLog | null> {
    const res = await db
      .select()
      .from(schema.workflowLogs)
      .where(eq(schema.workflowLogs.id, logId))
      .limit(1);
    return res[0] || null;
  }

  /** PENDING状態の親申請リクエストを取得 */
  static async getPendingParentRequest(
    db: any,
    targetId: string,
    targetType: string,
  ): Promise<MasterApprovalRequest | null> {
    const res = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(
        and(
          eq(schema.masterApprovalRequests.targetId, targetId),
          eq(schema.masterApprovalRequests.targetType, targetType),
          eq(schema.masterApprovalRequests.status, "PENDING"),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  /** IDから親申請リクエストを取得 */
  static async getParentRequestById(
    db: any,
    requestId: string,
  ): Promise<MasterApprovalRequest | null> {
    const res = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.id, requestId))
      .limit(1);
    return res[0] || null;
  }

  /**
   * 有効なフロー定義を取得。
   * 同一requestTypeに金額帯の異なる複数のアクティブフローが定義されている場合(見積の
   * 「100万未満」「1000万未満」等)のみ、amountで正しい方に絞り込む。該当requestTypeの
   * アクティブフローが1件だけの場合は、従来通りamountを見ずにそのまま返す(単一フローの
   * マスタ(取引先等)で、金額帯が実際の値と一致しない定義(例: minAmount=0,maxAmount=0の
   * センチネル値)が既に運用されているケースへの互換性を壊さないため)。
   */
  static async getActiveFlow(
    db: any,
    requestType: string,
    amount?: number,
  ): Promise<ApprovalFlow | null> {
    const matches = await db
      .select()
      .from(schema.approvalFlows)
      .where(
        and(
          eq(schema.approvalFlows.requestType, requestType),
          eq(schema.approvalFlows.isActive, true),
        ),
      );

    if (matches.length <= 1) return matches[0] || null;
    if (amount === undefined) return matches[0];

    const amountMatch = matches.find(
      (f: ApprovalFlow) => f.minAmount <= amount && f.maxAmount >= amount,
    );
    return amountMatch || matches[0];
  }

  /**
   * Item9 Phase2: 申請(masterApprovalRequests)に紐付くフロー定義を取得する。
   * request.flowId(startWorkflow()時点でマッチしたフロー)が設定されていればそれを直接使う。
   * これにより、matchField/matchValueで分岐する複数フローが同一requestType・同一金額帯に
   * 存在する場合でも、承認進行中に申請時点と異なるフロー(異なるステップ構成)を誤って
   * 拾ってしまう不具合を避けられる。flowIdが未設定(この修正より前に作成されたPENDING申請)
   * の場合のみ、従来通りgetActiveFlow()によるtargetType+金額での再解決にフォールバックする。
   */
  static async resolveFlowForRequest(
    db: any,
    request: MasterApprovalRequest,
    amount?: number,
  ): Promise<ApprovalFlow | null> {
    if (request.flowId) {
      const res = await db
        .select()
        .from(schema.approvalFlows)
        .where(eq(schema.approvalFlows.id, request.flowId))
        .limit(1);
      if (res[0]) return res[0];
    }
    return await this.getActiveFlow(db, request.targetType, amount);
  }

  /** フローのステップ定義一覧を順序指定で取得 */
  static async getFlowSteps(
    db: any,
    flowId: string,
  ): Promise<ApprovalFlowStep[]> {
    return await db
      .select()
      .from(schema.approvalFlowSteps)
      .where(eq(schema.approvalFlowSteps.flowId, flowId))
      .orderBy(schema.approvalFlowSteps.stepOrder);
  }

  /** 特定ステップ定義を取得 */
  static async getFlowStepByOrder(
    db: any,
    flowId: string,
    stepOrder: number,
  ): Promise<ApprovalFlowStep | null> {
    const res = await db
      .select()
      .from(schema.approvalFlowSteps)
      .where(
        and(
          eq(schema.approvalFlowSteps.flowId, flowId),
          eq(schema.approvalFlowSteps.stepOrder, stepOrder),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  /** ユーザー名を取得 */
  static async getUserName(db: any, userId: string): Promise<string> {
    const res = await db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return res[0]?.name || userId;
  }

  /** ユーザーのメールアドレスを取得(未登録ならnull) */
  static async getUserEmail(db: any, userId: string): Promise<string | null> {
    const res = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return res[0]?.email || null;
  }

  /** 指定したユーザーID群のうち、アクティブなユーザーの空でないメールアドレス一覧を取得 */
  static async getActiveUserEmails(
    db: any,
    userIds: string[],
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const users = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(and(inArray(schema.users.id, userIds), eq(schema.users.isActive, true)));
    return users
      .map((u: { email: string | null }) => u.email)
      .filter((e: string | null): e is string => Boolean(e && e.trim() !== ""));
  }

  /** 退避コンテキストを取得 */
  static async getApprovalContext(
    db: any,
    requestId: string,
  ): Promise<MasterApprovalContext | null> {
    const res = await db
      .select()
      .from(schema.masterApprovalContexts)
      .where(eq(schema.masterApprovalContexts.requestId, requestId))
      .limit(1);
    return res[0] || null;
  }

  /** 取引先（partners）を取得 */
  static async getPartnerById(db: any, id: string): Promise<Partner | null> {
    const res = await db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.id, id))
      .limit(1);
    return res[0] || null;
  }

  /** ログのステータス更新 */
  static async updateWorkflowLogStatus(
    db: any,
    logId: string,
    status: string,
    approverId: string | null,
    comment: string | null,
    performedAt: Date | null,
  ): Promise<void> {
    await db
      .update(schema.workflowLogs)
      .set({ status, approverId, comment, performedAt })
      .where(eq(schema.workflowLogs.id, logId));
  }

  /** 次のステップ用ワークフローログの挿入 */
  static async insertWorkflowLog(
    db: any,
    values: Omit<WorkflowLog, "createdAt" | "updatedAt"> | any,
  ): Promise<void> {
    await db.insert(schema.workflowLogs).values(values);
  }

  /** 親申請リクエストの更新 */
  static async updateMasterApprovalRequest(
    db: any,
    requestId: string,
    values: Partial<MasterApprovalRequest>,
  ): Promise<void> {
    await db
      .update(schema.masterApprovalRequests)
      .set(values)
      .where(eq(schema.masterApprovalRequests.id, requestId));
  }

  /** 取引先マスタの更新 */
  static async updatePartner(
    db: any,
    partnerId: string,
    values: Partial<Partner>,
  ): Promise<void> {
    await db
      .update(schema.partners)
      .set(values)
      .where(eq(schema.partners.id, partnerId));
  }

  /** 取引先添付ファイルの挿入 */
  static async insertPartnerAttachment(db: any, values: any): Promise<void> {
    await db.insert(schema.partnerAttachments).values(values);
  }

  /** ファームバンキング: 取引先の振込先口座の挿入 */
  static async insertPartnerBankAccount(db: any, values: any): Promise<void> {
    await db.insert(schema.partnerBankAccounts).values(values);
  }

  /** 最新の親申請リクエストを取得 */
  static async getLatestMasterApprovalRequest(
    db: any,
    targetId: string,
    targetType: string = "master_partners",
  ): Promise<MasterApprovalRequest | null> {
    const res = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(
        and(
          eq(schema.masterApprovalRequests.targetId, targetId),
          eq(schema.masterApprovalRequests.targetType, targetType),
        ),
      )
      .orderBy(desc(schema.masterApprovalRequests.createdAt))
      .limit(1);
    return res[0] || null;
  }

  /** 管理者向け: 全ワークフローログを新しい順に取得(ステータス絞り込み任意) */
  static async getWorkflowLogsForAdmin(
    db: any,
    statusFilter?: string | null,
  ): Promise<WorkflowLog[]> {
    return await db
      .select()
      .from(schema.workflowLogs)
      .where(statusFilter ? eq(schema.workflowLogs.status, statusFilter) : undefined)
      .orderBy(desc(schema.workflowLogs.performedAt), desc(schema.workflowLogs.id));
  }

  /** 指定した申請者(applicantId)が起票した申請の対象(targetId/targetType)一覧を取得 */
  static async getRequestTargetsByApplicant(
    db: any,
    applicantId: string,
  ): Promise<Array<{ targetId: string; targetType: string }>> {
    return await db
      .select({
        targetId: schema.masterApprovalRequests.targetId,
        targetType: schema.masterApprovalRequests.targetType,
      })
      .from(schema.masterApprovalRequests)
      .where(eq(schema.masterApprovalRequests.applicantId, applicantId));
  }

  /**
   * 一般ユーザー向け: 自分に関連するワークフローログを取得
   * (自分が処理した / 自分宛でPENDING中 / 自分が起票した申請に紐づくログ、のいずれか)
   */
  static async getMyRelevantWorkflowLogs(
    db: any,
    params: {
      loginUserId: string;
      myRoleIds: string[];
      requestTargets: Array<{ targetId: string; targetType: string }>;
      statusFilter?: string | null;
    },
  ): Promise<WorkflowLog[]> {
    const { loginUserId, myRoleIds, requestTargets, statusFilter } = params;

    const statusCondition =
      statusFilter && statusFilter !== "all"
        ? eq(schema.workflowLogs.status, statusFilter)
        : undefined;

    const resultsById = new Map<string, WorkflowLog>();

    // 承認者としての関連ログ(自分が承認者/自分のロールが承認待ち)は、それ単独で
    // 別クエリとして実行する(束縛パラメータ数は常に小さいため分割不要)
    const approverCondition = or(
      eq(schema.workflowLogs.approverId, loginUserId),
      and(
        eq(schema.workflowLogs.status, "PENDING"),
        myRoleIds.length > 0
          ? inArray(schema.workflowLogs.approverRoleId, myRoleIds)
          : undefined,
      ),
    );
    const approverRows: WorkflowLog[] = await db
      .select()
      .from(schema.workflowLogs)
      .where(
        statusCondition ? and(approverCondition, statusCondition) : approverCondition,
      );
    approverRows.forEach((row) => resultsById.set(row.id, row));

    // 💡 以前はrequestTargets(申請者が起票した申請の対象)1件ごとに
    // and(targetId=x, targetType=y)というOR節を積んでいたため、申請件数が
    // 増えるとOR節が申請数分そのまま膨れ上がり、D1のクエリ複雑度上限に達して
    // 500エラーになっていた(Item5検証で1ユーザーが50件超申請した際に実際に発生)。
    // targetTypeごとにtargetIdをまとめてinArrayへ集約し、OR節の数を
    // 「distinct targetTypeの種類数」に抑える対応を行ったが、対象マスタ・在庫系の
    // targetTypeが増え続けた結果、束縛パラメータの総数自体がD1の上限(1クエリ100個)を
    // 超えて再び500エラーになった(2026-08-25、申請履歴画面で再発)。
    // OR節の数ではなく束縛パラメータの総数を基準に、複数クエリへ分割して実行し、
    // 結果をlog.id(主キー)でマージ・重複排除する(マッチング条件自体は変更しない)。
    const targetIdsByType = new Map<string, Set<string>>();
    requestTargets.forEach((req) => {
      const ids = targetIdsByType.get(req.targetType) ?? new Set<string>();
      ids.add(req.targetId);
      targetIdsByType.set(req.targetType, ids);
    });

    // D1の1クエリあたり束縛パラメータ上限(100)に対して余裕を持たせた安全値
    const MAX_PARAMS_PER_QUERY = 90;

    // targetTypeごとのID集合を、1チャンクあたりのパラメータ数(type分の1 + ID数)が
    // 上限を超えないよう分割する
    const targetChunks: Array<{ targetType: string; targetIds: string[] }> = [];
    targetIdsByType.forEach((idsSet, targetType) => {
      const ids = [...idsSet];
      const maxIdsPerChunk = MAX_PARAMS_PER_QUERY - 1;
      for (let i = 0; i < ids.length; i += maxIdsPerChunk) {
        targetChunks.push({ targetType, targetIds: ids.slice(i, i + maxIdsPerChunk) });
      }
    });

    // チャンクを、クエリ1回あたりの合計パラメータ数が上限に収まる単位でバッチにまとめる
    const batches: Array<Array<{ targetType: string; targetIds: string[] }>> = [];
    let currentBatch: Array<{ targetType: string; targetIds: string[] }> = [];
    let currentBatchParamCount = 0;
    for (const chunk of targetChunks) {
      const chunkParamCount = 1 + chunk.targetIds.length;
      if (
        currentBatch.length > 0 &&
        currentBatchParamCount + chunkParamCount > MAX_PARAMS_PER_QUERY
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchParamCount = 0;
      }
      currentBatch.push(chunk);
      currentBatchParamCount += chunkParamCount;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    for (const batch of batches) {
      const batchCondition = or(
        ...batch.map((chunk) =>
          and(
            eq(schema.workflowLogs.targetType, chunk.targetType),
            inArray(schema.workflowLogs.targetId, chunk.targetIds),
          ),
        ),
      );
      const rows: WorkflowLog[] = await db
        .select()
        .from(schema.workflowLogs)
        .where(statusCondition ? and(batchCondition, statusCondition) : batchCondition);
      rows.forEach((row) => resultsById.set(row.id, row));
    }

    return [...resultsById.values()];
  }

  /** ユーザーの(先頭の)所属部署サロゲートIDを取得 */
  static async getPrimaryDepartmentId(
    db: any,
    userId: string,
  ): Promise<string | null> {
    const res = await db
      .select({ departmentId: schema.userRoles.departmentSurrogateId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId))
      .limit(1);
    return res[0]?.departmentId || null;
  }

  /** 承認フロー進捗表示用: 対象に紐づく進行中/新しいワークフローログをレイヤー順に取得 */
  static async getWorkflowLogsForFlowProgress(
    db: any,
    targetId: string,
    targetType: string,
    sinceDate: Date,
  ): Promise<WorkflowLog[]> {
    return await db
      .select()
      .from(schema.workflowLogs)
      .where(
        and(
          eq(schema.workflowLogs.targetId, targetId),
          eq(schema.workflowLogs.targetType, targetType),
          or(
            eq(schema.workflowLogs.status, "PENDING"),
            gte(schema.workflowLogs.performedAt, sinceDate),
          ),
        ),
      )
      .orderBy(schema.workflowLogs.layer);
  }

  /** 指定したユーザーID群の氏名一覧を取得 */
  static async getUserNamesByIds(
    db: any,
    userIds: string[],
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const users = await db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));
    return users.map((u: { name: string }) => u.name);
  }

  /** ロール名を取得(未登録ならnull) */
  static async getRoleName(db: any, roleId: string): Promise<string | null> {
    const res = await db
      .select({ name: schema.roles.name })
      .from(schema.roles)
      .where(eq(schema.roles.id, roleId))
      .limit(1);
    return res[0]?.name || null;
  }

  /** 対象の進行中(PENDING/REMANDED)の親申請リクエストを最新順で取得 */
  static async getActiveMasterApprovalRequest(
    db: any,
    targetId: string,
    targetType: string,
  ): Promise<MasterApprovalRequest | null> {
    const res = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(
        and(
          eq(schema.masterApprovalRequests.targetId, targetId),
          eq(schema.masterApprovalRequests.targetType, targetType),
          or(
            eq(schema.masterApprovalRequests.status, "PENDING"),
            eq(schema.masterApprovalRequests.status, "REMANDED"),
          ),
        ),
      )
      .orderBy(desc(schema.masterApprovalRequests.createdAt))
      .limit(1);
    return res[0] || null;
  }
}
