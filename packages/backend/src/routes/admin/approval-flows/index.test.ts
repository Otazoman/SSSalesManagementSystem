import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { approvalFlowsRouter } from "./index";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  // GET /preview-route のテストがuserRoles経由でrolesを参照するため、FK制約違反を避けるために
  // rolesより先に削除する(既存のテストはuserRolesを使わないため影響なし)
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);

  await db.insert(schema.roles).values({
    id: "manager",
    name: "マネージャー",
    createdAt: new Date(),
  });
});

const baseFlow = {
  name: "標準フロー",
  requestType: "master_partners",
  minAmount: 0,
  maxAmount: 100000,
  steps: [{ approverRoleId: "manager" }],
};

async function reqJson(path: string, method: string, body?: unknown) {
  return approvalFlowsRouter.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
  );
}

describe("DELETE /:id/purge", () => {
  it("存在しないフローの物理削除は404・固定メッセージを返す", async () => {
    const res = await reqJson("/nope/purge", "DELETE");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "承認フローが見つかりません",
    });
  });

  it("有効なフローの物理削除は400・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", baseFlow);
    const listRes = await approvalFlowsRouter.request("/", {}, env);
    const list = (await listRes.json()) as Array<{ id: string }>;
    const id = list[0].id;

    const res = await reqJson(`/${id}/purge`, "DELETE");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "有効なフローは物理削除できません。先に無効化してください",
    });
  });

  it("無効化済みフローの物理削除は200・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", baseFlow);
    const listRes = await approvalFlowsRouter.request("/", {}, env);
    const list = (await listRes.json()) as Array<{ id: string }>;
    const id = list[0].id;

    await reqJson(`/${id}/suspend`, "POST");
    const res = await reqJson(`/${id}/purge`, "DELETE");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "承認フロー設定を完全に消去しました",
    });
  });
});

describe("POST /bulk-register", () => {
  it("ヘッダー不正は400・固定メッセージを返す", async () => {
    const formData = new FormData();
    formData.set("file", new File(["a,b\n1,2"], "flows.csv", { type: "text/csv" }));
    const res = await approvalFlowsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "CSVヘッダー書式が正しくありません",
    });
  });

  it("正常なCSVは200・件数入りメッセージを返す", async () => {
    const csv = [
      "name,requestType,minAmount,maxAmount,isActive,matchField,matchValue,approverRoleId,targetDepartmentId,stepName,stepMemo",
      "フローA,master_partners,0,100000,1,,,manager,,ステップ1,",
    ].join("\n");
    const formData = new FormData();
    formData.set("file", new File([csv], "flows.csv", { type: "text/csv" }));
    const res = await approvalFlowsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "CSVから 1 件のフロー定義(計 1 行のステップ構成)を完全に同期しました",
    });
  });

  it("matchField/matchValue付きのCSVはフローに保存される", async () => {
    const csv = [
      "name,requestType,minAmount,maxAmount,isActive,matchField,matchValue,approverRoleId,targetDepartmentId,stepName,stepMemo",
      "フローB,master_partners,0,100000,1,requestType,CONSUMABLE,manager,,ステップ1,",
    ].join("\n");
    const formData = new FormData();
    formData.set("file", new File([csv], "flows.csv", { type: "text/csv" }));
    await approvalFlowsRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
    );

    const listRes = await approvalFlowsRouter.request("/", {}, env);
    const list = (await listRes.json()) as Array<{
      name: string;
      matchField: string | null;
      matchValue: string | null;
    }>;
    expect(list[0]).toMatchObject({
      name: "フローB",
      matchField: "requestType",
      matchValue: "CONSUMABLE",
    });
  });
});

describe("POST / (matchField/matchValue)", () => {
  it("matchField/matchValueを指定して作成すると一覧取得結果に反映される", async () => {
    await reqJson("/register", "POST", {
      ...baseFlow,
      matchField: "requestType",
      matchValue: "CONSUMABLE",
    });
    const listRes = await approvalFlowsRouter.request("/", {}, env);
    const list = (await listRes.json()) as Array<{
      matchField: string | null;
      matchValue: string | null;
    }>;
    expect(list[0]).toMatchObject({
      matchField: "requestType",
      matchValue: "CONSUMABLE",
    });
  });

  it("matchField/matchValue未指定で作成するとnullのまま保存される(既存フローと同じ挙動を維持)", async () => {
    await reqJson("/register", "POST", baseFlow);
    const listRes = await approvalFlowsRouter.request("/", {}, env);
    const list = (await listRes.json()) as Array<{
      matchField: string | null;
      matchValue: string | null;
    }>;
    expect(list[0].matchField).toBeNull();
    expect(list[0].matchValue).toBeNull();
  });

  it("PUTでmatchField/matchValueを更新できる", async () => {
    await reqJson("/register", "POST", baseFlow);
    const listRes = await approvalFlowsRouter.request("/", {}, env);
    const list = (await listRes.json()) as Array<{ id: string }>;
    const id = list[0].id;

    await reqJson(`/${id}`, "PUT", {
      ...baseFlow,
      matchField: "requestType",
      matchValue: "CAPITAL",
    });

    const listRes2 = await approvalFlowsRouter.request("/", {}, env);
    const list2 = (await listRes2.json()) as Array<{
      matchField: string | null;
      matchValue: string | null;
    }>;
    expect(list2[0]).toMatchObject({
      matchField: "requestType",
      matchValue: "CAPITAL",
    });
  });
});

