import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";
import { partnerContactDocumentTypeSchema } from "../../../constants/contact-document-types";

// V-5: メールで送る帳票。作成時に省略すると、isEmailTargetがtrueなら全帳票・falseなら送らない設定にする
// (旧クライアント・CSVとの互換)。更新時に省略すると既存の設定を変えない。空配列は「どの帳票も送らない」
const documentTypesSchema = v.optional(v.array(partnerContactDocumentTypeSchema));

// 検索クエリ用スキーマ
export const querySchema = v.object({
  partnerId: v.optional(v.string()),
  name: v.optional(v.string()),
  status: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// 単体登録用スキーマ
export const createContactSchema = v.object({
  // マスタコード自動採番: 未入力(null)の場合はサービス層でmaster_code_formatsの設定に基づき自動採番する
  id: v.optional(v.nullable(v.string())),
  partnerId: requiredString("取引先IDは必須です"),
  contactType: requiredString("連絡先種別は必須です"),
  internalUserId: v.nullable(v.string()),
  name: v.nullable(v.string()),
  email: v.nullable(
    v.pipe(v.string(), v.email("不正なメールアドレス形式です")),
  ),
  phone: v.nullable(v.string()),
  fax: v.nullable(v.string()),
  departmentName: v.nullable(v.string()),
  isEmailTarget: v.boolean(),
  documentTypes: documentTypesSchema,
  memo: v.nullable(v.string()),
});

// 更新用スキーマ（ID以外の項目）
export const updateContactSchema = v.object({
  partnerId: requiredString("取引先IDは必須です"),
  contactType: requiredString("連絡先種別は必須です"),
  internalUserId: v.nullable(v.string()),
  name: v.nullable(v.string()),
  email: v.nullable(
    v.pipe(v.string(), v.email("不正なメールアドレス形式です")),
  ),
  phone: v.nullable(v.string()),
  fax: v.nullable(v.string()),
  departmentName: v.nullable(v.string()),
  isEmailTarget: v.boolean(),
  documentTypes: documentTypesSchema,
  memo: v.nullable(v.string()),
  status: requiredString("ステータスは必須です"),
});

export type CreateContactInput = v.InferOutput<typeof createContactSchema>;
export type UpdateContactInput = v.InferOutput<typeof updateContactSchema>;
export type QueryInput = v.InferOutput<typeof querySchema>;
