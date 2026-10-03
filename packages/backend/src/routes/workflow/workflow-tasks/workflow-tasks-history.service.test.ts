import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { WorkflowTasksHistoryService } from "./workflow-tasks-history.service";

// #14-2⑥: 元々2262行あったworkflow-tasks.service.test.tsから、申請履歴・進捗一覧
// (getHistory/getHistoryPage)のテストを分割したもの。ソース側の分割
// (workflow-tasks-history.service.ts)に対応する。ロジック変更なし。ヘルパー関数は既存の慣習
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

describe("WorkflowTasksHistoryService.getHistory", () => {
  it("管理者ロールを持つユーザーはすべてのワークフローログを取得できる", async () => {
    await seedUser("applicant-1");
    await seedUser("admin-1");
    await seedRole("admin");
    await seedUserRole("admin-1", "admin", null);
    await seedRole("approver_role");
    await seedPartner("partner-1", "テスト取引先", "applicant-1");

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "master_partners",
      status: "APPROVED",
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
      status: "APPROVED",
      approverId: "admin-1",
      performedAt: now,
    });

    const { histories, isAdmin } = await WorkflowTasksHistoryService.getHistory(db, {
      userId: "admin-1",
    } as any);

    expect(isAdmin).toBe(true);
    expect(histories).toHaveLength(1);
    expect(histories[0].logId).toBe("log-1");
  });

  it("一般ユーザーは自分が申請した/自分が処理した/自分宛の保留タスクのみ取得できる", async () => {
    await seedUser("applicant-1");
    await seedUser("other-applicant");
    await seedUser("approver-1");
    await seedRole("approver_role");
    await seedUserRole("approver-1", "approver_role", null);
    await seedPartner("partner-1", "自分の申請分", "applicant-1");
    await seedPartner("partner-2", "無関係の申請分", "other-applicant");

    // 自分(applicant-1)が申請したもの
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

    // 無関係な他人が申請し、自分は関与していないもの
    await seedRole("other_role");
    await db.insert(schema.masterApprovalRequests).values({
      id: "req-2",
      targetType: "master_partners",
      targetId: "partner-2",
      requestType: "master_partners",
      status: "PENDING",
      applicantId: "other-applicant",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.workflowLogs).values({
      id: "log-2",
      targetType: "master_partners",
      targetId: "partner-2",
      approverRoleId: "other_role",
      layer: 1,
      status: "PENDING",
    });

    const { histories, isAdmin } = await WorkflowTasksHistoryService.getHistory(db, {
      userId: "applicant-1",
    } as any);

    expect(isAdmin).toBe(false);
    expect(histories.map((h) => h.logId)).toEqual(["log-1"]);
  });

  it("一般ユーザーが多数の申請を起票していてもD1のバインドパラメータ上限に達さずに履歴取得できる", async () => {
    // 回帰テスト: 起票済み申請1件ごとにand(targetId=x, targetType=y)というOR節を積む実装だと、
    // 申請件数が増えるほどOR節がそのまま増え、D1の1クエリあたり最大100バインドパラメータ制限に
    // 達して500エラーになっていた(Item5検証で実際に発生)。targetTypeごとにtargetIdをinArrayへ
    // まとめる修正後は、申請件数が増えてもOR節はdistinct targetTypeの種類数までしか増えない。
    await seedUser("heavy-applicant");
    await seedRole("approver_role");

    const requestCount = 60;
    for (let i = 0; i < requestCount; i++) {
      const targetType = i % 2 === 0 ? "master_partners" : "master_units";
      const targetId = `target-${i}`;
      await db.insert(schema.masterApprovalRequests).values({
        id: `req-heavy-${i}`,
        targetType,
        targetId,
        requestType: targetType,
        status: "PENDING",
        applicantId: "heavy-applicant",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.workflowLogs).values({
        id: `log-heavy-${i}`,
        targetType,
        targetId,
        approverRoleId: "approver_role",
        layer: 1,
        status: "PENDING",
      });
    }

    const { histories, isAdmin } = await WorkflowTasksHistoryService.getHistory(db, {
      userId: "heavy-applicant",
    } as any);

    expect(isAdmin).toBe(false);
    expect(histories).toHaveLength(requestCount);
  });

  it("申請先targetTypeの種類が多い場合でもD1のバインドパラメータ上限(1クエリ100個)に達さずに履歴取得できる", async () => {
    // 回帰テスト: targetTypeごとにtargetIdをinArrayへまとめる修正(直前のテスト)でOR節の数は
    // 抑えられたが、distinct targetTypeの種類数自体が増えると(マスタ8種+在庫系5種など)、
    // 束縛パラメータの総数(type数+id総数)がD1の1クエリ上限100個を超えて再び500エラーになった
    // (2026-08-25、実際の申請履歴画面で発生)。targetTypeを20種類・各3件、
    // 合計60件(type分20+id分60=80パラメータ、旧実装なら+approver条件3で83だが、
    // 実運用ではここに他ユーザー分の承認者条件等も絡み100を超えていた)という、
    // 単一クエリでは収まらない構成(type分30+id分90+承認者条件分3=123パラメータ)を再現し、
    // 複数クエリに分割しても正しく全件マージされることを確認する。
    await seedUser("many-types-applicant");
    await seedRole("approver_role");

    const typeCount = 30;
    const idsPerType = 3;
    let total = 0;
    for (let t = 0; t < typeCount; t++) {
      const targetType = `regression_type_${t}`;
      for (let i = 0; i < idsPerType; i++) {
        const targetId = `target-${t}-${i}`;
        await db.insert(schema.masterApprovalRequests).values({
          id: `req-many-${t}-${i}`,
          targetType,
          targetId,
          requestType: targetType,
          status: "PENDING",
          applicantId: "many-types-applicant",
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(schema.workflowLogs).values({
          id: `log-many-${t}-${i}`,
          targetType,
          targetId,
          approverRoleId: "approver_role",
          layer: 1,
          status: "PENDING",
        });
        total++;
      }
    }

    const { histories, isAdmin } = await WorkflowTasksHistoryService.getHistory(db, {
      userId: "many-types-applicant",
    } as any);

    expect(isAdmin).toBe(false);
    expect(histories).toHaveLength(total);
  });

  it("flowProgressに各ステップの進捗(完了済みは承認者名、未着手は候補承認者名とロール名)を含める", async () => {
    await seedUser("applicant-1");
    await seedUser("admin-1");
    await seedUser("approver-1", { name: "承認者太郎" });
    await seedUser("approver-2", { name: "承認者次郎" });
    await seedRole("admin");
    await seedRole("role1");
    await seedRole("role2");
    await seedUserRole("admin-1", "admin", null);
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
    // 2段目: 未着手(PENDING)
    await db.insert(schema.workflowLogs).values({
      id: "log-2",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "role2",
      layer: 2,
      status: "PENDING",
    });

    const { histories } = await WorkflowTasksHistoryService.getHistory(db, {
      userId: "admin-1",
    } as any);

    const item = histories.find((h) => h.logId === "log-2")!;
    expect(item.flowProgress).toHaveLength(2);

    const step1 = item.flowProgress.find((s) => s.stepOrder === 1)!;
    expect(step1.status).toBe("APPROVED");
    expect(step1.performedBy).toBe("承認者太郎");
    expect(step1.roleName).toBe("role1");

    const step2 = item.flowProgress.find((s) => s.stepOrder === 2)!;
    expect(step2.status).toBe("PENDING");
    // まだ誰も処理していないため、候補承認者(resolveApprovers経由)の名前が入る
    expect(step2.performedBy).toBe("承認者次郎");
    expect(step2.roleName).toBe("role2");
  });

  it("UPDATE申請の履歴では、snapshotOldに現在のpartnersマスタのデータを含める", async () => {
    await seedUser("applicant-1");
    await seedUser("admin-1");
    await seedRole("admin");
    await seedUserRole("admin-1", "admin", null);
    await seedPartner("partner-1", "現在の取引先名", "applicant-1");

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "UPDATE",
      status: "APPROVED",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "admin",
      layer: 1,
      status: "APPROVED",
      approverId: "admin-1",
      performedAt: now,
    });

    const { histories } = await WorkflowTasksHistoryService.getHistory(db, {
      userId: "admin-1",
    } as any);

    const item = histories.find((h) => h.logId === "log-1")!;
    expect(item.snapshotOld).toMatchObject({
      id: "partner-1",
      name: "現在の取引先名",
    });
  });

  it("不具合修正の回帰テスト: 同名ロールを他部署で保持しているだけのユーザーには、その部署宛のPENDING項目が見えてはいけない", async () => {
    // 再現条件: ユーザー報告そのまま。「人事総務部の課長」宛の承認待ちが、無関係な
    // 「営業統括部の課長」から申請履歴・進捗一覧で参照できてしまっていた不具合を再現する。
    // ステップ側にtargetDepartmentSurrogateIdを明示指定するケース。
    await seedUser("applicant-1");
    await seedUser("sales-manager", { name: "営業統括部の課長" });
    await seedDepartment("dept-hr", "D-HR", "人事総務部");
    await seedDepartment("dept-sales", "D-SALES", "営業統括部");
    await seedRole("manager");
    await seedUserRole("sales-manager", "manager", "dept-sales");

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
    await db.insert(schema.approvalFlows).values({
      id: "flow-partner",
      name: "取引先承認",
      requestType: "master_partners",
      minAmount: 0,
      maxAmount: 0,
      isActive: true,
    });
    await db.insert(schema.approvalFlowSteps).values({
      id: "flow-partner-step-1",
      flowId: "flow-partner",
      stepOrder: 1,
      approverRoleId: "manager",
      targetDepartmentSurrogateId: "dept-hr",
    });
    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "manager",
      layer: 1,
      status: "PENDING",
    });

    const { histories } = await WorkflowTasksHistoryService.getHistory(db, {
      userId: "sales-manager",
    } as any);

    expect(histories).toEqual([]);
  });

  it("同名ロールを正しく同じ部署で保持しているユーザーには、そのPENDING項目が見える(過剰制限になっていないことの確認)", async () => {
    await seedUser("applicant-1");
    await seedUser("hr-manager", { name: "人事総務部の課長" });
    await seedDepartment("dept-hr", "D-HR", "人事総務部");
    await seedRole("manager");
    await seedUserRole("hr-manager", "manager", "dept-hr");

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
    await db.insert(schema.approvalFlows).values({
      id: "flow-partner",
      name: "取引先承認",
      requestType: "master_partners",
      minAmount: 0,
      maxAmount: 0,
      isActive: true,
    });
    await db.insert(schema.approvalFlowSteps).values({
      id: "flow-partner-step-1",
      flowId: "flow-partner",
      stepOrder: 1,
      approverRoleId: "manager",
      targetDepartmentSurrogateId: "dept-hr",
    });
    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "manager",
      layer: 1,
      status: "PENDING",
    });

    const { histories } = await WorkflowTasksHistoryService.getHistory(db, {
      userId: "hr-manager",
    } as any);

    expect(histories.map((h) => h.logId)).toEqual(["log-1"]);
  });

  it("ステップに部署未指定の場合は申請者の所属部署で判定し、無関係な他部署の同名ロール保持者には見えない", async () => {
    // ユーザー確認済みの仕様: ステップに部署指定が無い場合は「申請者の所属部門の指定ロール」が
    // 承認者になる(WorkflowEngine.resolveApproversの既存実装通り)。
    await seedUser("hr-applicant", { name: "人事総務部の申請者" });
    await seedUser("sales-manager", { name: "営業統括部の課長" });
    await seedDepartment("dept-hr", "D-HR", "人事総務部");
    await seedDepartment("dept-sales", "D-SALES", "営業統括部");
    await seedRole("manager");
    await seedUserRole("hr-applicant", "manager", "dept-hr"); // 申請者自身も部署付きmanagerを持つ(所属部門解決用)
    await seedUserRole("sales-manager", "manager", "dept-sales");

    await db.insert(schema.masterApprovalRequests).values({
      id: "req-1",
      targetType: "master_partners",
      targetId: "partner-1",
      requestType: "REGISTER",
      status: "PENDING",
      applicantId: "hr-applicant",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.approvalFlows).values({
      id: "flow-partner",
      name: "取引先承認",
      requestType: "master_partners",
      minAmount: 0,
      maxAmount: 0,
      isActive: true,
    });
    // targetDepartmentSurrogateId未指定 = 申請者の所属部門(人事総務部)のmanagerが承認者
    await db.insert(schema.approvalFlowSteps).values({
      id: "flow-partner-step-1",
      flowId: "flow-partner",
      stepOrder: 1,
      approverRoleId: "manager",
    });
    await db.insert(schema.workflowLogs).values({
      id: "log-1",
      targetType: "master_partners",
      targetId: "partner-1",
      approverRoleId: "manager",
      layer: 1,
      status: "PENDING",
    });

    const { histories } = await WorkflowTasksHistoryService.getHistory(db, {
      userId: "sales-manager",
    } as any);

    expect(histories).toEqual([]);
  });
});

