import * as v from "valibot";

// Item8: quote.schema.tsと同じヘルパー方針
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
export const SearchSalesInvoicesQuerySchema = v.object({
  id: v.optional(v.string()),
  title: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  partnerId: v.optional(v.string()),
  salesOrderId: v.optional(v.string()),
  status: v.optional(v.string()),
  documentType: v.optional(v.string()),
  billingStatus: v.optional(v.string()),
  itemName: v.optional(v.string()),
  salesPerson: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// 明細行の型(v.looseObjectで未知プロパティを許容)
// Item8: sourceOrderItemIdは受注明細単位で売上を起こす場合の参照(単独売上/受注ヘッダー単位の場合はnull)
export const SalesInvoiceItemSchema = v.looseObject({
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
  costPrice: optionalNumber,
  memo: optionalString,
  unitCode: optionalString,
  taxCategoryCode: optionalString,
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode: optionalString,
});

export const SalesInvoiceAttachmentInputSchema = v.looseObject({
  fileName: v.string(),
  storageType: v.string(),
  attachmentR2Path: optionalString,
  externalUrl: optionalString,
  fileType: v.optional(v.string()),
});

// 売上登録・更新 JSONペイロード
export const SalesInvoicePayloadSchema = v.looseObject({
  id: optionalString,
  title: optionalString,
  partnerId: v.optional(v.string()),
  customerId: optionalString,
  salesOrderId: optionalString,
  invoiceDate: v.string(),
  status: optionalString,
  // SALE(既定)/RETURN/DISCOUNT/CORRECTION
  documentType: optionalString,
  originalInvoiceId: optionalString,
  totalAmount: optionalNumber,
  taxAmount: optionalNumber,
  memo: optionalString,
  companyDepartment: optionalString,
  company_department: optionalString,
  salesPersonEmployeeNumber: optionalString,
  inputPersonEmployeeNumber: optionalString,
  companyName: optionalString,
  companyZip: optionalString,
  companyAddress: optionalString,
  companyTel: optionalString,
  companyFax: optionalString,
  paymentTerms: optionalString,
  // 追加要望: プロジェクト。受注からそのまま引き継ぐ。受注に依存しない単独売上の場合は手動選択できる
  projectId: optionalString,
  updatedBy: optionalString,
  historyComment: optionalString,
  items: v.optional(v.array(SalesInvoiceItemSchema)),
  attachments: v.optional(v.array(SalesInvoiceAttachmentInputSchema)),
});

// K-4-1: OTPダウンロードリクエスト(外部公開エンドポイント用、quote.schema.tsと同型)
export const RequestDownloadOtpSchema = v.object({
  email: v.pipe(v.string(), v.email("有効なメールアドレス形式で入力してください")),
});
export type RequestDownloadOtpInput = v.InferOutput<typeof RequestDownloadOtpSchema>;

export const VerifyDownloadOtpSchema = v.object({
  email: v.pipe(v.string(), v.email("有効なメールアドレス形式で入力してください")),
  otp: v.pipe(
    v.string(),
    v.regex(/^\d{4,8}$/, "確認コードは4〜8桁の数字で入力してください"),
  ),
});
export type VerifyDownloadOtpInput = v.InferOutput<typeof VerifyDownloadOtpSchema>;

// メール一括送信リクエスト
export const BulkSendEmailSchema = v.looseObject({
  invoiceIds: v.array(v.string()),
  fallbackOperatorId: v.optional(v.string()),
});

// 単独メール送信リクエスト
export const SingleSendEmailSchema = v.looseObject({
  recipientEmail: v.pipe(
    v.string(),
    v.nonEmpty("送信先メールアドレスは必須です"),
    v.email("有効なメールアドレスの形式で入力してください"),
  ),
  fallbackOperatorId: v.optional(v.string()),
});

export type SearchSalesInvoicesQuery = v.InferOutput<
  typeof SearchSalesInvoicesQuerySchema
>;
export type SalesInvoicePayload = v.InferOutput<typeof SalesInvoicePayloadSchema>;
export type BulkSendEmailInput = v.InferOutput<typeof BulkSendEmailSchema>;
