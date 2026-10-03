import { describe, it, expect, beforeEach } from "vitest";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { partnersRouter } from "./index";

/**
 * 2-2(エラー処理統一)前の現状挙動を固定するキャラクタリゼーションテスト。
 */

const db = drizzle(env.DB, { schema });

beforeEach(async () => {
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.users);

  const now = new Date();
  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
});

const basePartner = {
  id: "P-1",
  name: "取引先1",
  type: "CUSTOMER",
  status: "active",
};

async function reqJson(path: string, method: string, body?: unknown) {
  const ctx = createExecutionContext();
  const _res = await partnersRouter.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

describe("POST /register", () => {
  it("正常登録は200・固定メッセージを返す", async () => {
    const res = await reqJson("/register", "POST", basePartner);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "取引先を登録しました",
      id: basePartner.id,
    });
  });

  it("コード未入力の場合、master_code_formatsの設定(既定PT+4桁)に基づき自動採番される", async () => {
    const res = await reqJson("/register", "POST", {
      ...basePartner,
      id: undefined,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^PT-\d{4}$/);
  });

  it("重複IDの登録は400・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", basePartner);
    const res = await reqJson("/register", "POST", basePartner);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "登録エラー: 指定された取引先コードは既に存在します",
    });
  });
});

describe("PUT /:id", () => {
  it("存在しないIDの更新は404・固定メッセージを返す", async () => {
    const res = await reqJson("/NOPE", "PUT", basePartner);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "更新対象の取引先が存在しません",
    });
  });

  it("存在するIDの更新は200・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", basePartner);
    const res = await reqJson("/P-1", "PUT", { ...basePartner, name: "改名" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "取引先情報を更新しました",
    });
  });

  // 回帰テスト: contractDate/contractValidToがJSON経由の文字列のまま渡された際、
  // drizzleのtimestampマッパーで"e.getTime is not a function"としてcrashしていた不具合。
  // (取引先の「停止」操作のpre-save処理が、これらのフィールドを含む現在のレコード全体を
  // そのままPUTするため、契約日が入力済みの取引先を停止しようとすると必ず再現していた)
  it("contractDate/contractValidToを文字列で送っても500にならず正常に更新できる", async () => {
    await reqJson("/register", "POST", basePartner);
    const res = await reqJson("/P-1", "PUT", {
      ...basePartner,
      name: "改名",
      contractDate: "2026-08-01T00:00:00.000Z",
      contractValidTo: "2027-08-01T00:00:00.000Z",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "取引先情報を更新しました",
    });
  });

  // 回帰テスト: 取引先マスタ画面の「停止」フローは、一覧/詳細APIから取得した既存レコードを
  // 丸ごとスプレッドしてPUTする(createdAt等の監査カラムを文字列のまま含む)。
  // updatePartnerSchemaがlooseObjectのためcreatedAtは未宣言フィールドとして素通りし、
  // 以前のrepository実装(...partnerDataをそのままSET句に渡す)ではこれがSQLに混入して
  // drizzleのtimestampマッパーで"e.getTime is not a function"としてcrashしていた。
  it("createdAt等の未宣言な余分なフィールドが含まれていても500にならず正常に更新できる", async () => {
    await reqJson("/register", "POST", basePartner);
    const res = await reqJson("/P-1", "PUT", {
      ...basePartner,
      name: "改名",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      id: "P-1",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "取引先情報を更新しました",
    });
  });
});

