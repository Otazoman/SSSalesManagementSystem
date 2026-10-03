import { WorkflowEngine } from "../../../workflow-engine/engine";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../../platform/http/http-error";
import {
  WorkflowTasksRepository,
  type MasterApprovalRequest,
  type UserRole,
  type WorkflowLog,
} from "./workflow-tasks.repository";
import { resolveTargetAmountForFlow } from "./workflow-tasks-shared";

// BUG-013: 承認・差戻し・取下げを、操作する本人が行ってよいかを確かめる。
// 管理者(admin・workflow_admin)は、承認者・申請者でなくても代理で操作できる(2026-09-24 ユーザー決定)。

const WORKFLOW_ADMIN_ROLE_IDS = ["admin", "workflow_admin"];

export function hasWorkflowAdminRole(userRoles: UserRole[]): boolean {
  return userRoles.some((ur) => WORKFLOW_ADMIN_ROLE_IDS.includes(ur.roleId));
}

/**
 * 本人が、その段の承認者か(承認タスク一覧(my-pending)に表示する条件と同じ)。
 * - 管理者ロールを持つ
 * - 承認フローから解決した承認者(ロール+部署)に含まれる
 * - その段のロールを部署の指定なし(会社全体)で持つ
 */
export function isApproverForLog(params: {
  userId: string;
  userRoles: UserRole[];
  approverRoleId: string;
  allowedUserIds: string[];
}): boolean {
  const { userId, userRoles, approverRoleId, allowedUserIds } = params;
  if (hasWorkflowAdminRole(userRoles)) return true;
  if (allowedUserIds.includes(userId)) return true;
  return userRoles.some(
    (ur) =>
      ur.roleId === approverRoleId &&
      (ur.departmentSurrogateId === null || ur.departmentSurrogateId === ""),
  );
}

/** 承認・差戻しの前に: タスクが承認待ちで、本人がその段の承認者(または管理者)であることを確かめる */
export async function assertCanDecideTask(
  db: any,
  userId: string,
  log: WorkflowLog | null,
  reqParent: MasterApprovalRequest | null,
): Promise<void> {
  if (!log || !reqParent) {
    throw new NotFoundError("対象の承認タスクが見つかりません");
  }
  if (log.requestId && log.requestId !== reqParent.id) {
    throw new BadRequestError("承認タスクと申請の組み合わせが正しくありません");
  }
  if (log.status !== "PENDING" || reqParent.status !== "PENDING") {
    throw new BadRequestError("この承認タスクは処理済みです");
  }

  const userRoles = await WorkflowTasksRepository.getUserRoles(db, userId);
  const amount = await resolveTargetAmountForFlow(
    db,
    reqParent.targetType,
    reqParent.targetId,
  );
  const flow = await WorkflowTasksRepository.resolveFlowForRequest(
    db,
    reqParent,
    amount,
  );
  const step = flow
    ? await WorkflowTasksRepository.getFlowStepByOrder(db, flow.id, log.layer)
    : null;
  const allowedUserIds = await WorkflowEngine.resolveApprovers(
    db,
    reqParent.applicantId,
    log.approverRoleId,
    step?.targetDepartmentSurrogateId ||
      reqParent.applicantDepartmentSurrogateId ||
      null,
  );

  if (
    !isApproverForLog({
      userId,
      userRoles,
      approverRoleId: log.approverRoleId,
      allowedUserIds,
    })
  ) {
    throw new ForbiddenError("この申請を承認・差戻しする権限がありません");
  }
}

/** 取下げの前に: 本人が申請者(または管理者)であることを確かめる */
export async function assertCanCancelRequest(
  db: any,
  userId: string,
  reqParent: MasterApprovalRequest,
): Promise<void> {
  if (reqParent.applicantId === userId) return;
  const userRoles = await WorkflowTasksRepository.getUserRoles(db, userId);
  if (!hasWorkflowAdminRole(userRoles)) {
    throw new ForbiddenError("申請者本人のみ取下げできます");
  }
}
