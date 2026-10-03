import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import {
  partnerContactReceivesDocument,
  warehouseContactReceivesDocument,
} from "./contact-document-conditions";
import { salesInvoiceContactDocumentType } from "../../constants/contact-document-types";

const db = drizzle(env.DB, { schema });
const audit = { createdBy: "EMP001", createdAt: new Date(), updatedBy: "EMP001", updatedAt: new Date() };

async function partnerRecipients(documentType: Parameters<typeof partnerContactReceivesDocument>[0]) {
  const rows = await db
    .select({ id: schema.partnerContacts.id })
    .from(schema.partnerContacts)
    .where(and(eq(schema.partnerContacts.partnerId, "P-CDC"), partnerContactReceivesDocument(documentType)));
  return rows.map((r) => r.id).sort();
}

describe("V-5: 帳票ごとのメール宛先の絞り込み", () => {
  beforeAll(async () => {
    await db.insert(schema.partners).values({ id: "P-CDC", name: "帳票宛先テスト", ...audit });
    await db.insert(schema.partnerContacts).values([
      // isEmailTargetはシステム通知用。帳票の宛先には使われない(A/Bはtrueでも帳票設定に従う、Dはfalseでも設定があれば宛先)
      { id: "PC-CDC-A", partnerId: "P-CDC", contactType: "SALES", email: "a@example.com", isEmailTarget: true, ...audit },
      { id: "PC-CDC-B", partnerId: "P-CDC", contactType: "SALES", email: "b@example.com", isEmailTarget: true, ...audit },
      { id: "PC-CDC-C", partnerId: "P-CDC", contactType: "SALES", email: "c@example.com", isEmailTarget: true, ...audit },
      { id: "PC-CDC-D", partnerId: "P-CDC", contactType: "SALES", email: "d@example.com", isEmailTarget: false, ...audit },
    ]);
    await db.insert(schema.partnerContactDocumentTypes).values([
      { contactId: "PC-CDC-A", documentType: "quote" },
      { contactId: "PC-CDC-C", documentType: "quote" },
      { contactId: "PC-CDC-C", documentType: "billing" },
      { contactId: "PC-CDC-D", documentType: "billing" },
    ]);

    await db.insert(schema.warehouses).values({ id: "W-CDC", name: "帳票宛先倉庫", ...audit });
    await db.insert(schema.warehouseContacts).values([
      { id: "WC-CDC-A", warehouseId: "W-CDC", email: "wa@example.com", ...audit },
      { id: "WC-CDC-B", warehouseId: "W-CDC", email: "wb@example.com", ...audit },
    ]);
    await db.insert(schema.warehouseContactDocumentTypes).values([
      { contactId: "WC-CDC-A", documentType: "shipment_instruction" },
      { contactId: "WC-CDC-B", documentType: "receipt_instruction" },
    ]);
  });

  it("その帳票を送る設定の担当者だけが宛先になる", async () => {
    expect(await partnerRecipients("quote")).toEqual(["PC-CDC-A", "PC-CDC-C"]);
    expect(await partnerRecipients("billing")).toEqual(["PC-CDC-C", "PC-CDC-D"]);
  });

  it("帳票を1つも選んでいない担当者は、isEmailTargetがtrueでも宛先にならない", async () => {
    for (const type of ["quote", "billing", "sales_order", "delivery_note"] as const) {
      expect(await partnerRecipients(type)).not.toContain("PC-CDC-B");
    }
  });

  it("設定のない帳票の宛先は空になる", async () => {
    expect(await partnerRecipients("purchase_order")).toEqual([]);
  });

  it("倉庫担当者も指示書ごとに絞り込まれる", async () => {
    const recipients = async (t: Parameters<typeof warehouseContactReceivesDocument>[0]) =>
      (
        await db
          .select({ id: schema.warehouseContacts.id })
          .from(schema.warehouseContacts)
          .where(and(eq(schema.warehouseContacts.warehouseId, "W-CDC"), warehouseContactReceivesDocument(t)))
      ).map((r) => r.id);
    expect(await recipients("shipment_instruction")).toEqual(["WC-CDC-A"]);
    expect(await recipients("receipt_instruction")).toEqual(["WC-CDC-B"]);
  });

  it("担当者を削除すると帳票設定も連動して消える", async () => {
    await db.delete(schema.partnerContacts).where(eq(schema.partnerContacts.id, "PC-CDC-D"));
    const rows = await db
      .select()
      .from(schema.partnerContactDocumentTypes)
      .where(eq(schema.partnerContactDocumentTypes.contactId, "PC-CDC-D"));
    expect(rows).toEqual([]);
  });
});

