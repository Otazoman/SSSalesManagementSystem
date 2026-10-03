import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";
import { warehouseContactDocumentTypeSchema } from "../../../constants/contact-document-types";

// V-5: メールで送る帳票(出荷指示書・入荷指示書)。作成時に省略するとisEmailTargetに従い全帳票/送らない、
// 更新時に省略すると既存の設定を変えない。空配列は「どの帳票も送らない」
const documentTypesSchema = v.optional(v.array(warehouseContactDocumentTypeSchema));

// Item6 Phase6-4: 倉庫マスタの複数連絡先(OTPダウンロード宛先)。partner-contacts.schema.tsと同型
export const querySchema = v.object({
  warehouseId: v.optional(v.string()),
  status: v.optional(v.string()),
});

export const createWarehouseContactSchema = v.object({
  warehouseId: requiredString("倉庫IDは必須です"),
  name: v.nullable(v.string()),
  email: v.nullable(v.pipe(v.string(), v.email("不正なメールアドレス形式です"))),
  phone: v.nullable(v.string()),
  isEmailTarget: v.boolean(),
  documentTypes: documentTypesSchema,
  memo: v.nullable(v.string()),
});

export const updateWarehouseContactSchema = v.object({
  name: v.nullable(v.string()),
  email: v.nullable(v.pipe(v.string(), v.email("不正なメールアドレス形式です"))),
  phone: v.nullable(v.string()),
  isEmailTarget: v.boolean(),
  documentTypes: documentTypesSchema,
  memo: v.nullable(v.string()),
  status: requiredString("ステータスは必須です"),
});

export type CreateWarehouseContactInput = v.InferOutput<typeof createWarehouseContactSchema>;
export type UpdateWarehouseContactInput = v.InferOutput<typeof updateWarehouseContactSchema>;
export type QueryInput = v.InferOutput<typeof querySchema>;
