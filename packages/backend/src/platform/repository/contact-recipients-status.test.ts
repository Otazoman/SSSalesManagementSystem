import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { PARTNER_CONTACT_DOCUMENT_TYPES } from "../../constants/contact-document-types";
import { QuoteRepository } from "../../routes/sales/quotes/quote.repository";
import { SalesOrderRepository } from "../../routes/sales/orders/sales-order.repository";
import { PurchaseOrderRepository } from "../../routes/purchase/orders/purchase-order.repository";
import { BillingRepository } from "../../routes/sales/billing/billing.repository";
import { SalesInvoiceRepository } from "../../routes/sales/invoices/sales-invoice.repository";
import { PartnerContactsRepository } from "../../routes/master/partner-contacts/partner-contacts.repository";

/**
 * V-5: 帳票のメール・OTP宛先は、その帳票を送る設定で「有効(active)」の担当者だけ。
 * 仮登録(temporary)・無効(suspended)の担当者は、帳票の設定があっても宛先にしない。
 */

const PARTNER_ID = "P-RCPT";
const db = drizzle(env.DB, { schema });
const audit = {
  createdBy: "EMP001",
  createdAt: new Date(),
  updatedBy: "EMP001",
  updatedAt: new Date(),
};

beforeAll(async () => {
  await db
    .insert(schema.partners)
    .values({ id: PARTNER_ID, name: "宛先テスト取引先", ...audit });
  const contacts = (["active", "temporary", "suspended"] as const).map(
    (status) => ({
      id: `PC-RCPT-${status}`,
      partnerId: PARTNER_ID,
      contactType: "SALES",
      email: `${status}@example.com`,
      status,
      ...audit,
    }),
  );
  await db.insert(schema.partnerContacts).values(contacts);
  await db.insert(schema.partnerContactDocumentTypes).values(
    contacts.flatMap((c) =>
      PARTNER_CONTACT_DOCUMENT_TYPES.map((documentType) => ({
        contactId: c.id,
        documentType,
      })),
    ),
  );
});

const emailsOf = (rows: { email: string | null }[]) =>
  rows.map((r) => r.email);

describe("帳票の宛先は有効(active)な担当者だけ", () => {
  it("見積", async () => {
    const rows = await new QuoteRepository(env.DB).findActiveContactsByPartnerId(PARTNER_ID);
    expect(emailsOf(rows)).toEqual(["active@example.com"]);
  });

  it("受注(注文請書)", async () => {
    const rows = await new SalesOrderRepository(env.DB).findActiveContactsByPartnerId(PARTNER_ID);
    expect(emailsOf(rows)).toEqual(["active@example.com"]);
  });

  it("発注", async () => {
    const rows = await new PurchaseOrderRepository(env.DB).findActiveContactsByPartnerId(PARTNER_ID);
    expect(emailsOf(rows)).toEqual(["active@example.com"]);
  });

  it("請求", async () => {
    const rows = await new BillingRepository(env.DB).findActiveContactsByPartnerId(PARTNER_ID);
    expect(emailsOf(rows)).toEqual(["active@example.com"]);
  });

  it("売上関連書類(内訳ごと)", async () => {
    const repo = new SalesInvoiceRepository(env.DB);
    for (const type of ["SALE", "RETURN", "DISCOUNT", "CORRECTION"]) {
      const rows = await repo.findActiveContactsByPartnerId(PARTNER_ID, type);
      expect(emailsOf(rows)).toEqual(["active@example.com"]);
    }
  });

  it("納品書・検収書(従来から有効のみ)", async () => {
    const repo = new PartnerContactsRepository(env.DB);
    for (const type of ["delivery_note", "acceptance_inspection"] as const) {
      const rows = await repo.findActiveContactsForDocument(PARTNER_ID, type);
      expect(emailsOf(rows)).toEqual(["active@example.com"]);
    }
  });
});
