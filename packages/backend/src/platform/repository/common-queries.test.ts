import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import {
  findActiveContactsByPartnerId,
  findItemAccountCodes,
  findMailTemplate,
  findPartnerById,
  findPartnerNames,
  findTaxCategoryRates,
  findUnitNames,
  findUserByEmployeeNumber,
  findUserNames,
} from "./common-queries";

const db = drizzle(env.DB, { schema });
const now = new Date();

beforeEach(async () => {
  await db.delete(schema.items);
  await db.delete(schema.mailTemplateSettings);
  await db.delete(schema.partnerContactDocumentTypes);
  await db.delete(schema.partnerContacts);
  await db.delete(schema.partners);
  await db.delete(schema.users);
  await db.delete(schema.taxCategories);
  await db.delete(schema.units);
  await db.delete(schema.accounts);
});

describe("findTaxCategoryRates", () => {
  it("code => taxRateのMapを返す", async () => {
    await db.insert(schema.taxCategories).values([
      { code: "TAX_10", name: "10%標準税率", taxType: "STANDARD", taxRate: 0.1 },
      { code: "TAX_8_REDUCED", name: "8%軽減税率", taxType: "STANDARD", taxRate: 0.08 },
    ]);

    const rates = await findTaxCategoryRates(db);

    expect(rates.get("TAX_10")).toBe(0.1);
    expect(rates.get("TAX_8_REDUCED")).toBe(0.08);
    expect(rates.size).toBe(2);
  });
});