describe("GET /csv-download", () => {
  it("matchField/matchValueを含むヘッダー・値でCSVを出力する", async () => {
    await reqJson("/register", "POST", {
      ...baseFlow,
      matchField: "requestType",
      matchValue: "CONSUMABLE",
    });

    const res = await approvalFlowsRouter.request(
      "/csv-download",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const [header, row] = text.trim().split("\n");
    expect(header).toBe(
      "name,requestType,minAmount,maxAmount,isActive,matchField,matchValue,approverRoleId,targetDepartmentId,stepName,stepMemo",
    );
    expect(row).toContain('"requestType","CONSUMABLE"');
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await reqJson("/register", "POST", baseFlow);
    const res = await approvalFlowsRouter.request("/", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; steps: unknown[] }>;
    expect(body).toHaveLength(1);
    expect(body[0].steps).toHaveLength(1);
  });

  it("page/limit指定時は{data,pagination}形式で、各フローにstepsが紐づく", async () => {
    await reqJson("/register", "POST", baseFlow);
    await reqJson("/register", "POST", { ...baseFlow, name: "フロー2" });
    const res = await approvalFlowsRouter.request("/?page=1&limit=1", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ name: string; steps: unknown[] }>;
      pagination: { total: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].steps).toHaveLength(1);
    expect(body.pagination.total).toBe(2);
  });
});

// 新規要望: 承認フローの申請経路プレビュー(2026-09-22確定)
describe("GET /preview-route", () => {
  const now = new Date();

  async function seedUser(
    id: string,
    overrides: Partial<typeof schema.users.$inferInsert> = {},
  ) {
    await db.insert(schema.users).values({
      id,
      employeeNumber: id,
      email: `${id}@example.com`,
      name: overrides.name ?? id,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
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

  beforeEach(async () => {
    await db.delete(schema.userRoles);
    await db.delete(schema.users);
  });

  async function callPreview(query: string) {
    return approvalFlowsRouter.request(`/preview-route?${query}`, {}, env);
  }

  it("入力パラメータ不足は400を返す", async () => {
    const res = await callPreview("userId=u1&targetType=master_partners");
    expect(res.status).toBe(400);
  });

  it("条件に合致するフローが無い場合はmatched:falseを返す", async () => {
    await seedUser("u1");
    const res = await callPreview(
      "userId=u1&targetType=master_partners&amount=1000",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matched: boolean; message: string };
    expect(body.matched).toBe(false);
    expect(body.message).toContain("master_partners");
  });

  it("条件に合致するフローがあれば、選定理由とステップ(承認者名・自動通過判定)を返す", async () => {
    await seedUser("u1", { name: "申請太郎" });
    await seedUser("u2", { name: "承認花子" });
    // "manager"ロールはファイル冒頭のbeforeEachで既に投入済みのため、ここでは追加分のみ挿入する
    await db.insert(schema.roles).values({
      id: "requester",
      name: "申請者ロール",
      createdAt: now,
    });
    await seedUserRole("u1", "requester");
    await seedUserRole("u2", "manager");
    await reqJson("/register", "POST", {
      name: "標準フロー",
      requestType: "master_partners",
      minAmount: 0,
      maxAmount: 100000,
      steps: [
        { approverRoleId: "requester", stepName: "起票確認" },
        { approverRoleId: "manager", stepName: "上長承認" },
      ],
    });

    const res = await callPreview(
      "userId=u1&targetType=master_partners&amount=5000",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matched: boolean;
      flowName: string;
      matchReason: string;
      steps: Array<{
        stepOrder: number;
        roleName: string | null;
        approverNames: string[];
        autoPassed: boolean;
      }>;
    };
    expect(body.matched).toBe(true);
    expect(body.flowName).toBe("標準フロー");
    expect(body.matchReason).toContain("標準フロー");
    expect(body.steps).toHaveLength(2);
    // 申請者(u1)自身がrequesterロールを持つため、先頭ステップは自動通過扱いになる
    expect(body.steps[0].autoPassed).toBe(true);
    expect(body.steps[0].roleName).toBe("申請者ロール");
    // 2番目以降は自動通過しない
    expect(body.steps[1].autoPassed).toBe(false);
    expect(body.steps[1].roleName).toBe("マネージャー");
    expect(body.steps[1].approverNames).toContain("承認花子");
  });

  it("matchFieldを持つ条件付きフローが同居する場合、汎用フローが選ばれ理由に対象外件数が含まれる", async () => {
    await seedUser("u1");
    // "manager"ロールはファイル冒頭のbeforeEachで既に投入済み
    await reqJson("/register", "POST", {
      name: "条件付きフロー",
      requestType: "purchase_requisitions",
      minAmount: 0,
      maxAmount: 100000,
      matchField: "requestType",
      matchValue: "PREPAID",
      steps: [{ approverRoleId: "manager" }],
    });
    await reqJson("/register", "POST", {
      name: "汎用フロー",
      requestType: "purchase_requisitions",
      minAmount: 0,
      maxAmount: 100000,
      steps: [{ approverRoleId: "manager" }],
    });

    const res = await callPreview(
      "userId=u1&targetType=purchase_requisitions&amount=3000",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matched: boolean;
      flowName: string;
      matchReason: string;
    };
    expect(body.matched).toBe(true);
    expect(body.flowName).toBe("汎用フロー");
    expect(body.matchReason).toContain("対象外");
  });
});
