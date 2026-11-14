import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { projectsRouter } from "./index";
import { getTargetAdapter } from "../../../workflow-engine/target-adapters/registry";

// BUG-097: プロジェクトマスタの承認(会社設定 is_project_approval_enabled)。手本は単位マスタ
const db = drizzle(env.DB, { schema });
const now = new Date();

async function setApproval(enabled: boolean) {
  await env.COMPANY_SETTINGS.put("config", JSON.stringify(enabled ? { is_project_approval_enabled: true } : {}));
}

async function reqJson(path: string, method: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await projectsRouter.request(
    path,
    {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function findProject(id: string) {
  return (await db.select().from(schema.projects).where(eq(schema.projects.id, id)))[0];
}

beforeEach(async () => {
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.orders);
  await db.delete(schema.purchaseRequests);
  await db.delete(schema.projects);
  await db.delete(schema.users);
  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
});

afterEach(async () => {
  await setApproval(false);
});

describe("プロジェクトマスタの承認(BUG-097)", () => {
  it("承認 ON の新規登録は仮登録(temporary)になる。OFF なら今まで通り有効", async () => {
    await setApproval(true);
    const on = await reqJson("/register", "POST", { id: "PJ-ON", name: "承認あり" });
    expect(((await on.json()) as { status: string }).status).toBe("temporary");
    expect((await findProject("PJ-ON")).status).toBe("temporary");

    await setApproval(false);
    await reqJson("/register", "POST", { id: "PJ-OFF", name: "承認なし" });
    expect((await findProject("PJ-OFF")).status).toBe("active");
  });

  it("変更申請の前に、今の内容のまま状態だけ temporary にしてロックできる。status を送らなければ状態は変わらない", async () => {
    await reqJson("/register", "POST", { id: "PJ-1", name: "元の名前" });
    await reqJson("/PJ-1", "PUT", { name: "元の名前", status: "temporary" });
    expect((await findProject("PJ-1")).status).toBe("temporary");

    await reqJson("/PJ-1", "PUT", { name: "別の名前" });
    expect(await findProject("PJ-1")).toMatchObject({ name: "別の名前", status: "temporary" });
  });

  it("承認 ON の間は CSV で取り込めない(承認を通さずに登録できてしまうため)", async () => {
    await setApproval(true);
    const formData = new FormData();
    formData.append("file", new Blob(["id,name\nPJ-CSV,CSV\n"], { type: "text/csv" }), "projects.csv");
    const ctx = createExecutionContext();
    const res = await projectsRouter.request("/bulk-register", { method: "POST", body: formData }, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
    expect(await findProject("PJ-CSV")).toBeUndefined();
  });

  it("承認: 新規登録は仮登録の行を有効にし、変更申請は退避した内容(名前・期間・メモ)を反映する", async () => {
    const adapter = getTargetAdapter("master_projects")!;
    const reqParent = (id: string, targetId: string, requestType: string) => ({
      id,
      targetId,
      targetType: "master_projects",
      requestType,
      applicantId: "user-001",
    });

    await db.insert(schema.projects).values({ id: "PJ-NEW", name: "新規", status: "temporary", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now });
    await adapter.applyApproved({ db, reqParent: reqParent("REQ-1", "PJ-NEW", "REGISTER"), userId: "user-001", now });
    expect((await findProject("PJ-NEW")).status).toBe("active");

    await db.insert(schema.projects).values({ id: "PJ-UPD", name: "変更前", status: "temporary", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now });
    await db.insert(schema.masterApprovalRequests).values({
      id: "REQ-2",
      targetType: "master_projects",
      targetId: "PJ-UPD",
      requestType: "UPDATE",
      status: "PENDING",
      applicantId: "user-001",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.masterApprovalContexts).values({
      id: "CTX-2",
      requestId: "REQ-2",
      generalMemo: JSON.stringify({ name: "変更後", memo: "メモ", startDate: "2026-04-01", endDate: "", status: "active" }),
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await adapter.applyApproved({ db, reqParent: reqParent("REQ-2", "PJ-UPD", "UPDATE"), userId: "user-001", now });
    const updated = await findProject("PJ-UPD");
    expect(updated).toMatchObject({ name: "変更後", memo: "メモ", status: "active", endDate: null });
    expect(updated.startDate?.toISOString().slice(0, 10)).toBe("2026-04-01");
  });

  it("承認タスクのプレビューは、変更申請なら退避した変更後の内容を出す", async () => {
    const adapter = getTargetAdapter("master_projects")!;
    await db.insert(schema.projects).values({ id: "PJ-P", name: "今の名前", status: "temporary", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now });
    await db.insert(schema.masterApprovalRequests).values({
      id: "REQ-P",
      targetType: "master_projects",
      targetId: "PJ-P",
      requestType: "UPDATE",
      status: "PENDING",
      applicantId: "user-001",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.masterApprovalContexts).values({
      id: "CTX-P",
      requestId: "REQ-P",
      generalMemo: JSON.stringify({ name: "新しい名前" }),
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    const task = await adapter.getTaskPreview!({ db, requestId: "REQ-P", targetId: "PJ-P" });
    expect(task.targetName).toBe("今の名前");
    expect(task.previewData).toMatchObject({ id: "PJ-P", name: "新しい名前" });
  });
});