describe("salesInvoiceContactDocumentType", () => {
  it("売上関連書類の内訳を帳票種別へ対応づける(未知・未指定は売上)", () => {
    expect(salesInvoiceContactDocumentType("SALE")).toBe("sales_invoice_sale");
    expect(salesInvoiceContactDocumentType("RETURN")).toBe("sales_invoice_return");
    expect(salesInvoiceContactDocumentType("DISCOUNT")).toBe("sales_invoice_discount");
    expect(salesInvoiceContactDocumentType("CORRECTION")).toBe("sales_invoice_correction");
    expect(salesInvoiceContactDocumentType(null)).toBe("sales_invoice_sale");
    expect(salesInvoiceContactDocumentType("UNKNOWN")).toBe("sales_invoice_sale");
  });
});

// migration 0087 の移行(既存のisEmailTarget=trueの担当者へ全帳票を付与)を、実際のSQLファイルで検証する
import migration0087 from "../../../drizzle/main/0087_boring_bruce_banner.sql?raw";
import {
  PARTNER_CONTACT_DOCUMENT_TYPES,
  WAREHOUSE_CONTACT_DOCUMENT_TYPES,
} from "../../constants/contact-document-types";

describe("migration 0087: 既存担当者への帳票設定の移行", () => {
  it("isEmailTarget=trueの担当者だけに全帳票が付与され、falseの担当者には付与されない", async () => {
    // 前のテストで作った帳票設定と重複しないよう、移行前の状態(帳票設定が空)にしてから実行する
    await db.delete(schema.partnerContactDocumentTypes);
    await db.delete(schema.warehouseContactDocumentTypes);
    await db.insert(schema.partners).values({ id: "P-MIG", name: "移行テスト", ...audit });
    await db.insert(schema.partnerContacts).values([
      { id: "PC-MIG-ON", partnerId: "P-MIG", contactType: "SALES", isEmailTarget: true, ...audit },
      { id: "PC-MIG-OFF", partnerId: "P-MIG", contactType: "SALES", isEmailTarget: false, ...audit },
    ]);
    await db.insert(schema.warehouses).values({ id: "W-MIG", name: "移行テスト倉庫", ...audit });
    await db.insert(schema.warehouseContacts).values([
      { id: "WC-MIG-ON", warehouseId: "W-MIG", isEmailTarget: true, ...audit },
      { id: "WC-MIG-OFF", warehouseId: "W-MIG", isEmailTarget: false, ...audit },
    ]);

    const inserts = migration0087
      .split("--> statement-breakpoint")
      .map((chunk) =>
        chunk
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((stmt) => stmt.startsWith("INSERT INTO"));
    expect(inserts).toHaveLength(PARTNER_CONTACT_DOCUMENT_TYPES.length + WAREHOUSE_CONTACT_DOCUMENT_TYPES.length);
    for (const stmt of inserts) {
      await env.DB.prepare(stmt).run();
    }

    const partnerTypes = async (id: string) =>
      (
        await db
          .select({ t: schema.partnerContactDocumentTypes.documentType })
          .from(schema.partnerContactDocumentTypes)
          .where(eq(schema.partnerContactDocumentTypes.contactId, id))
      )
        .map((r) => r.t)
        .sort();
    const warehouseTypes = async (id: string) =>
      (
        await db
          .select({ t: schema.warehouseContactDocumentTypes.documentType })
          .from(schema.warehouseContactDocumentTypes)
          .where(eq(schema.warehouseContactDocumentTypes.contactId, id))
      )
        .map((r) => r.t)
        .sort();

    expect(await partnerTypes("PC-MIG-ON")).toEqual([...PARTNER_CONTACT_DOCUMENT_TYPES].sort());
    expect(await partnerTypes("PC-MIG-OFF")).toEqual([]);
    expect(await warehouseTypes("WC-MIG-ON")).toEqual([...WAREHOUSE_CONTACT_DOCUMENT_TYPES].sort());
    expect(await warehouseTypes("WC-MIG-OFF")).toEqual([]);
  });
});
