import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { buildDocumentFileName, isValidFileNamePrefix, resolveDocumentFileName } from "./document-file-name";

const db = drizzle(env.DB, { schema });

async function seedTemplate(id: string, fileNamePrefix: string | null) {
  await db.delete(schema.mailTemplateSettings).where(eq(schema.mailTemplateSettings.id, id));
  await db.insert(schema.mailTemplateSettings).values({
    id,
    name: id,
    subjectTemplate: "s",
    bodyTemplate: "b",
    fileNamePrefix,
    updatedAt: new Date(),
  });
}

beforeEach(async () => {
  await db.delete(schema.mailTemplateSettings);
});

describe("document-file-name", () => {
  it("未設定なら既定の日本語名(従来と同じ)", async () => {
    expect(await resolveDocumentFileName(env.DB, "sales_quote", "QT-1")).toBe("見積書_QT-1.pdf");
    await seedTemplate("sales_quote", null);
    expect(await resolveDocumentFileName(env.DB, "sales_quote", "QT-1")).toBe("見積書_QT-1.pdf");
    expect(await resolveDocumentFileName(env.DB, "sales_invoice", "SH-1")).toBe("納品書_SH-1.pdf"); // sales_invoice=納品書
    expect(await resolveDocumentFileName(env.DB, "sales_recognition", "SI-1")).toBe("売上計上書_SI-1.pdf");
    expect(await resolveDocumentFileName(env.DB, "purchase_recognition", "PC-1")).toBe("仕入計上書_PC-1.pdf");
  });

  it("設定されたプレフィックスが使われる。保存値に禁止文字が残っていても取り除く", async () => {
    await seedTemplate("billing_invoice", "御請求書");
    expect(await resolveDocumentFileName(env.DB, "billing_invoice", "B-1")).toBe("御請求書_B-1.pdf");
    await seedTemplate("billing_invoice", "a/b:c");
    expect(await resolveDocumentFileName(env.DB, "billing_invoice", "B-1")).toBe("abc_B-1.pdf");
  });

  it("形式検証と組み立て", () => {
    expect(isValidFileNamePrefix("御見積書")).toBe(true);
    expect(isValidFileNamePrefix("a*b")).toBe(false);
    expect(isValidFileNamePrefix("あ".repeat(31))).toBe(false);
    expect(buildDocumentFileName("見積", "X")).toBe("見積_X.pdf");
  });
});