// ファームバンキング: 振込先口座(複数口座対応、attachmentsと同じ洗い替え方式)
describe("ファームバンキング: 振込先口座", () => {
  const bankAccount = {
    bankName: "テスト銀行",
    bankCode: "0001",
    branchName: "本店",
    branchCode: "001",
    accountType: "ORDINARY",
    accountNumber: "1234567",
    accountHolderName: "ｶ)ｻﾝﾌﾟﾙ",
    isDefault: true,
  };

  it("登録時に指定した口座が保存され、一覧取得時にbankAccountsとして返る", async () => {
    await reqJson("/register", "POST", {
      ...basePartner,
      bankAccounts: [bankAccount],
    });

    const ctx = createExecutionContext();
    const res = await partnersRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const body = (await res.json()) as Array<{
      id: string;
      bankAccounts: any[];
    }>;
    const partner = body.find((p) => p.id === "P-1");
    expect(partner?.bankAccounts).toHaveLength(1);
    expect(partner?.bankAccounts[0]).toMatchObject({
      bankName: "テスト銀行",
      accountNumber: "1234567",
      accountHolderName: "ｶ)ｻﾝﾌﾟﾙ",
      isDefault: true,
    });
  });

  it("更新時にbankAccountsを指定すると、既存の口座が洗い替えされる", async () => {
    await reqJson("/register", "POST", {
      ...basePartner,
      bankAccounts: [bankAccount],
    });

    await reqJson("/P-1", "PUT", {
      ...basePartner,
      bankAccounts: [
        { ...bankAccount, bankName: "別銀行", accountNumber: "7654321" },
      ],
    });

    const ctx = createExecutionContext();
    const res = await partnersRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const body = (await res.json()) as Array<{
      id: string;
      bankAccounts: any[];
    }>;
    const partner = body.find((p) => p.id === "P-1");
    expect(partner?.bankAccounts).toHaveLength(1);
    expect(partner?.bankAccounts[0]).toMatchObject({
      bankName: "別銀行",
      accountNumber: "7654321",
    });
  });

  it("更新時にbankAccountsを省略すると、既存の口座はすべて削除される(洗い替え)", async () => {
    await reqJson("/register", "POST", {
      ...basePartner,
      bankAccounts: [bankAccount],
    });

    await reqJson("/P-1", "PUT", basePartner);

    const ctx = createExecutionContext();
    const res = await partnersRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const body = (await res.json()) as Array<{
      id: string;
      bankAccounts: any[];
    }>;
    const partner = body.find((p) => p.id === "P-1");
    expect(partner?.bankAccounts).toEqual([]);
  });
});

describe("POST /:id/suspend", () => {
  it("存在しないIDの停止は404・固定メッセージを返す", async () => {
    const res = await reqJson("/NOPE/suspend", "POST");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "対象の取引先が存在しません",
    });
  });

  it("存在するIDの停止は200・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", basePartner);
    const res = await reqJson("/P-1/suspend", "POST");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "取引先を停止状態に変更しました",
    });
  });
});

describe("DELETE /:id/purge", () => {
  it("存在しないIDの削除は404・固定メッセージを返す", async () => {
    const res = await reqJson("/NOPE/purge", "DELETE");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message: "削除対象の取引先が存在しません",
    });
  });

  it("suspended以外のステータスの削除は400・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", basePartner);
    const res = await reqJson("/P-1/purge", "DELETE");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message:
        "削除拒否: 無効状態の取引先のみ物理削除できます",
    });
  });

  it("suspended状態・無参照の削除は200・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", basePartner);
    await reqJson("/P-1/suspend", "POST");
    const res = await reqJson("/P-1/purge", "DELETE");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      message: "取引先データを完全削除しました",
    });
  });

  it("他レコードから参照されている取引先の削除は400・固定メッセージを返す", async () => {
    await reqJson("/register", "POST", basePartner);
    await reqJson("/P-1/suspend", "POST");
    const now = new Date();
    await db.insert(schema.partnerContacts).values({
      id: "PC-1",
      partnerId: "P-1",
      contactType: "SALES",
      createdBy: "user-001",
      createdAt: now,
      updatedBy: "user-001",
      updatedAt: now,
    });

    const res = await reqJson("/P-1/purge", "DELETE");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      message:
        "この取引先は担当者や他データから参照されているため削除できません",
    });
  });
});

describe("GET /", () => {
  it("page/limit未指定時は配列をそのまま返す", async () => {
    await reqJson("/register", "POST", basePartner);
    const ctx = createExecutionContext();
    const res = await partnersRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: string;
      attachments: unknown[];
    }>;
    expect(body.some((p) => p.id === "P-1")).toBe(true);
    expect(body[0]).toHaveProperty("attachments");
  });

  it("page/limit指定時は既存の検索条件を維持したまま{data,pagination}形式で返す", async () => {
    await reqJson("/register", "POST", basePartner);
    await reqJson("/register", "POST", {
      ...basePartner,
      id: "P-2",
      name: "取引先2",
    });
    const ctx = createExecutionContext();
    const res = await partnersRouter.request(
      "/?type=CUSTOMER&page=1&limit=1",
      {},
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });
});

