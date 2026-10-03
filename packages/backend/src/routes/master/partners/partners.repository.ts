import { drizzle } from "drizzle-orm/d1";
import { eq, and, count } from "drizzle-orm";
import { Context } from "hono";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import {
  CreatePartnerInput,
  UpdatePartnerInput,
  QueryInput,
  AttachmentInput,
  BankAccountInput,
} from "./partners.schema";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { combineConditions } from "../../../platform/repository/search-conditions";
import { PaginationParams, toOffset } from "../../../platform/http/pagination";
import { buildOrderBy, SortQuery } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";

// ヘッダクリックソート(追加要望D)の許可カラム
const PARTNERS_SORT_COLUMNS = {
  id: schema.partners.id,
  name: schema.partners.name,
  type: schema.partners.type,
  status: schema.partners.status,
  address: schema.partners.address,
};

export class PartnersRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async getFallbackOperatorId(c: Context<{ Bindings: Env }>): Promise<string> {
    return resolveOperatorEmployeeNumber(c, this.db);
  }

  private buildConditions(query: QueryInput) {
    const conditions = [];

    if (query.id && query.id.trim() !== "") {
      conditions.push(containsText(schema.partners.id, query.id.trim()));
    }

    if (query.name && query.name.trim() !== "") {
      if (query.nameMode === "exact") {
        conditions.push(eq(schema.partners.name, query.name.trim()));
      } else {
        conditions.push(containsText(schema.partners.name, query.name.trim()));
      }
    }

    if (query.type && query.type.trim() !== "") {
      conditions.push(eq(schema.partners.type, query.type.trim()));
    }

    if (
      query.status &&
      query.status.trim() !== "" &&
      query.status.trim() !== "all"
    ) {
      conditions.push(eq(schema.partners.status, query.status.trim()));
    }

    return conditions;
  }

  private async attachFiles<T extends { id: string }>(partners: T[]) {
    return await Promise.all(
      partners.map(async (partner) => {
        const attachments = await this.findAttachmentsByPartnerId(partner.id);
        const bankAccounts = await this.findBankAccountsByPartnerId(partner.id);
        return { ...partner, attachments, bankAccounts };
      }),
    );
  }

  async findMany(query: QueryInput, sort: SortQuery = {}) {
    const orderBy = buildOrderBy(sort, PARTNERS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.partners)
      .where(combineConditions(this.buildConditions(query)));
    const partners = await (orderBy ? base.orderBy(...orderBy) : base);

    return await this.attachFiles(partners);
  }

  async findManyPage(
    query: QueryInput,
    params: PaginationParams,
    sort: SortQuery = {},
  ) {
    const orderBy = buildOrderBy(sort, PARTNERS_SORT_COLUMNS);
    const base = this.db
      .select()
      .from(schema.partners)
      .where(combineConditions(this.buildConditions(query)));
    const q = orderBy ? base.orderBy(...orderBy) : base;
    const partners = await q.limit(params.limit).offset(toOffset(params));

    return await this.attachFiles(partners);
  }

  async countMany(query: QueryInput): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(schema.partners)
      .where(combineConditions(this.buildConditions(query)));
    return result[0]?.value || 0;
  }

  async findById(id: string) {
    const result = await this.db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.id, id))
      .limit(1);
    return result[0] || null;
  }

  // ➕ 添付ファイル取得ヘルパー
  async findAttachmentsByPartnerId(partnerId: string) {
    return await this.db
      .select()
      .from(schema.partnerAttachments)
      .where(eq(schema.partnerAttachments.partnerId, partnerId));
  }

  // ➕ 指定した取引先に属する添付ファイルを1件取得(他取引先のファイルは取得できない)
  async findAttachmentByIdAndPartnerId(attachmentId: string, partnerId: string) {
    const res = await this.db
      .select()
      .from(schema.partnerAttachments)
      .where(
        and(
          eq(schema.partnerAttachments.id, attachmentId),
          eq(schema.partnerAttachments.partnerId, partnerId),
        ),
      )
      .limit(1);
    return res[0] || null;
  }

  // ➕ ファームバンキング: 振込先口座取得ヘルパー
  async findBankAccountsByPartnerId(partnerId: string) {
    return await this.db
      .select()
      .from(schema.partnerBankAccounts)
      .where(eq(schema.partnerBankAccounts.partnerId, partnerId));
  }

  // マスタコード自動採番: 呼び出し元(PartnersService.create)がidを解決済みの前提のため、
  // ここではidをstring必須として受ける(スキーマ上はoptionalだが、未解決のまま渡さないよう強制する)
  async create(data: CreatePartnerInput & { id: string }, operatorId: string) {
    const now = new Date();
    // 取引先本データの挿入
    const { attachments, bankAccounts, ...partnerData } = data;

    // BUG-048: 取引先・添付・振込先口座は1回の batch で登録する
    await this.db.batch([
      this.db.insert(schema.partners).values({
      ...partnerData,
      creditLimit: partnerData.creditLimit ?? 0,
      closingDay: partnerData.closingDay ?? 0,
      paymentMonthOffset: partnerData.paymentMonthOffset ?? 0,
      paymentDay: partnerData.paymentDay ?? 0,
      qualifiedInvoiceNumber: partnerData.qualifiedInvoiceNumber || null,
      corporateNumber: partnerData.corporateNumber || null,
      createdBy: operatorId,
      createdAt: now,
      updatedBy: operatorId,
      updatedAt: now,
    }),
      // ➕ 添付ファイルの保存
      ...this.attachmentInserts(data.id, attachments, operatorId, now),
      // ➕ ファームバンキング: 振込先口座の保存
      ...this.bankAccountInserts(data.id, bankAccounts, operatorId, now),
    ]);
  }

  async update(id: string, data: UpdatePartnerInput, operatorId: string) {
    const now = new Date();

    // 💡 呼び出し元(例: 取引先マスタ画面の無効化フロー)が既存レコードを丸ごとスプレッドして
    // PUTすることがあり、updatePartnerSchemaがlooseObjectのため`createdAt`等の未宣言フィールドが
    // 生の文字列のまま素通りしてくることがある。以前(...partnerDataでset()に丸ごと渡す実装)は
    // それがそのままSQLのSETに混入し、drizzleのtimestampマッパーが文字列に.getTime()を呼んで
    // "e.getTime is not a function"でクラッシュしていた(取引先無効化時の実際の500エラー)。
    // updatePartnerSchemaで明示宣言されている項目だけを明示的に拾うことで、この種の不正な
    // フィールド混入を経路によらず防ぐ。
    const { attachments, bankAccounts } = data;

    // BUG-048: 取引先の更新と、添付・振込先口座の洗い替え(全削除→再登録)は1回の batch で行う
    // (以前は1つずつ書き込んでいたため、途中で失敗すると振込先口座が消えたままになりえた)
    await this.db.batch([
      this.db
      .update(schema.partners)
      .set({
        name: data.name,
        type: data.type,
        postalCode: data.postalCode,
        address: data.address,
        phone: data.phone,
        fax: data.fax,
        creditLimit: data.creditLimit ?? 0,
        closingDay: data.closingDay ?? 0,
        paymentMonthOffset: data.paymentMonthOffset ?? 0,
        paymentDay: data.paymentDay ?? 0,
        paymentMethod: data.paymentMethod,
        // 追加要望L-4-a: 項目を送らない呼び出し(既存レコードのspread等)で既存の値を消さないよう、指定時のみ更新する
        ...(data.qualifiedInvoiceNumber !== undefined && { qualifiedInvoiceNumber: data.qualifiedInvoiceNumber || null }),
        ...(data.corporateNumber !== undefined && { corporateNumber: data.corporateNumber || null }),
        status: data.status,
        memo: data.memo,
        contractDate: data.contractDate,
        contractValidTo: data.contractValidTo,
        updatedBy: operatorId,
        updatedAt: now,
      })
      .where(eq(schema.partners.id, id)),
      // ➕ 既存添付ファイルを一旦全削除（洗い替え）後、再インサート
      this.db.delete(schema.partnerAttachments).where(eq(schema.partnerAttachments.partnerId, id)),
      ...this.attachmentInserts(id, attachments, operatorId, now),
      // ➕ ファームバンキング: 振込先口座も同様に洗い替え
      this.db.delete(schema.partnerBankAccounts).where(eq(schema.partnerBankAccounts.partnerId, id)),
      ...this.bankAccountInserts(id, bankAccounts, operatorId, now),
    ]);
  }

  // ➕ 添付ファイル一括登録ヘルパー
  // BUG-048: 書き込み文を返す(呼び出し側で1回の batch にまとめる)
  private attachmentInserts(
    partnerId: string,
    attachments: AttachmentInput[] | undefined,
    operatorId: string,
    now: Date,
  ) {
    return (attachments ?? []).map((att) =>
      this.db.insert(schema.partnerAttachments).values({
        id:
          att.id ||
          `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        partnerId,
        fileName: att.fileName,
        storageType: att.storageType || "R2",
        attachmentR2Path: att.attachmentR2Path || null,
        externalUrl: att.externalUrl || null,
        fileType: att.fileType || "OTHER",
        uploadedById: operatorId,
        uploadedAt: now,
      }),
    );
  }

  // ➕ ファームバンキング: 振込先口座一括登録ヘルパー
  private bankAccountInserts(
    partnerId: string,
    bankAccounts: BankAccountInput[] | undefined,
    operatorId: string,
    now: Date,
  ) {
    return (bankAccounts ?? []).map((acc) =>
      this.db.insert(schema.partnerBankAccounts).values({
        id: acc.id || `BANK-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        partnerId,
        bankName: acc.bankName,
        bankCode: acc.bankCode || null,
        branchName: acc.branchName,
        branchCode: acc.branchCode || null,
        accountType: acc.accountType || "ORDINARY",
        accountNumber: acc.accountNumber,
        accountHolderName: acc.accountHolderName,
        isDefault: acc.isDefault ?? false,
        memo: acc.memo || null,
        createdBy: operatorId,
        createdAt: now,
        updatedBy: operatorId,
        updatedAt: now,
      }),
    );
  }

  async delete(id: string) {
    // BUG-048: 添付・振込先口座・取引先の削除は1回の batch で行う。伝票で使われている取引先は取引先の削除が
    // 外部キーの制約で失敗するが、以前は先に添付・振込先口座を消していたため、それらだけが消えていた
    await this.db.batch([
      // ➕ 添付ファイルレコードも併せて削除
      this.db.delete(schema.partnerAttachments).where(eq(schema.partnerAttachments.partnerId, id)),
      // ➕ ファームバンキング: 振込先口座も併せて削除(onDelete: cascadeで自動削除されるが、
      // partner_attachments同様に明示削除して意図を明確にする)
      this.db.delete(schema.partnerBankAccounts).where(eq(schema.partnerBankAccounts.partnerId, id)),
      this.db.delete(schema.partners).where(eq(schema.partners.id, id)),
    ]);
  }

  async updateStatus(id: string, status: string, operatorId: string) {
    await this.db
      .update(schema.partners)
      .set({
        status,
        updatedBy: operatorId,
        updatedAt: new Date(),
      })
      .where(eq(schema.partners.id, id));
  }

  async upsertBulkItem(
    item: {
      id: string;
      name: string;
      type: string;
      postalCode: string | null;
      address: string | null;
      phone: string | null;
      fax: string | null;
      creditLimit: number;
      closingDay: number;
      paymentMonthOffset: number;
      paymentDay: number;
      paymentMethod: string | null;
      status: string;
      memo: string | null;
      // 追加要望L-4-a: 旧形式CSV(この2列が無い)ではundefined=既存の値を変更しない
      qualifiedInvoiceNumber?: string | null;
      corporateNumber?: string | null;
    },
    operatorId: string,
    now: Date,
  ) {
    await this.db
      .insert(schema.partners)
      .values({
        ...item,
        creditLimit: item.creditLimit ?? 0,
        closingDay: item.closingDay ?? 0,
        paymentMonthOffset: item.paymentMonthOffset ?? 0,
        paymentDay: item.paymentDay ?? 0,
        createdBy: operatorId,
        createdAt: now,
        updatedBy: operatorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.partners.id,
        set: {
          name: item.name,
          type: item.type,
          postalCode: item.postalCode,
          address: item.address,
          phone: item.phone,
          fax: item.fax,
          creditLimit: item.creditLimit ?? 0,
          closingDay: item.closingDay ?? 0,
          paymentMonthOffset: item.paymentMonthOffset ?? 0,
          paymentDay: item.paymentDay ?? 0,
          paymentMethod: item.paymentMethod,
          ...(item.qualifiedInvoiceNumber !== undefined && { qualifiedInvoiceNumber: item.qualifiedInvoiceNumber }),
          ...(item.corporateNumber !== undefined && { corporateNumber: item.corporateNumber }),
          status: item.status,
          memo: item.memo,
          updatedBy: operatorId,
          updatedAt: now,
        },
      });
  }
}
