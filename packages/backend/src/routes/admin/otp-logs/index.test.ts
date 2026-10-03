import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import * as otpSchema from "../../../db/otp-schema";
import { otpLogsRouter } from "./index";

const db = drizzle(env.DB, { schema });
const otpDb = drizzle(env.DB_OTP, { schema: otpSchema });
const now = new Date();

beforeEach(async () => {
  await otpDb.delete(otpSchema.otpChallenges);
  await db.delete(schema.quotes);
  await db.delete(schema.itemShipmentInstructions);
  await db.delete(schema.itemShipmentHeaders);
  await db.delete(schema.itemReceiptHeaders);
  await db.delete(schema.partners);
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

async function seedPartner(id: string, name: string) {
  await db.insert(schema.partners).values({
    id,
    name,
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
}

async function seedQuote(id: string, partnerId: string, title: string) {
  await db.insert(schema.quotes).values({
    id,
    title,
    partnerId,
    quoteDate: now,
    status: "APPROVED",
    createdBy: "user-001",
    createdAt: now,
    updatedBy: "user-001",
    updatedAt: now,
  });
}

async function seedShipmentInstruction(id: string, partnerId: string, warehouseId: string) {
  await db.insert(schema.itemShipmentInstructions).values({
    id,
    partnerId,
    warehouseId,
    instructedShipDate: now,
    status: "APPROVED",
    createdBy: "user-001",
    createdAt: now,
  });
}

async function seedDeliveryNote(id: string, partnerId: string) {
  await db.insert(schema.itemShipmentHeaders).values({
    id,
    partnerId,
    shippedDate: now,
    status: "APPROVED",
    createdBy: "user-001",
    createdAt: now,
  });
}

async function seedAcceptanceInspection(id: string, partnerId: string) {
  await db.insert(schema.itemReceiptHeaders).values({
    id,
    partnerId,
    receivedDate: now,
    status: "APPROVED",
    createdBy: "user-001",
    createdAt: now,
  });
}

async function seedChallenge(
  id: string,
  documentId: string,
  email: string,
  overrides: Partial<typeof otpSchema.otpChallenges.$inferInsert> = {},
) {
  await otpDb.insert(otpSchema.otpChallenges).values({
    id,
    documentType: "sales_quote",
    documentId,
    attachmentId: "att-1",
    email,
    otpCode: "1234",
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    attemptCount: 0,
    createdAt: now,
    ...overrides,
  });
}

async function postSearch(body: unknown) {
    const ctx = createExecutionContext();
  const _res = await otpLogsRouter.request(
    "/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env, ctx
  );
  await waitOnExecutionContext(ctx);
  return _res;
}

describe("POST /search", () => {
  it("page/limit未指定時は配列をそのまま返し、取引先名・件名がquotes/partnersから解決される", async () => {
    await seedPartner("P-1", "テスト商事");
    await seedQuote("QT-1", "P-1", "見積のご案内");
    await seedChallenge("otp-1", "QT-1", "customer@example.com", {
      verifiedAt: now,
    });

    const res = await postSearch({});
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: string;
      partnerName: string | null;
      quoteTitle: string | null;
    }>;
    expect(body).toHaveLength(1);
    expect(body[0].partnerName).toBe("テスト商事");
    expect(body[0].quoteTitle).toBe("見積のご案内");
  });

  it("page/limit指定時は{data,pagination}形式で返す", async () => {
    await seedPartner("P-1", "テスト商事");
    await seedQuote("QT-1", "P-1", "見積A");
    await seedChallenge("otp-1", "QT-1", "a@example.com");
    await seedChallenge("otp-2", "QT-1", "b@example.com");

    const res = await postSearch({ page: 1, limit: 1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it("メールアドレスで絞り込める", async () => {
    await seedPartner("P-1", "テスト商事");
    await seedQuote("QT-1", "P-1", "見積A");
    await seedChallenge("otp-1", "QT-1", "match@example.com");
    await seedChallenge("otp-2", "QT-1", "other@example.com");

    const res = await postSearch({ email: "match" });
    const body = (await res.json()) as Array<{ email: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].email).toBe("match@example.com");
  });

  it("取引先ID(取引先マスタからの選択)で絞り込める(別DBのotp_challengesとquotesを跨いだ検索)", async () => {
    await seedPartner("P-1", "アルファ商事");
    await seedPartner("P-2", "ベータ商事");
    await seedQuote("QT-1", "P-1", "見積A");
    await seedQuote("QT-2", "P-2", "見積B");
    await seedChallenge("otp-1", "QT-1", "a@example.com");
    await seedChallenge("otp-2", "QT-2", "b@example.com");

    const res = await postSearch({ partnerId: "P-1" });
    const body = (await res.json()) as Array<{ documentId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].documentId).toBe("QT-1");
  });

  it("件名で絞り込める", async () => {
    await seedPartner("P-1", "テスト商事");
    await seedQuote("QT-1", "P-1", "特別見積");
    await seedQuote("QT-2", "P-1", "通常見積");
    await seedChallenge("otp-1", "QT-1", "a@example.com");
    await seedChallenge("otp-2", "QT-2", "b@example.com");

    const res = await postSearch({ subject: "特別" });
    const body = (await res.json()) as Array<{ documentId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].documentId).toBe("QT-1");
  });

  it("種別(documentType)で絞り込める", async () => {
    await seedPartner("P-1", "テスト商事");
    await seedQuote("QT-1", "P-1", "見積A");
    await seedShipmentInstruction("SI-1", "P-1", "WH1");
    await seedChallenge("otp-1", "QT-1", "a@example.com");
    await seedChallenge("otp-2", "SI-1", "b@example.com", {
      documentType: "shipment_instruction",
    });

    const res = await postSearch({ documentType: "shipment_instruction" });
    const body = (await res.json()) as Array<{ documentId: string; quoteTitle: string | null }>;
    expect(body).toHaveLength(1);
    expect(body[0].documentId).toBe("SI-1");
    expect(body[0].quoteTitle).toBe("出荷指示書");
  });

  it("倉庫(warehouseId)で絞り込める(見積は倉庫の概念を持たないため対象外)", async () => {
    await seedPartner("P-1", "テスト商事");
    await seedQuote("QT-1", "P-1", "見積A");
    await seedShipmentInstruction("SI-1", "P-1", "WH1");
    await seedShipmentInstruction("SI-2", "P-1", "WH2");
    await seedChallenge("otp-1", "QT-1", "a@example.com");
    await seedChallenge("otp-2", "SI-1", "b@example.com", {
      documentType: "shipment_instruction",
    });
    await seedChallenge("otp-3", "SI-2", "c@example.com", {
      documentType: "shipment_instruction",
    });

    const res = await postSearch({ warehouseId: "WH1" });
    const body = (await res.json()) as Array<{ documentId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].documentId).toBe("SI-1");
  });

  it("検収書発行フォローアップ: 納品書・検収書もdocumentType指定で絞り込め、固定ラベル+取引先名が解決される", async () => {
    await seedPartner("P-1", "テスト商事");
    await seedDeliveryNote("SH-1", "P-1");
    await seedAcceptanceInspection("SR-1", "P-1");
    await seedChallenge("otp-1", "SH-1", "a@example.com", { documentType: "delivery_note" });
    await seedChallenge("otp-2", "SR-1", "b@example.com", { documentType: "acceptance_inspection" });

    const deliveryRes = await postSearch({ documentType: "delivery_note" });
    const deliveryBody = (await deliveryRes.json()) as Array<{ documentId: string; quoteTitle: string | null; partnerName: string | null }>;
    expect(deliveryBody).toHaveLength(1);
    expect(deliveryBody[0].documentId).toBe("SH-1");
    expect(deliveryBody[0].quoteTitle).toBe("納品書");
    expect(deliveryBody[0].partnerName).toBe("テスト商事");

    const acceptanceRes = await postSearch({ documentType: "acceptance_inspection" });
    const acceptanceBody = (await acceptanceRes.json()) as Array<{ documentId: string; quoteTitle: string | null }>;
    expect(acceptanceBody).toHaveLength(1);
    expect(acceptanceBody[0].documentId).toBe("SR-1");
    expect(acceptanceBody[0].quoteTitle).toBe("検収書");
  });

  it("検収書発行フォローアップ: 納品書・検収書も取引先IDで絞り込める", async () => {
    await seedPartner("P-1", "アルファ商事");
    await seedPartner("P-2", "ベータ商事");
    await seedDeliveryNote("SH-1", "P-1");
    await seedDeliveryNote("SH-2", "P-2");
    await seedChallenge("otp-1", "SH-1", "a@example.com", { documentType: "delivery_note" });
    await seedChallenge("otp-2", "SH-2", "b@example.com", { documentType: "delivery_note" });

    const res = await postSearch({ partnerId: "P-1" });
    const body = (await res.json()) as Array<{ documentId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].documentId).toBe("SH-1");
  });

  it("検収書発行フォローアップ: 件名(subject)検索時は納品書・検収書を対象外にする(件名の概念が無いため全件ヒットしないことを確認)", async () => {
    await seedPartner("P-1", "テスト商事");
    await seedQuote("QT-1", "P-1", "特別見積");
    await seedDeliveryNote("SH-1", "P-1");
    await seedChallenge("otp-1", "QT-1", "a@example.com");
    await seedChallenge("otp-2", "SH-1", "b@example.com", { documentType: "delivery_note" });

    const res = await postSearch({ subject: "特別" });
    const body = (await res.json()) as Array<{ documentId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].documentId).toBe("QT-1");
  });

  it("一致する取引先が存在しない場合は0件を返す", async () => {
    await seedPartner("P-1", "テスト商事");
    await seedQuote("QT-1", "P-1", "見積A");
    await seedChallenge("otp-1", "QT-1", "a@example.com");

    const res = await postSearch({ partnerId: "P-NOT-EXIST" });
    const body = (await res.json()) as Array<unknown>;
    expect(body).toHaveLength(0);
  });
});

describe("GET /csv-download", () => {
  it("検索条件に一致する全件をBOM付きCSVで返す", async () => {
    await seedPartner("P-1", "テスト商事");
    await seedQuote("QT-1", "P-1", "見積のご案内");
    await seedChallenge("otp-1", "QT-1", "customer@example.com", {
      verifiedAt: now,
    });

        const ctx = createExecutionContext();
    const res = await otpLogsRouter.request("/csv-download", {}, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    expect(text).toContain("取引先名");
    expect(text).toContain("テスト商事");
    expect(text).toContain("customer@example.com");
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(2); // ヘッダー1行 + データ1行
  });
});
