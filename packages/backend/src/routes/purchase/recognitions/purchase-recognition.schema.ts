import * as v from "valibot";

// Item10: sales-invoice.schema.tsと同じヘルパー方針
const optionalString = v.optional(v.nullable(v.string()));

const optionalNumber = v.optional(
  v.nullable(
    v.union([
      v.number(),
      v.pipe(
        v.string(),
        v.transform((val) => (val === "" ? 0 : Number(val))),
      ),
    ]),
  ),
);

// 一覧検索クエリのバリデーション
export const SearchPurchaseRecognitionsQuerySchema = v.object({
  id: v.optional(v.string()),
  title: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  partnerId: v.optional(v.string()),
  orderId: v.optional(v.string()),
  status: v.optional(v.string()),
  documentType: v.optional(v.string()),
  paymentStatus: v.optional(v.string()),
  itemName: v.optional(v.string()),
  purchasePerson: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// 明細行の型(v.looseObjectで未知プロパティを許容)
// Item10: sourceOrderItemIdは発注明細単位で仕入を起こす場合の参照(単独仕入/発注ヘッダー単位の場合はnull)
export const PurchaseRecognitionItemSchema = v.looseObject({
  itemId: v.string(),
  itemName: optionalString,
  sourceOrderItemId: optionalString,
  quantity: v.union([
    v.number(),
    v.pipe(
      v.string(),
      v.transform((val) => Number(val) || 0),
    ),
  ]),
  unitPrice: v.union([
    v.number(),
    v.pipe(
      v.string(),
      v.transform((val) => Number(val) || 0),
    ),
  ]),
  memo: optionalString,
  unitCode: optionalString,
  taxCategoryCode: optionalString,
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode: optionalString,
});

export const PurchaseRecognitionAttachmentInputSchema = v.looseObject({
  fileName: v.string(),
  storageType: v.string(),
  attachmentR2Path: optionalString,
  externalUrl: optionalString,
  fileType: v.optional(v.string()),
});

// 仕入登録・更新 JSONペイロード
export const PurchaseRecognitionPayloadSchema = v.looseObject({
  id: optionalString,
  title: optionalString,
  partnerId: v.optional(v.string()),
  supplierId: optionalString,
  orderId: optionalString,
  recognitionDate: v.string(),
  status: optionalString,
  // PURCHASE(既定)/RETURN/DISCOUNT/CORRECTION
  documentType: optionalString,
  originalRecognitionId: optionalString,
  totalAmount: optionalNumber,
  taxAmount: optionalNumber,
  memo: optionalString,
  companyDepartment: optionalString,
  company_department: optionalString,
  purchasePersonEmployeeNumber: optionalString,
  inputPersonEmployeeNumber: optionalString,
  companyName: optionalString,
  companyZip: optionalString,
  companyAddress: optionalString,
  companyTel: optionalString,
  companyFax: optionalString,
  paymentTerms: optionalString,
  // 追加要望: プロジェクト。発注からそのまま引き継ぐ。発注に依存しない単独仕入は手動選択できる
  projectId: optionalString,
  updatedBy: optionalString,
  historyComment: optionalString,
  items: v.optional(v.array(PurchaseRecognitionItemSchema)),
  attachments: v.optional(v.array(PurchaseRecognitionAttachmentInputSchema)),
  // L-1-b: この仕入計上の対象となる検収記録(入庫)のid。省略(未指定)=更新時は既存の紐づけを維持、
  // 空配列=紐づけ解除。通常仕入(PURCHASE)のみ対象
  receiptIds: v.optional(v.array(v.string())),
});

export type SearchPurchaseRecognitionsQuery = v.InferOutput<
  typeof SearchPurchaseRecognitionsQuerySchema
>;
export type PurchaseRecognitionPayload = v.InferOutput<typeof PurchaseRecognitionPayloadSchema>;
