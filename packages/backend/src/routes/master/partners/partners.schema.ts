import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

// 💡 数値項目：null, undefined, 空文字(""), 欠落キー が来たら自動的に 0 (number) に変換
const numberWithDefault = v.pipe(
  v.unknown(),
  v.transform((val) => {
    if (val === null || val === undefined || val === "") return 0;
    const num = Number(val);
    return Number.isNaN(num) ? 0 : num;
  }),
);

// 💡 文字列項目：null, undefined, 空文字(""), 欠落キー が来たら null に変換
const nullableString = v.pipe(
  v.unknown(),
  v.transform((val) => {
    if (val === null || val === undefined) return null;
    const str = String(val).trim();
    return str === "" ? null : str;
  }),
);

// 💡 日付項目：JSON経由では文字列で届くため、DBのtimestampカラム(Dateインスタンス必須)に
// 合わせてここで変換する。null, undefined, 空文字、不正な日付文字列は null に変換。
// (contractDate/contractValidToがlooseObjectの型未宣言フィールドとして生の文字列のまま
// repositoryへ渡り、drizzleのtimestampマッパーで"e.getTime is not a function"としてcrash
// していた不具合の修正。partners.adapter.tsのapplyApproved()では元々同様の変換をしていた)
const nullableDate = v.pipe(
  v.unknown(),
  v.transform((val) => {
    if (val === null || val === undefined || val === "") return null;
    const date = val instanceof Date ? val : new Date(val as string | number);
    return Number.isNaN(date.getTime()) ? null : date;
  }),
);

// ➕ 添付ファイル用のスキーマ定義
export const attachmentSchema = v.object({
  id: v.optional(nullableString),
  fileName: requiredString("ファイル名は必須です"),
  storageType: v.optional(nullableString), // "R2" | "URL" 等
  attachmentR2Path: v.optional(nullableString),
  externalUrl: v.optional(nullableString),
  fileType: v.optional(nullableString), // "OTHER" 等
});

// ➕ ファームバンキング: 振込先口座用のスキーマ定義(全銀「総合振込」フォーマット生成に使う)
export const bankAccountSchema = v.object({
  id: v.optional(nullableString),
  bankName: requiredString("銀行名は必須です"),
  bankCode: v.optional(nullableString),
  branchName: requiredString("支店名は必須です"),
  branchCode: v.optional(nullableString),
  accountType: v.optional(nullableString), // "ORDINARY"(普通) | "CURRENT"(当座)
  accountNumber: requiredString("口座番号は必須です"),
  accountHolderName: requiredString("受取人名(カナ)は必須です"),
  isDefault: v.optional(v.boolean(), false),
  memo: v.optional(nullableString),
});

export const querySchema = v.object({
  id: v.optional(nullableString),
  name: v.optional(nullableString),
  nameMode: v.optional(nullableString), // "partial" | "exact"
  type: v.optional(nullableString), // "CUSTOMER" | "SUPPLIER" | "BOTH"
  status: v.optional(nullableString), // "active" | "temporary" | "suspended" | "all"
  sortBy: v.optional(nullableString),
  sortOrder: v.optional(nullableString),
});

// 追加要望L-4-a: 適格事業者番号(T+13桁の数字)・法人番号(13桁の数字)。空文字/null=未登録
const qualifiedInvoiceNumberSchema = v.nullable(
  v.pipe(
    v.string(),
    v.trim(),
    v.check((s) => s === "" || /^T\d{13}$/.test(s), "適格事業者番号は「T」+13桁の数字で入力してください"),
  ),
);
const corporateNumberSchema = v.nullable(
  v.pipe(
    v.string(),
    v.trim(),
    v.check((s) => s === "" || /^\d{13}$/.test(s), "法人番号は13桁の数字で入力してください"),
  ),
);

export const createPartnerSchema = v.looseObject({
  // マスタコード自動採番: 未入力(null)の場合はサービス層でmaster_code_formatsの設定に基づき自動採番する
  id: v.optional(nullableString),
  name: requiredString("取引先名は必須です"),
  type: requiredString("種別は必須です"),
  postalCode: v.optional(nullableString),
  address: v.optional(nullableString),
  phone: v.optional(nullableString),
  fax: v.optional(nullableString),
  creditLimit: v.optional(numberWithDefault),
  closingDay: v.optional(numberWithDefault),
  paymentMonthOffset: v.optional(numberWithDefault),
  paymentDay: v.optional(numberWithDefault),
  paymentMethod: v.optional(nullableString),
  qualifiedInvoiceNumber: v.optional(qualifiedInvoiceNumberSchema),
  corporateNumber: v.optional(corporateNumberSchema),
  status: requiredString("ステータスは必須です"),
  memo: v.optional(nullableString),
  contractDate: v.optional(nullableDate),
  contractValidTo: v.optional(nullableDate),
  attachments: v.optional(v.array(attachmentSchema)), // ➕ 追加
  bankAccounts: v.optional(v.array(bankAccountSchema)), // ➕ ファームバンキング用口座
});

export const updatePartnerSchema = v.looseObject({
  name: requiredString("取引先名は必須です"),
  type: requiredString("種別は必須です"),
  postalCode: v.optional(nullableString),
  address: v.optional(nullableString),
  phone: v.optional(nullableString),
  fax: v.optional(nullableString),
  creditLimit: v.optional(numberWithDefault),
  closingDay: v.optional(numberWithDefault),
  paymentMonthOffset: v.optional(numberWithDefault),
  paymentDay: v.optional(numberWithDefault),
  paymentMethod: v.optional(nullableString),
  qualifiedInvoiceNumber: v.optional(qualifiedInvoiceNumberSchema),
  corporateNumber: v.optional(corporateNumberSchema),
  status: requiredString("ステータスは必須です"),
  memo: v.optional(nullableString),
  contractDate: v.optional(nullableDate),
  contractValidTo: v.optional(nullableDate),
  attachments: v.optional(v.array(attachmentSchema)), // ➕ 追加
  bankAccounts: v.optional(v.array(bankAccountSchema)), // ➕ ファームバンキング用口座
});

export type CreatePartnerInput = v.InferOutput<typeof createPartnerSchema>;
export type UpdatePartnerInput = v.InferOutput<typeof updatePartnerSchema>;
export type QueryInput = v.InferOutput<typeof querySchema>;
export type AttachmentInput = v.InferOutput<typeof attachmentSchema>;
export type BankAccountInput = v.InferOutput<typeof bankAccountSchema>;