describe("findUnitNames", () => {
  it("code => nameのMapを返す", async () => {
    await db.insert(schema.units).values([
      { code: "PCS", name: "個", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { code: "SET", name: "セット", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    ]);

    const names = await findUnitNames(db);

    expect(names.get("PCS")).toBe("個");
    expect(names.get("SET")).toBe("セット");
  });
});

describe("findUserByEmployeeNumber", () => {
  it("該当する社員番号のユーザーを返す", async () => {
    await db.insert(schema.users).values({
      id: "user-001",
      employeeNumber: "EMP001",
      email: "test@example.com",
      name: "テストユーザー",
      createdAt: now,
      updatedAt: now,
    });

    const user = await findUserByEmployeeNumber(db, "EMP001");

    expect(user?.name).toBe("テストユーザー");
  });

  it("該当が無ければnullを返す", async () => {
    expect(await findUserByEmployeeNumber(db, "NOPE")).toBeNull();
  });
});

describe("findMailTemplate", () => {
  it("該当するidの帳票テンプレート設定を返す", async () => {
    await db.insert(schema.mailTemplateSettings).values({
      id: "billing_invoice",
      name: "請求書",
      subjectTemplate: "件名",
      bodyTemplate: "本文",
      updatedAt: now,
    });

    const template = await findMailTemplate(db, "billing_invoice");

    expect(template?.name).toBe("請求書");
  });

  it("該当が無ければnullを返す", async () => {
    expect(await findMailTemplate(db, "nope")).toBeNull();
  });
});

describe("findPartnerById", () => {
  it("該当するidの取引先を返す", async () => {
    await db.insert(schema.partners).values({
      id: "P-1",
      name: "取引先1",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });

    const partner = await findPartnerById(db, "P-1");

    expect(partner?.name).toBe("取引先1");
  });

  it("該当が無ければnullを返す", async () => {
    expect(await findPartnerById(db, "nope")).toBeNull();
  });
});

describe("findActiveContactsByPartnerId", () => {
  beforeEach(async () => {
    await db.insert(schema.partners).values({
      id: "P-1",
      name: "取引先1",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
  });

  it("指定した帳票種別をメールで送る設定の、有効な担当者のみ返す", async () => {
    await db.insert(schema.partnerContacts).values([
      {
        id: "C-1",
        partnerId: "P-1",
        contactType: "sales",
        name: "担当者1(quote対象・active)",
        email: "c1@example.com",
        status: "active",
        createdBy: "EMP001",
        createdAt: now,
        updatedBy: "EMP001",
        updatedAt: now,
      },
      {
        id: "C-2",
        partnerId: "P-1",
        contactType: "sales",
        name: "担当者2(quote対象だがtemporary)",
        email: "c2@example.com",
        status: "temporary",
        createdBy: "EMP001",
        createdAt: now,
        updatedBy: "EMP001",
        updatedAt: now,
      },
      {
        id: "C-3",
        partnerId: "P-1",
        contactType: "sales",
        name: "担当者3(active だが quote対象外)",
        email: "c3@example.com",
        status: "active",
        createdBy: "EMP001",
        createdAt: now,
        updatedBy: "EMP001",
        updatedAt: now,
      },
    ]);
    await db.insert(schema.partnerContactDocumentTypes).values([
      { contactId: "C-1", documentType: "quote" },
      { contactId: "C-2", documentType: "quote" },
      { contactId: "C-3", documentType: "sales_order" },
    ]);

    const contacts = await findActiveContactsByPartnerId(db, "P-1", "quote");

    expect(contacts).toEqual([{ name: "担当者1(quote対象・active)", email: "c1@example.com" }]);
  });

  it("該当する担当者が無ければ空配列を返す", async () => {
    expect(await findActiveContactsByPartnerId(db, "P-1", "quote")).toEqual([]);
  });
});

describe("findPartnerNames", () => {
  it("取引先ID => 取引先名のMapを返す(該当しないIDは含まれない)", async () => {
    await db.insert(schema.partners).values([
      { id: "P-1", name: "取引先1", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
      { id: "P-2", name: "取引先2", createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now },
    ]);

    const names = await findPartnerNames(db, ["P-1", "P-2", "nope"]);

    expect(names.get("P-1")).toBe("取引先1");
    expect(names.get("P-2")).toBe("取引先2");
    expect(names.size).toBe(2);
  });
});

describe("findUserNames", () => {
  it("社員番号 => 氏名のMapを返す", async () => {
    await db.insert(schema.users).values([
      { id: "user-001", employeeNumber: "EMP001", email: "e1@example.com", name: "ユーザー1", createdAt: now, updatedAt: now },
      { id: "user-002", employeeNumber: "EMP002", email: "e2@example.com", name: "ユーザー2", createdAt: now, updatedAt: now },
    ]);

    const names = await findUserNames(db, ["EMP001", "EMP002"]);

    expect(names.get("EMP001")).toBe("ユーザー1");
    expect(names.get("EMP002")).toBe("ユーザー2");
  });
});

describe("findItemAccountCodes", () => {
  it("品目ID => 勘定科目コードのMapを返す(未設定・未登録の品目は含まれない)", async () => {
    await db.insert(schema.units).values({
      code: "PCS",
      name: "個",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.accounts).values({
      code: "4000",
      name: "売上高",
      createdBy: "EMP001",
      createdAt: now,
      updatedBy: "EMP001",
      updatedAt: now,
    });
    await db.insert(schema.items).values([
      {
        id: "ITEM-1",
        name: "品目1",
        baseUnitCode: "PCS",
        accountCode: "4000",
        createdBy: "EMP001",
        createdAt: now,
        updatedBy: "EMP001",
        updatedAt: now,
      },
      {
        id: "ITEM-2",
        name: "品目2(勘定科目未設定)",
        baseUnitCode: "PCS",
        createdBy: "EMP001",
        createdAt: now,
        updatedBy: "EMP001",
        updatedAt: now,
      },
    ]);

    const codes = await findItemAccountCodes(db, ["ITEM-1", "ITEM-2", "nope"]);

    expect(codes.get("ITEM-1")).toBe("4000");
    expect(codes.get("ITEM-2")).toBeNull();
    expect(codes.has("nope")).toBe(false);
  });

  it("itemIdsが空なら空のMapを返す", async () => {
    expect(await findItemAccountCodes(db, [])).toEqual(new Map());
  });
});
