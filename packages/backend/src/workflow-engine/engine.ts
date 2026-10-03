import { Context } from "hono";
import { and, eq, or, gte, isNull, lte, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import { Env } from "../types/env";
import { resolveEmployeeNumberByUserId } from "../platform/repository/fallback-operator";
import { resolveConfiguredDocumentId } from "../platform/id/resolve-document-id";

interface StartWorkflowParams {
  targetType: string;
  targetId: string;
  applicantId: string;
  requestType: "REGISTER" | "UPDATE" | "SUSPEND" | "DELETE";
  amount?: number;
  comment?: string;
  // Item9 Phase2: 承認フローのmatchField/matchValueによる分岐判定に使う任意のpayload。
  // 未指定、またはflow.matchFieldがnullの場合は従来通りrequestType+金額レンジのみで判定する。
  matchPayload?: Record<string, unknown>;
  // 追加要望F: 申請者が複数部門に所属する場合に選択した申請部門(任意)。
  // 申請者の実際の所属部門(user_roles)のいずれかと一致する場合のみ採用し、
  // masterApprovalRequests.applicantDepartmentSurrogateIdへ保存する。
  applicantDepartmentSurrogateId?: string | null;
  contextData?: {
    antiSocialCheckStatus?: string | null;
    antiSocialCheckMemo?: string | null;
    contractType?: string | null;
    contractValidFrom?: Date | null;
    contractValidTo?: Date | null;
    contractMemo?: string | null;
    drawingNumber?: string | null;
    specificationMemo?: string | null;
    generalMemo?: string | null;
    snapshotJson?: string;
  };
}

export const WorkflowEngine = {
  /**
   * 💡 ワークフローの開始
   */
  async startWorkflow(
    db: any,
    params: StartWorkflowParams,
    c: Context<{ Bindings: Env }>,
  ): Promise<{
    success: boolean;
    message: string;
    requestId?: string;
    approverEmails?: string[];
  }> {
    const now = new Date();
    const checkAmount = params.amount || 0;

    const oldRequests = await db
      .select()
      .from(schema.masterApprovalRequests)
      .where(
        and(
          eq(schema.masterApprovalRequests.targetType, params.targetType),
          eq(schema.masterApprovalRequests.targetId, params.targetId),
          or(
            eq(schema.masterApprovalRequests.status, "PENDING"),
            eq(schema.masterApprovalRequests.status, "REMANDED"),
          ),
        ),
      );

    const amountMatchedFlows = await db
      .select()
      .from(schema.approvalFlows)
      .where(
        and(
          eq(schema.approvalFlows.requestType, params.targetType),
          eq(schema.approvalFlows.isActive, true),
          lte(schema.approvalFlows.minAmount, checkAmount),
          gte(schema.approvalFlows.maxAmount, checkAmount),
        ),
      );

    const flow = this.pickBestMatchingFlow(
      amountMatchedFlows,
      params.matchPayload,
    );
    if (!flow) {
      return {
        success: false,
        message: `条件(申請種別: ${params.targetType}, 金額: ${checkAmount})に合致する有効な承認フローが定義されていません`,
      };
    }

    const steps = await db
      .select()
      .from(schema.approvalFlowSteps)
      .where(eq(schema.approvalFlowSteps.flowId, flow.id))
      .orderBy(schema.approvalFlowSteps.stepOrder);

    if (steps.length === 0) {
      return {
        success: false,
        message: "承認フローに承認ステップが登録されていません",
      };
    }

    const requestId = await resolveConfiguredDocumentId(
      c,
      "approval_request",
      (id) =>
        db
          .select()
          .from(schema.masterApprovalRequests)
          .where(eq(schema.masterApprovalRequests.id, id))
          .then((rows: unknown[]) => rows.length > 0),
      null,
    );

    const applicantRoles = await db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, params.applicantId));

    // 追加要望F: 指定された申請部門が申請者の実際の所属部門のいずれかと一致する場合のみ採用する
    // (改ざん・不整合防御。一致しない/未指定ならnullとして扱い、resolveApprovers()側の
    // 既存フォールバック(user_rolesからの推定)に委ねる)。
    const validatedApplicantDepartmentSurrogateId =
      params.applicantDepartmentSurrogateId &&
      applicantRoles.some(
        (r: any) =>
          r.departmentSurrogateId === params.applicantDepartmentSurrogateId,
      )
        ? params.applicantDepartmentSurrogateId
        : null;

    // Item1: applicantId(users.id、承認ルーティングのFKとして維持)を、
    // 純粋な監査用フィールドであるcreatedBy/updatedByへ書き込む直前にemployeeNumberへ変換する
    const applicantEmployeeNumber = params.contextData
      ? await resolveEmployeeNumberByUserId(db, params.applicantId)
      : null;

    // 申請者が1段目の承認者の役割を持つ場合、その段は自動で通過する。最初に承認者が必要になる段を決める
    let currentStepIndex = 0;
    let nextHandAssigned = false;
    let pendingStepTarget = null;
    const stepLogs: (typeof schema.workflowLogs.$inferInsert)[] = [];

    while (currentStepIndex < steps.length) {
      const currentStep = steps[currentStepIndex];

      const hasRole = applicantRoles.some(
        (r: any) => r.roleId === currentStep.approverRoleId,
      );

      if (hasRole && currentStepIndex === 0) {
        stepLogs.push({
          id: crypto.randomUUID(),
          targetType: params.targetType,
          targetId: params.targetId,
          approverId: params.applicantId,
          approverRoleId: currentStep.approverRoleId,
          layer: currentStep.stepOrder,
          status: "APPROVED",
          comment: "申請に伴う自動通過",
          performedAt: now,
          requestId,
        });
        currentStepIndex++;
      } else {
        stepLogs.push({
          id: crypto.randomUUID(),
          targetType: params.targetType,
          targetId: params.targetId,
          approverId: null,
          approverRoleId: currentStep.approverRoleId,
          layer: currentStep.stepOrder,
          status: "PENDING",
          comment: null,
          performedAt: null,
          requestId,
        });
        nextHandAssigned = true;
        pendingStepTarget = currentStep;
        break;
      }
    }

    // BUG-044: 書き込みは全て1回の batch で行う(D1 は batch だけが、途中で失敗した時にまとめて取り消される)。
    // 以前は1つずつ書き込んでいたため、途中で失敗すると「古い申請だけ取り消され、新しい申請が無い」状態が残りえた。
    // また、承認フローが見つからない場合も先に古い申請を取り消していたが、今は何も書き込まずに失敗を返す。
    const writes: any[] = [];
    if (oldRequests.length > 0) {
      writes.push(
        db
          .update(schema.masterApprovalRequests)
          .set({
            status: "SUPERSEDED",
            comment: `[システム自動クローズ] 新しい再申請が起票されたため終了。`,
            updatedAt: now,
          })
          .where(inArray(schema.masterApprovalRequests.id, oldRequests.map((r: any) => r.id))),
      );
      writes.push(
        db
          .update(schema.workflowLogs)
          .set({
            status: "SUPERSEDED",
            comment: "[自動キャンセル] 再申請により手番が破棄されました。",
            performedAt: now,
          })
          .where(
            and(
              eq(schema.workflowLogs.targetType, params.targetType),
              eq(schema.workflowLogs.targetId, params.targetId),
              eq(schema.workflowLogs.status, "PENDING"),
            ),
          ),
      );
    }

    // 全ての段が自動で通過した場合は、申請をそのまま承認済みにする
    writes.push(
      db.insert(schema.masterApprovalRequests).values({
        id: requestId,
        targetType: params.targetType,
        targetId: params.targetId,
        requestType: params.requestType,
        status: nextHandAssigned ? "PENDING" : "APPROVED",
        flowId: flow.id,
        applicantDepartmentSurrogateId: validatedApplicantDepartmentSurrogateId,
        applicantId: params.applicantId,
        approverId: nextHandAssigned ? null : params.applicantId,
        comment: params.comment || null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    if (params.contextData) {
      const ctx = params.contextData;
      writes.push(
        db.insert(schema.masterApprovalContexts).values({
          id: crypto.randomUUID(),
          requestId: requestId,
          antiSocialCheckStatus: ctx.antiSocialCheckStatus || null,
          antiSocialCheckMemo: ctx.antiSocialCheckMemo || null,
          contractType: ctx.contractType || null,
          contractValidFrom: ctx.contractValidFrom || null,
          contractValidTo: ctx.contractValidTo || null,
          contractMemo: ctx.contractMemo || null,
          drawingNumber: ctx.drawingNumber || null,
          specificationMemo: ctx.specificationMemo || null,
          generalMemo: ctx.generalMemo || null,
          createdAt: now,
          createdBy: applicantEmployeeNumber,
          updatedAt: now,
          updatedBy: applicantEmployeeNumber,
        }),
      );
    }

    for (const log of stepLogs) {
      writes.push(db.insert(schema.workflowLogs).values(log));
    }

    await db.batch(writes);

    let approverEmails: string[] = [];

    if (nextHandAssigned && pendingStepTarget) {
      const approverUserIds = await this.resolveApprovers(
        db,
        params.applicantId,
        pendingStepTarget.approverRoleId,
        pendingStepTarget.targetDepartmentSurrogateId ||
          validatedApplicantDepartmentSurrogateId ||
          null,
      );

      if (approverUserIds.length > 0) {
        const users = await db
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(
            and(
              inArray(schema.users.id, approverUserIds),
              eq(schema.users.isActive, true),
            ),
          );

        approverEmails = users
          .map((u: any) => u.email)
          .filter((email: string | null) => email && email.trim() !== "");
      }
    }

    return {
      success: true,
      message: "承認申請が完了しました",
      requestId,
      approverEmails,
    };
  },

  /**
   * Item9 Phase2: 金額レンジで絞り込み済みの候補フロー群から、matchField/matchValueによる
   * 汎用マッチ機構を適用して最終的に採用する1件を選ぶ。
   * - matchFieldが設定されたフローは、matchPayload[matchField] === matchValue の場合のみ候補に残す
   * - matchFieldが未設定のフローは常に候補として残す(汎用フロー)
   * - 残った候補は「matchField設定あり(具体的な条件)」を「matchField未設定(汎用)」より優先する。
   *   同じ具体度の候補が複数残った場合のタイブレークは行わず、DB取得順(先勝ち)のまま採用する
   *   (既存の「金額レンジの重複は管理画面側の運用でカバーする」という暗黙ルールを踏襲)。
   */
  pickBestMatchingFlow(
    candidates: any[],
    matchPayload: Record<string, unknown> | undefined,
  ): any | undefined {
    const eligible = candidates.filter((f) => {
      if (!f.matchField) return true;
      const payloadValue = matchPayload?.[f.matchField];
      return payloadValue !== undefined && String(payloadValue) === String(f.matchValue);
    });

    const specific = eligible.find((f) => !!f.matchField);
    return specific || eligible[0];
  },

  async resolveApprovers(
    db: any,
    applicantId: string,
    targetRoleId: string,
    targetDepartmentSurrogateId: string | null,
  ): Promise<string[]> {
    let deptSurrogateId = targetDepartmentSurrogateId;
    if (!deptSurrogateId) {
      const applicantRoles = await db
        .select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, applicantId))
        .limit(1);

      deptSurrogateId = applicantRoles[0]?.departmentSurrogateId || null;
    }

    const conditions = [
      eq(schema.userRoles.roleId, targetRoleId),
      eq(schema.users.isActive, true),
    ];

    if (deptSurrogateId) {
      conditions.push(
        or(
          eq(schema.userRoles.departmentSurrogateId, deptSurrogateId),
          isNull(schema.userRoles.departmentSurrogateId),
        ) as any,
      );
    }

    const matchingUsers = await db
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .innerJoin(schema.users, eq(schema.userRoles.userId, schema.users.id))
      .where(and(...conditions));

    return matchingUsers.map((u: any) => String(u.userId));
  },

  /**
   * 💡 下書きの伝票を直接削除する時に、その伝票の差し戻された申請(REMANDED)を閉じる(BUG-015)。
   * 差戻しで下書きに戻った伝票を削除すると、申請だけが「差戻し」のまま残り、対象のない申請
   * (「不明な見積」など)として申請者の一覧に表示され続けるため。申請者の取下げと同じ CANCELED にする。
   * 過去の申請ラウンド(再申請で SUPERSEDED になったもの)のログは履歴として書き換えない。
   */
  async closeRemandedRequestsOfDeletedTarget(
    db: any,
    targetType: string,
    targetId: string,
  ): Promise<void> {
    const now = new Date();
    const remandedRequests: { id: string }[] = await db
      .select({ id: schema.masterApprovalRequests.id })
      .from(schema.masterApprovalRequests)
      .where(
        and(
          eq(schema.masterApprovalRequests.targetType, targetType),
          eq(schema.masterApprovalRequests.targetId, targetId),
          eq(schema.masterApprovalRequests.status, "REMANDED"),
        ),
      );
    if (remandedRequests.length === 0) return;

    const requestIds = remandedRequests.map((r) => r.id);
    const comment = "[システム自動クローズ] 対象が削除されたため終了。";
    await db
      .update(schema.masterApprovalRequests)
      .set({ status: "CANCELED", comment, updatedAt: now })
      .where(inArray(schema.masterApprovalRequests.id, requestIds));
    await db
      .update(schema.workflowLogs)
      .set({ status: "CANCELED", comment, performedAt: now })
      .where(
        and(
          inArray(schema.workflowLogs.requestId, requestIds),
          eq(schema.workflowLogs.status, "REMANDED"),
        ),
      );
  },
};
