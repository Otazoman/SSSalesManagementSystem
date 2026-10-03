// #14-2③: 複数のRepositoryクラスにほぼ同一のまま重複実装されていた、単純なマスタ参照・
// 主キー検索系のクエリを共通化する(fallback-operator.tsのgetFallbackOperatorId()と同じ方針。
// 各Repositoryクラス側は、このファイルの関数へ委譲する1行のメソッドとして残す)。
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { AppDb } from "./fallback-operator";
import { partnerContactReceivesDocument } from "./contact-document-conditions";
import type { PartnerContactDocumentType } from "../../constants/contact-document-types";
import { fetchInChunks } from "./chunked-fetch";

export async function findTaxCategoryRates(db: AppDb): Promise<Map<string, number>> {
  const rows = await db
    .select({ code: schema.taxCategories.code, taxRate: schema.taxCategories.taxRate })
    .from(schema.taxCategories);
  return new Map(rows.map((r) => [r.code, r.taxRate]));
}

export async function findUnitNames(db: AppDb): Promise<Map<string, string>> {
  const rows = await db
    .select({ code: schema.units.code, name: schema.units.name })
    .from(schema.units);
  return new Map(rows.map((r) => [r.code, r.name]));
}

export async function findUserByEmployeeNumber(db: AppDb, employeeNumber: string) {
  const res = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.employeeNumber, employeeNumber))
    .limit(1);
  return res[0] || null;
}

export async function findMailTemplate(db: AppDb, id: string) {
  const res = await db
    .select()
    .from(schema.mailTemplateSettings)
    .where(eq(schema.mailTemplateSettings.id, id))
    .limit(1);
  return res[0] || null;
}

export async function findPartnerById(db: AppDb, id: string) {
  const res = await db.select().from(schema.partners).where(eq(schema.partners.id, id)).limit(1);
  return res[0] || null;
}

// deals.repository.ts(商談)・progress.repository.ts(進捗一覧)で、取引先ID→取引先名の
// Mapを解決する処理が重複していたため共通化(IN句はfetchInChunksでチャンク分割)
export async function findPartnerNames(db: AppDb, ids: string[]): Promise<Map<string, string>> {
  const rows = await fetchInChunks(ids, (chunk) =>
    db
      .select({ id: schema.partners.id, name: schema.partners.name })
      .from(schema.partners)
      .where(inArray(schema.partners.id, chunk)),
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

// 同上。社員番号→氏名のMap
export async function findUserNames(db: AppDb, employeeNumbers: string[]): Promise<Map<string, string>> {
  const rows = await fetchInChunks(employeeNumbers, (chunk) =>
    db
      .select({ employeeNumber: schema.users.employeeNumber, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.employeeNumber, chunk)),
  );
  return new Map(rows.map((r) => [r.employeeNumber, r.name]));
}

// Item8/Item10: 品目連動仕訳(platform/journal/build-journal-lines.ts)の科目解決用。
// 品目マスタに存在しないitemId(DIRECT入力等)はマップに含まれない(呼び出し元でnull扱いにする)
export async function findItemAccountCodes(db: AppDb, itemIds: string[]): Promise<Map<string, string | null>> {
  const validIds = itemIds.filter((id): id is string => !!id);
  if (validIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.items.id, accountCode: schema.items.accountCode })
    .from(schema.items)
    .where(inArray(schema.items.id, validIds));
  return new Map(rows.map((r) => [r.id, r.accountCode]));
}

// V-5: 指定した取引先のうち、指定した帳票種別を「メールで送る」設定になっている
// 有効な担当者(名前・メールアドレスのみ)。documentTypeは呼び出し元の帳票種別ごとに異なる
// (見積="quote"、受注="sales_order"、発注="purchase_order"、請求="billing"等)
export async function findActiveContactsByPartnerId(
  db: AppDb,
  partnerId: string,
  documentType: PartnerContactDocumentType,
) {
  return db
    .select({ name: schema.partnerContacts.name, email: schema.partnerContacts.email })
    .from(schema.partnerContacts)
    .where(
      and(
        eq(schema.partnerContacts.partnerId, partnerId),
        eq(schema.partnerContacts.status, "active"),
        partnerContactReceivesDocument(documentType),
      ),
    );
}