describe("追加要望L-4-a: 適格事業者番号・法人番号", () => {
  async function findPartner(id: string) {
    const rows = await db.select().from(schema.partners);
    return rows.find((r) => r.id === id);
  }

  async function bulk(csv: string) {
    const formData = new FormData();
    formData.set("file", new File([csv], "partners.csv", { type: "text/csv" }));
    const ctx = createExecutionContext();
    const res = await partnersRouter.request(
      "/bulk-register",
      { method: "POST", body: formData },
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("登録時に番号を保存でき、一覧にも返る。空文字は未登録(null)として保存される", async () => {
    const res = await reqJson("/register", "POST", {
      ...basePartner,
      qualifiedInvoiceNumber: "T1234567890123",
      corporateNumber: "1234567890123",
    });
    expect(res.status).toBe(200);
    const saved = await findPartner("P-1");
    expect(saved?.qualifiedInvoiceNumber).toBe("T1234567890123");
    expect(saved?.corporateNumber).toBe("1234567890123");

    await reqJson("/register", "POST", {
      ...basePartner,
      id: "P-2",
      qualifiedInvoiceNumber: "",
      corporateNumber: "",
    });
    expect((await findPartner("P-2"))?.qualifiedInvoiceNumber).toBeNull();
  });

  it("形式が不正な番号は400(適格事業者番号はT+13桁、法人番号は13桁)", async () => {
    const bad1 = await reqJson("/register", "POST", {
      ...basePartner,
      qualifiedInvoiceNumber: "1234567890123",
    });
    expect(bad1.status).toBe(400);
    const bad2 = await reqJson("/register", "POST", {
      ...basePartner,
      corporateNumber: "12345",
    });
    expect(bad2.status).toBe(400);
  });

  it("更新で番号を省略しても既存の番号は消えず、指定すれば更新できる", async () => {
    await reqJson("/register", "POST", {
      ...basePartner,
      corporateNumber: "1234567890123",
    });
    await reqJson("/P-1", "PUT", { ...basePartner, name: "名称だけ変更" });
    expect((await findPartner("P-1"))?.corporateNumber).toBe("1234567890123");

    await reqJson("/P-1", "PUT", {
      ...basePartner,
      corporateNumber: "9999999999999",
    });
    expect((await findPartner("P-1"))?.corporateNumber).toBe("9999999999999");
  });

  it("CSV: 新形式(末尾に番号2列)は反映・検証され、旧形式では既存の番号を変更しない", async () => {
    await reqJson("/register", "POST", {
      ...basePartner,
      qualifiedInvoiceNumber: "T1111111111111",
    });

    const header14 =
      "id,name,type,postalCode,address,phone,fax,creditLimit,closingDay,paymentMonthOffset,paymentDay,paymentMethod,status,memo";
    const old = await bulk(
      [header14, "P-1,旧形式で更新,CUSTOMER,,,,,0,0,0,0,,active,"].join("\n"),
    );
    expect(old.status).toBe(200);
    expect((await findPartner("P-1"))?.qualifiedInvoiceNumber).toBe(
      "T1111111111111",
    );

    const fresh = await bulk(
      [
        `${header14},qualifiedInvoiceNumber,corporateNumber`,
        "P-1,新形式で更新,CUSTOMER,,,,,0,0,0,0,,active,,T2222222222222,2222222222222",
      ].join("\n"),
    );
    expect(fresh.status).toBe(200);
    const updated = await findPartner("P-1");
    expect(updated?.qualifiedInvoiceNumber).toBe("T2222222222222");
    expect(updated?.corporateNumber).toBe("2222222222222");

    const bad = await bulk(
      [
        `${header14},qualifiedInvoiceNumber,corporateNumber`,
        "P-1,x,CUSTOMER,,,,,0,0,0,0,,active,,BAD,",
      ].join("\n"),
    );
    expect(bad.status).toBe(400);
  });

  it("CSVダウンロードに番号の列が含まれる", async () => {
    await reqJson("/register", "POST", {
      ...basePartner,
      corporateNumber: "1234567890123",
    });
    const ctx = createExecutionContext();
    const res = await partnersRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    const text = await res.text();
    expect(text).toContain("qualifiedInvoiceNumber,corporateNumber");
    expect(text).toContain('"1234567890123"');
  });
});