describe("WorkflowTasksHistoryService.getHistoryPage", () => {
  it("全件計算後にin-memoryでページ分割し、{data,pagination,isAdmin}形式で返す", async () => {
    await seedUser("applicant-1");
    await seedUser("admin-1");
    await seedRole("admin");
    await seedUserRole("admin-1", "admin", null);
    await seedRole("approver_role");
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
        status: "APPROVED",
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
        status: "APPROVED",
        approverId: "admin-1",
        performedAt: now,
      });
    }

    const result = await WorkflowTasksHistoryService.getHistoryPage(
      db,
      { userId: "admin-1" } as any,
      { page: 1, limit: 1 },
    );

    expect(result.data).toHaveLength(1);
    expect(result.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(result.isAdmin).toBe(true);
  });

  it("countsは選択中のUIタブに関わらず全ステータスの件数を返し、dataはタブ絞り込み後の件数でページングされる", async () => {
    // 回帰テスト: 以前のフロントエンド実装は、REMANDED等の実ステータスタブを
    // 選んでいる間はサーバー側で既に絞り込まれた後のデータから件数を数えていたため、
    // 選択中タブ以外の件数バッジが常に0になっていた。ここではUIタブに依存せず
    // 常に全件から計算されることを確認する。
    await seedUser("applicant-1");
    await seedUser("admin-1");
    await seedRole("admin");
    await seedUserRole("admin-1", "admin", null);
    await seedRole("approver_role");

    const statuses = ["APPROVED", "REMANDED", "PENDING", "CANCELED"] as const;
    for (const status of statuses) {
      const targetId = `partner-${status}`;
      await seedPartner(targetId, `取引先-${status}`, "applicant-1");
      await db.insert(schema.masterApprovalRequests).values({
        id: `req-${status}`,
        targetType: "master_partners",
        targetId,
        requestType: "master_partners",
        status,
        applicantId: "applicant-1",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.workflowLogs).values({
        id: `log-${status}`,
        targetType: "master_partners",
        targetId,
        approverRoleId: "approver_role",
        layer: 1,
        status,
        approverId: status === "APPROVED" || status === "CANCELED" ? "admin-1" : null,
        performedAt: now,
      });
    }

    const result = await WorkflowTasksHistoryService.getHistoryPage(
      db,
      { userId: "admin-1", status: "REMANDED" } as any,
      { page: 1, limit: 10 },
    );

    expect(result.counts).toEqual({
      approved: 1,
      remanded: 1,
      pending: 1,
      canceled: 1,
    });
    expect(result.data).toHaveLength(1);
    expect((result.data[0] as any).targetId).toBe("partner-REMANDED");
    expect(result.pagination.total).toBe(1);
  });

  it("ACTIVE_TASKSタブはCANCELEDを除外し、同一targetIdの複数ログは最新1件のみ返す", async () => {
    await seedUser("applicant-1");
    await seedUser("admin-1");
    await seedRole("admin");
    await seedUserRole("admin-1", "admin", null);
    await seedRole("approver_role");

    await seedPartner("partner-multi", "複数段階の申請", "applicant-1");
    await db.insert(schema.masterApprovalRequests).values({
      id: "req-multi",
      targetType: "master_partners",
      targetId: "partner-multi",
      requestType: "master_partners",
      status: "PENDING",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });
    // 同一targetIdに対し、ACTIVE_TASKSの絞り込み条件(status=PENDING)を両方満たす
    // 2件のログを作る(dedup前ならどちらも残ってしまう状況を再現する)。
    // performedAtで新旧を明確にし、より新しいlog-multi-2だけが残ることを確認する。
    const earlier = new Date(now.getTime() - 60_000);
    await db.insert(schema.workflowLogs).values({
      id: "log-multi-1",
      targetType: "master_partners",
      targetId: "partner-multi",
      approverRoleId: "approver_role",
      layer: 1,
      status: "PENDING",
      performedAt: earlier,
    });
    await db.insert(schema.workflowLogs).values({
      id: "log-multi-2",
      targetType: "master_partners",
      targetId: "partner-multi",
      approverRoleId: "approver_role",
      layer: 2,
      status: "PENDING",
      performedAt: now,
    });

    await seedPartner("partner-canceled", "取下げ済みの申請", "applicant-1");
    await db.insert(schema.masterApprovalRequests).values({
      id: "req-canceled",
      targetType: "master_partners",
      targetId: "partner-canceled",
      requestType: "master_partners",
      status: "CANCELED",
      applicantId: "applicant-1",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.workflowLogs).values({
      id: "log-canceled",
      targetType: "master_partners",
      targetId: "partner-canceled",
      approverRoleId: "approver_role",
      layer: 1,
      status: "CANCELED",
    });

    const result = await WorkflowTasksHistoryService.getHistoryPage(
      db,
      { userId: "admin-1", status: "ACTIVE_TASKS" } as any,
      { page: 1, limit: 10 },
    );

    expect(result.data).toHaveLength(1);
    expect((result.data[0] as any).logId).toBe("log-multi-2");
    expect(result.pagination.total).toBe(1);
  });
});
