import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { WorkflowTasksQueueService } from "./workflow-tasks-queue.service";

// #14-2⑥: 元々2262行あったworkflow-tasks.service.test.tsから、承認タスク管理画面向けの
// 承認待ちタスク一覧(getMyPendingTasks/Page)のテストを分割したもの。ソース側の分割
// (workflow-tasks-queue.service.ts)に対応する。ロジック変更なし。ヘルパー関数は既存の慣習
// (payment-crud.test.ts/payment-csv.test.ts、sales-order-crud/workflow.service.test.ts)に
// ならい、分割後の各ファイルにそのまま複製している(共通ファイル化はしない)。

const db = drizzle(env.DB, { schema });

const now = new Date();

async function seedUser(id: string, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  await db.insert(schema.users).values({
    id,
    employeeNumber: `EMP-${id}`,
    email: `${id}@example.com`,
    name: overrides.name ?? id,
    isActive: overrides.isActive ?? true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

async function seedRole(id: string) {
  await db.insert(schema.roles).values({ id, name: id, createdAt: now });
}

async function seedUserRole(
  userId: string,
  roleId: string,
  departmentSurrogateId: string | null = null,
) {
  await db
    .insert(schema.userRoles)
    .values({ userId, roleId, departmentSurrogateId });
}

async function seedDepartment(surrogateId: string, id: string, name: string) {
  await db.insert(schema.departments).values({
    surrogateId,
    id,
    name,
    validFrom: now,
    createdBy: "system",
    createdAt: now,
    updatedBy: "system",
    updatedAt: now,
  });
}

async function seedPartner(id: string, name: string, createdBy: string) {
  await db.insert(schema.partners).values({
    id,
    name,
    createdBy,
    createdAt: now,
    updatedBy: createdBy,
    updatedAt: now,
  });
}

async function seedApprovalFlow(
  id: string,
  requestType: string,
  steps: Array<{ order: number; roleId: string }>,
) {
  await db.insert(schema.approvalFlows).values({
    id,
    name: id,
    requestType,
    minAmount: 0,
    maxAmount: 999999999,
    isActive: true,
  });
  for (const step of steps) {
    await db.insert(schema.approvalFlowSteps).values({
      id: `${id}-step-${step.order}`,
      flowId: id,
      stepOrder: step.order,
      approverRoleId: step.roleId,
    });
  }
}

beforeEach(async () => {
  // 各テストの前にテーブルを空にする(D1はテストごとに自動ロールバックされないため明示的にクリア)
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.userRoles);
  await db.delete(schema.departments);
  await db.delete(schema.partners);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.delete("config");
});

describe("WorkflowTasksQueueService.getMyPendingTasks", () => {
  it("ログインユーザーが承認者ロールに一致する場合、タスク一覧に含まれる", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1");
    await seedRole("approver_role");
    await seedUserRole("approver-1", "approver_role", null);
    await seedPartner("partner-1", "テスト取引先", "applicant-1");

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "master_partners",
      status: "PENDING",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "approver_role",
      layer: 1,
      status: "PENDING",
    });

    const result = await WorkflowTasksQueueService.getMyPendingTasks(
      db,
      "approver-1",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      logId: "log-1",
      requestId: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      targetName: "テスト取引先",
      layer: 1,
      requestType: "master_partners",
    });
  });

  it("存在しない/非アクティブなユーザーの場合は空配列を返す", async () => {
    const result = await WorkflowTasksQueueService.getMyPendingTasks(
      db,
      "unknown-user",
    );
    expect(result).toEqual([]);
  });

  it("PENDING状態のワークフローログが1件もない場合は空配列を返す", async () => {
    await seedUser("approver-1");
    const result = await WorkflowTasksQueueService.getMyPendingTasks(
      db,
      "approver-1",
    );
    expect(result).toEqual([]);
  });

  it("masterApprovalContextsにgeneralMemoがある場合はそちらのnameを優先してtargetNameに使う", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1");
    await seedRole("approver_role");
    await seedUserRole("approver-1", "approver_role", null);
    await seedPartner("partner-1", "DB上の名前", "applicant-1");

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "master_partners",
      status: "PENDING",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "approver_role",
      layer: 1,
      status: "PENDING",
    });

    await db.insert(schema.masterApprovalContexts).values({
      id: "ctx-1",
      requestId: "req-1",
      generalMemo: JSON.stringify({ name: "申請中のスナップショット名" }),
      createdBy: "applicant-1",
      createdAt: now,
      updatedBy: "applicant-1",
      updatedAt: now,
    });

    const result = await WorkflowTasksQueueService.getMyPendingTasks(
      db,
      "approver-1",
    );

    expect(result).toHaveLength(1);
    expect(result[0].targetName).toBe("申請中のスナップショット名");
  });

  it("getHistory()と同じflowProgress(承認フロー進捗)を含める(承認タスク画面でも進捗表示できるようにするための共通化)", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1", { name: "承認者太郎" });
    await seedUser("approver-2", { name: "承認者次郎" });
    await seedRole("role1");
    await seedRole("role2");
    await seedUserRole("approver-1", "role1", null);
    await seedUserRole("approver-2", "role2", null);
    await seedPartner("partner-1", "テスト取引先", "applicant-1");
    await seedApprovalFlow("flow-1", "master_partners", [
      { order: 1, roleId: "role1" },
      { order: 2, roleId: "role2" },
    ]);

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });

    // 1段目: 承認済み
    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "role1",
      layer: 1,
      status: "APPROVED",
      approverId: "approver-1",
      performedAt: now,
    });
    // 2段目: 未着手(PENDING、approver-2が承認対象)
    await db.insert(schema.workflowLogs).values({
      id: "log-2",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "role2",
      layer: 2,
      status: "PENDING",
    });

    const result = await WorkflowTasksQueueService.getMyPendingTasks(
      db,
      "approver-2",
    );

    expect(result).toHaveLength(1);
    expect(result[0].flowProgress).toHaveLength(2);
    const step1 = result[0].flowProgress.find((s) => s.stepOrder === 1)!;
    expect(step1.status).toBe("APPROVED");
    expect(step1.performedBy).toBe("承認者太郎");
    const step2 = result[0].flowProgress.find((s) => s.stepOrder === 2)!;
    expect(step2.status).toBe("PENDING");
    expect(step2.performedBy).toBe("承認者次郎");
    expect(result[0].applicantDepartmentId).toBeNull();
  });

  it("不具合修正の回帰テスト: 部署付きロール+無関係な部署未指定ロールを併せ持つユーザーは、他部署宛のステップまで承認可能になってはいけない", async () => {
    // 再現条件: 商品構成マスタの3段階フロー(起案→自部署課長→特定部署の課長)を模して、
    // 「所属部署Aのmanager」ロールに加え、部署を問わない「finance_checker」ロールも
    // 正しく(部署未指定で)持つユーザーが、部署Bだけに向けたmanagerステップを
    // 誤って承認できてしまっていた実際の不具合を再現する。
    await seedUser("applicant-1");
    await seedUser("dept-a-manager", { name: "部署Aの課長" });
    await seedDepartment("dept-a", "D-A", "部署A");
    await seedDepartment("dept-b", "D-B", "部署B");
    await seedRole("manager");
    await seedRole("finance_checker");
    // 部署Aのmanagerとして正しく部署付きで保持 + 無関係なfinance_checkerを会社全体ロールとして正しく部署未指定で保持
    await seedUserRole("dept-a-manager", "manager", "dept-a");
    await seedUserRole("dept-a-manager", "finance_checker", null);

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_structures",
      targetId: "bom-1",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.approvalFlows).values({
      id: "flow-bom",
      name: "BOM承認",
      requestType: "master_structures",
      minAmount: 0,
      maxAmount: 0,
      isActive: true,
    });
    await db.insert(schema.approvalFlowSteps).values({
      id: "flow-bom-step-1",
      flowId: "flow-bom",
      stepOrder: 1,
      approverRoleId: "manager",
      targetDepartmentSurrogateId: "dept-b",
    });

    // 部署Bのmanager宛のPENDINGログ(第2ステップ相当)
    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_structures",
      targetId: "bom-1",
      approverRoleId: "manager",
      layer: 1,
      status: "PENDING",
    });

    const result = await WorkflowTasksQueueService.getMyPendingTasks(
      db,
      "dept-a-manager",
    );

    expect(result).toEqual([]);
  });

  it("真のシステム管理者(admin)は、部署・ロールを問わず承認タスクが見える", async () => {
    await seedUser("applicant-1");
    await seedUser("sys-admin-1", { name: "システム管理者" });
    await seedDepartment("dept-b", "D-B", "部署B");
    await seedRole("admin");
    await seedRole("manager");
    await seedUserRole("sys-admin-1", "admin", null);

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_structures",
      targetId: "bom-1",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.approvalFlows).values({
      id: "flow-bom",
      name: "BOM承認",
      requestType: "master_structures",
      minAmount: 0,
      maxAmount: 0,
      isActive: true,
    });
    await db.insert(schema.approvalFlowSteps).values({
      id: "flow-bom-step-1",
      flowId: "flow-bom",
      stepOrder: 1,
      approverRoleId: "manager",
      targetDepartmentSurrogateId: "dept-b",
    });
    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_structures",
      targetId: "bom-1",
      approverRoleId: "manager",
      layer: 1,
      status: "PENDING",
    });

    const result = await WorkflowTasksQueueService.getMyPendingTasks(
      db,
      "sys-admin-1",
    );

    expect(result).toHaveLength(1);
    expect(result[0].logId).toBe("log-1");
  });
});

