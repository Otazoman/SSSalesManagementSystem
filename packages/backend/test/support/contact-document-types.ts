import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import {
  PARTNER_CONTACT_DOCUMENT_TYPES,
  WAREHOUSE_CONTACT_DOCUMENT_TYPES,
} from "../../src/constants/contact-document-types";

/**
 * テスト用: isEmailTarget=true の担当者(取引先・倉庫)へ、全帳票を送る設定を作る。
 * 本番のmigration(0087)が既存データへ行う移行と同じ考え方で、担当者を直接INSERTした後に呼ぶ。
 * 帳票の宛先は担当者マスタの帳票設定(partner/warehouse_contact_document_types)だけで決まるため、
 * メール送信・OTPダウンロードのテストは担当者を作った後にこれを呼ぶ必要がある。
 */
export async function grantAllDocumentTypesToEmailTargets(d1: D1Database) {
  const db = drizzle(d1, { schema });

  const partnerContacts = await db
    .select({ id: schema.partnerContacts.id })
    .from(schema.partnerContacts)
    .where(eq(schema.partnerContacts.isEmailTarget, true));
  for (const contact of partnerContacts) {
    await db
      .insert(schema.partnerContactDocumentTypes)
      .values(PARTNER_CONTACT_DOCUMENT_TYPES.map((documentType) => ({ contactId: contact.id, documentType })))
      .onConflictDoNothing();
  }

  const warehouseContacts = await db
    .select({ id: schema.warehouseContacts.id })
    .from(schema.warehouseContacts)
    .where(eq(schema.warehouseContacts.isEmailTarget, true));
  for (const contact of warehouseContacts) {
    await db
      .insert(schema.warehouseContactDocumentTypes)
      .values(WAREHOUSE_CONTACT_DOCUMENT_TYPES.map((documentType) => ({ contactId: contact.id, documentType })))
      .onConflictDoNothing();
  }
}
