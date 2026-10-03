import { describe, it, expect, beforeEach } from "vitest";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { paymentRouter } from "./index";

// ファームバンキング: 全銀「総合振込」フォーマットの振込データファイル作成(K-5系の続き)

const db = drizzle(env.DB, { schema });
const now = new Date();

const FB_SETTINGS = {
  fb_committer_code: "1234567890",
  fb_committer_name: "ｶﾌﾞｼｷｶﾞｲｼｬｻﾝﾌﾟﾙ",
  fb_bank_code: "0001",
  fb_bank_name: "ﾐｽﾞﾎ",
  fb_branch_code: "001",
  fb_branch_name: "ﾎﾝﾃﾝ",
  fb_account_type: "ORDINARY",
  fb_account_number: "1234567",
};

beforeEach(async () => {
  await db.delete(schema.paymentHeaderItems);
  await db.delete(schema.paymentHeaders);
  await db.delete(schema.partnerBankAccounts);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await env.COMPANY_SETTINGS.put("config", JSON.stringify(FB_SETTINGS));

  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "test@example.com",
    name: "テストユーザー",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.partners).values({
    id: "P-1",
    name: "取引先1",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
  });
});

async function seedBankAccount(
  overrides: Partial<typeof schema.partnerBankAccounts.$inferInsert> = {},
) {
  await db.insert(schema.partnerBankAccounts).values({
    id: "BANK-1",
    partnerId: "P-1",
    bankName: "ﾐﾂｲｽﾐﾄﾓ",
    bankCode: "0009",
    branchName: "ｼﾃﾝ",
    branchCode: "123",
    accountType: "ORDINARY",
    accountNumber: "7654321",
    accountHolderName: "ｶ)ﾃｽﾄｼｮｳｼﾞ",
    isDefault: true,
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
    ...overrides,
  });
}

async function seedPayment(
  overrides: Partial<typeof schema.paymentHeaders.$inferInsert> = {},
) {
  await db.insert(schema.paymentHeaders).values({
    id: "PM-1",
    partnerId: "P-1",
    paymentDate: now,
    mode: "PER_TRANSACTION",
    status: "DRAFT",
    totalAmount: 110000,
    taxAmount: 10000,
    reconciledAmount: 0,
    reconciliationStatus: "UNRECONCILED",
    createdBy: "EMP001",
    createdAt: now,
    updatedBy: "EMP001",
    updatedAt: now,
    ...overrides,
  });
}

async function post(path: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await paymentRouter.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST /firm-banking-preview", () => {
  it("正常に対象件数・合計金額(残額)を返す", async () => {
    await seedBankAccount();
    await seedPayment();

    const res = await post("/firm-banking-preview", {
      paymentHeaderIds: ["PM-1"],
      transferDate: "2026-09-15",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recordCount: number;
      totalAmount: number;
      warnings: string[];
    };
    expect(body.recordCount).toBe(1);
    expect(body.totalAmount).toBe(110000);
    expect(body.warnings).toEqual([]);
  });

  it("一部消込済みの支払は残額のみを対象金額とする", async () => {
    await seedBankAccount();
    await seedPayment({ reconciledAmount: 30000 });

    const res = await post("/firm-banking-preview", {
      paymentHeaderIds: ["PM-1"],
      transferDate: "2026-09-15",
    });
    const body = (await res.json()) as { totalAmount: number };
    expect(body.totalAmount).toBe(80000);
  });

  it("会社設定にファームバンキング用口座情報が未設定だと400", async () => {
    await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));
    await seedBankAccount();
    await seedPayment();

    const res = await post("/firm-banking-preview", {
      paymentHeaderIds: ["PM-1"],
      transferDate: "2026-09-15",
    });
    expect(res.status).toBe(400);
  });

  it("取引先に振込先口座が登録されていない場合は400", async () => {
    await seedPayment();

    const res = await post("/firm-banking-preview", {
      paymentHeaderIds: ["PM-1"],
      transferDate: "2026-09-15",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("振込先口座が登録されていません");
  });

  it("既に全額消込済みの支払を対象にすると400", async () => {
    await seedBankAccount();
    await seedPayment({ reconciledAmount: 110000 });

    const res = await post("/firm-banking-preview", {
      paymentHeaderIds: ["PM-1"],
      transferDate: "2026-09-15",
    });
    expect(res.status).toBe(400);
  });

  it("存在しない支払を対象にすると404", async () => {
    const res = await post("/firm-banking-preview", {
      paymentHeaderIds: ["NOPE"],
      transferDate: "2026-09-15",
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /firm-banking-export", () => {
  it("正常にファイルを生成する(Content-Typeがoctet-stream)", async () => {
    await seedBankAccount();
    await seedPayment();

    const res = await post("/firm-banking-export", {
      paymentHeaderIds: ["PM-1"],
      transferDate: "2026-09-15",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");

    const buf = await res.arrayBuffer();
    const text = Buffer.from(buf).toString("latin1");
    const records = text.split("\r\n").filter((r) => r.length > 0);
    expect(records).toHaveLength(4); // ヘッダー+データ1件+トレーラー+エンド
    expect(records.every((r) => r.length === 120)).toBe(true);
  });

  it("既定口座(isDefault)が複数ある場合は最初の既定口座を使う", async () => {
    await seedBankAccount({
      id: "BANK-1",
      isDefault: false,
      accountNumber: "1111111",
    });
    await seedBankAccount({
      id: "BANK-2",
      isDefault: true,
      accountNumber: "2222222",
    });
    await seedPayment();

    const res = await post("/firm-banking-export", {
      paymentHeaderIds: ["PM-1"],
      transferDate: "2026-09-15",
    });
    const buf = await res.arrayBuffer();
    const text = Buffer.from(buf).toString("latin1");
    expect(text).toContain("2222222");
  });
});