// PERF-03: D1 に送った文(prepare)の数を数える drizzle を作る
function countingDb() {
  const counter = { prepares: 0 };
  const d1 = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") {
        return (query: string) => {
          counter.prepares += 1;
          return target.prepare(query);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { countedDb: drizzle(d1, { schema }), counter };
}

describe("承認待ち一覧の問い合わせ回数(PERF-03)", () => {
  beforeEach(async () => {
    await db.delete(schema.units);
  });

  // 全社の承認待ち total 件(部署Aの申請者の分が mine 件、残りは部署Bの申請者の分)。
  // 承認フローの段は部署の指定なし(申請者の所属部署の課長が承認者)
  async function seed(total: number, mine: number) {
    await seedDepartment("dept-a", "D-A", "部署A");
    await seedDepartment("dept-b", "D-B", "部署B");
    await seedRole("manager");
    await seedRole("staff");
    await seedUser("mgr-a", { name: "部署Aの課長" });
    await seedUserRole("mgr-a", "manager", "dept-a");
    await seedUser("app-a", { name: "部署Aの申請者" });
    await seedUserRole("app-a", "staff", "dept-a");
    await seedUser("app-b", { name: "部署Bの申請者" });
    await seedUserRole("app-b", "staff", "dept-b");
    await seedApprovalFlow("flow-units", "master_units", [{ order: 1, roleId: "manager" }]);
    for (let i = 0; i < total; i++) {
      const code = `U${String(i).padStart(4, "0")}`;
      const applicantId = i < mine ? "app-a" : "app-b";
      await db.insert(schema.units).values({
        code,
        name: `単位${i}`,
        status: "temporary",
        createdBy: applicantId,
        createdAt: now,
        updatedBy: applicantId,
        updatedAt: now,
      });
      await db.insert(schema.masterApprovalRequests).values({
        id: `req-${code}`,
        targetType: "master_units",
        targetId: code,
        requestType: "REGISTER",
        status: "PENDING",
        applicantId,
        flowId: "flow-units",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.workflowLogs).values({
        id: `log-${code}`,
        targetType: "master_units",
        targetId: code,
        approverRoleId: "manager",
        layer: 1,
        status: "PENDING",
        requestId: `req-${code}`,
      });
    }
  }

  async function clear() {
    for (const table of [
      schema.workflowLogs,
      schema.masterApprovalRequests,
      schema.approvalFlowSteps,
      schema.approvalFlows,
      schema.units,
      schema.userRoles,
      schema.departments,
      schema.roles,
      schema.users,
    ]) {
      await db.delete(table);
    }
  }

  it("全社の承認待ちが 5 件でも 100 件でも、問い合わせ回数は同じで、自分の分だけを返す", async () => {
    await seed(5, 3);
    const small = countingDb();
    const smallTasks = await WorkflowTasksQueueService.getMyPendingTasks(small.countedDb, "mgr-a");
    expect(smallTasks.map((t) => t.targetId)).toEqual(["U0000", "U0001", "U0002"]);

    await clear();
    await seed(100, 3);
    const large = countingDb();
    const largeTasks = await WorkflowTasksQueueService.getMyPendingTasks(large.countedDb, "mgr-a");
    expect(largeTasks.map((t) => t.targetId)).toEqual(["U0000", "U0001", "U0002"]);

    expect(large.counter.prepares).toBe(small.counter.prepares);
  }, 60_000);

  it("ページ版は、自分の分を数えてから1ページ分だけ組み立てる", async () => {
    await seed(20, 3);
    const page = await WorkflowTasksQueueService.getMyPendingTasksPage(db, "mgr-a", { page: 2, limit: 2 });
    expect(page.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(page.data.map((t: any) => t.targetId)).toEqual(["U0002"]);
    const all = await WorkflowTasksQueueService.getMyPendingTasks(db, "mgr-a");
    expect(page.data[0]).toEqual(all[2]);
    expect(page.data[0]).toMatchObject({
      applicantId: "部署Aの申請者 (ID: app-a)",
      applicantDepartmentId: "dept-a",
      targetName: "単位2",
    });
    expect((page.data[0] as any).flowProgress).toEqual([
      expect.objectContaining({ stepOrder: 1, status: "PENDING", performedBy: "部署Aの課長", roleName: "manager" }),
    ]);
  });
});

describe("WorkflowTasksQueueService.getMyPendingTasksPage", () => {
  it("全件計算後にin-memoryでページ分割し、{data,pagination}形式で返す", async () => {
    await seedUser("applicant-1");
    await seedUser("approver-1");
    await seedRole("approver_role");
    await seedUserRole("approver-1", "approver_role", null);
    await seedPartner("partner-1", "取引先1", "applicant-1");
    await seedPartner("partner-2", "取引先2", "applicant-1");

    for (const [reqId, targetId, logId] of [
      ["req-1", "partner-1", "log-1"],
      ["req-2", "partner-2", "log-2"],
    ]) {
      await db.insert(schema.masterApprovalRequests).values({
        id: reqId,
        targetType: "master_partners",
        targetId,
        requestType: "master_partners",
        status: "PENDING",
        applicantId: "applicant-1",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.workflowLogs).values({
        id: logId,
        targetType: "master_partners",
        targetId,
        approverRoleId: "approver_role",
        layer: 1,
        status: "PENDING",
      });
    }

    const result = await WorkflowTasksQueueService.getMyPendingTasksPage(
      db,
      "approver-1",
      { page: 1, limit: 1 },
    );

    expect(result.data).toHaveLength(1);
    expect(result.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });
});
