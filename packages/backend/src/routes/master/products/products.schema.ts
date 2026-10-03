import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

// 添付ファイルの型
export const attachmentSchema = v.object({
  id: v.optional(v.string()),
  fileName: v.string(),
  storageType: v.optional(v.string(), "R2"),
  attachmentR2Path: v.optional(v.nullable(v.string())),
  externalUrl: v.optional(v.nullable(v.string())),
  fileType: v.optional(v.string(), "OTHER"),
});

// 検索用クエリパラメータ
export const searchProductsQuerySchema = v.object({
  id: v.optional(v.string()),
  name: v.optional(v.string()),
  // ▼ v.optional の中に v.optional を重ねるか、v.undefined() を含めることで型上も省略可能にします
  nameMode: v.optional(
    v.union([
      v.literal("partial"),
      v.literal("forward"),
      v.literal("backward"),
      v.literal("exact"),
    ]),
  ),
  barcode: v.optional(v.string()),
  accountCode: v.optional(v.string()),
  status: v.optional(v.string()),
  filter: v.optional(v.string()),
  taxCategoryCode: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// 新規登録用ボディ
export const registerProductSchema = v.object({
  // マスタコード自動採番: 未入力(null)の場合はサービス層でmaster_code_formatsの設定に基づき自動採番する
  id: v.optional(v.nullable(v.string())),
  name: requiredString("品目名は必須です。"),
  isPurchased: v.optional(v.boolean(), false),
  isSales: v.optional(v.boolean(), false),
  isService: v.optional(v.boolean(), false),
  baseUnitCode: v.optional(v.string(), "pcs"),
  taxCategoryCode: v.optional(v.string(), "TAX_10"),
  productBarcode: v.optional(v.nullable(v.string())),
  accountCode: v.optional(v.nullable(v.string())),
  supplierId: v.optional(v.nullable(v.string())),
  supplierPartNumber: v.optional(v.nullable(v.string())),
  memo: v.optional(v.nullable(v.string())),
  standardSalesPrice: v.optional(v.union([v.number(), v.string()]), 0),
  standardPurchasePrice: v.optional(v.union([v.number(), v.string()]), 0),
  attachments: v.optional(v.array(attachmentSchema)),
  // 承認機能展開: 明示指定時はこちらを優先する(承認フローの仮ロック時にstatus="temporary"を
  // 明示送信するため)。未指定時はサービス層が会社設定のワークフロー有効フラグから決定する。
  status: v.optional(v.string()),
});

// 更新用ボディ
export const updateProductSchema = v.object({
  name: requiredString("品目名は必須です。"),
  isPurchased: v.optional(v.boolean(), false),
  isSales: v.optional(v.boolean(), false),
  isService: v.optional(v.boolean(), false),
  baseUnitCode: v.optional(v.string(), "pcs"),
  taxCategoryCode: v.optional(v.string(), "TAX_10"),
  productBarcode: v.optional(v.nullable(v.string())),
  accountCode: v.optional(v.nullable(v.string())),
  supplierId: v.optional(v.nullable(v.string())),
  supplierPartNumber: v.optional(v.nullable(v.string())),
  status: v.string(),
  memo: v.optional(v.nullable(v.string())),
  standardSalesPrice: v.optional(v.union([v.number(), v.string()]), 0),
  standardPurchasePrice: v.optional(v.union([v.number(), v.string()]), 0),
  attachments: v.optional(v.array(attachmentSchema)),
});

// 各スキーマからの推論型 export
export type SearchProductsQuery = v.InferOutput<
  typeof searchProductsQuerySchema
>;
export type RegisterProductInput = v.InferOutput<typeof registerProductSchema>;
export type UpdateProductInput = v.InferOutput<typeof updateProductSchema>;
export type AttachmentInput = v.InferOutput<typeof attachmentSchema>;
