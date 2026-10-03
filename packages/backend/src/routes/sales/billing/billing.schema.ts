import * as v from "valibot";

// Item8 Phase4: sales-invoice.schema.tsと同じヘルパー方針
const optionalString = v.optional(v.nullable(v.string()));

export const SearchBillingQuerySchema = v.object({
  id: v.optional(v.string()),
  title: v.optional(v.string()),
  partnerId: v.optional(v.string()),
  mode: v.optional(v.string()),
  status: v.optional(v.string()),
  reconciliationStatus: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// K-4-3: 完全手動入力の明細行(売上計上を介さない請求)
export const ManualBillingItemSchema = v.object({
  itemName: v.pipe(v.string(), v.minLength(1, "品目名は必須です")),
  quantity: v.union([
    v.number(),
    v.pipe(v.string(), v.transform((val) => Number(val) || 0)),
  ]),
  unitPrice: v.union([
    v.number(),
    v.pipe(v.string(), v.transform((val) => Number(val) || 0)),
  ]),
  taxCategoryCode: optionalString,
});

// 請求作成ペイロード。mode=PER_TRANSACTIONは明細(salesInvoiceIds/manualItems合計)が1件のみ許可
// (サービス層で検証)、PERIODICはperiodStart/periodEndが必須(サービス層で検証)。
// K-4-3: salesInvoiceIds(売上から選択)/manualItems(明細を直接入力)は排他ではなく併用も許可する
// (どちらか一方が最低1件あればよい、サービス層で検証)
export const CreateBillingPayloadSchema = v.object({
  partnerId: v.string(),
  mode: v.picklist(["PER_TRANSACTION", "PERIODIC"]),
  billingDate: v.string(),
  periodStart: optionalString,
  periodEnd: optionalString,
  title: optionalString,
  memo: optionalString,
  salesInvoiceIds: v.optional(v.array(v.string()), []),
  manualItems: v.optional(v.array(ManualBillingItemSchema), []),
});

// 手動消込(入金記録)ペイロード
export const PaymentReceiptPayloadSchema = v.object({
  receivedDate: v.string(),
  amount: v.union([
    v.number(),
    v.pipe(
      v.string(),
      v.transform((val) => Number(val) || 0),
    ),
  ]),
  method: v.optional(v.picklist(["BANK_TRANSFER", "CASH", "OTHER"])),
  memo: optionalString,
});

// K-4-4: 請求書の再送付(個別送信、quote.schema.tsのSingleSendEmailSchemaと同型)
export const SingleSendEmailSchema = v.looseObject({
  recipientEmail: v.pipe(
    v.string(),
    v.nonEmpty("送信先メールアドレスは必須です"),
    v.email("有効なメールアドレスの形式で入力してください"),
  ),
  fallbackOperatorId: v.optional(v.string()),
});

// 追加要望: 請求書の一覧からの一括メール送信(sales-invoice.schema.tsのBulkSendEmailSchemaと同型)
export const BulkSendEmailSchema = v.looseObject({
  billingHeaderIds: v.array(v.string()),
  fallbackOperatorId: v.optional(v.string()),
});
export type BulkSendEmailInput = v.InferOutput<typeof BulkSendEmailSchema>;

// 追加要望: 請求書PDFのOTPダウンロード(外部公開エンドポイント用、sales-invoice.schema.tsと同型)
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

export type SearchBillingQuery = v.InferOutput<typeof SearchBillingQuerySchema>;
export type CreateBillingPayload = v.InferOutput<typeof CreateBillingPayloadSchema>;
export type PaymentReceiptPayload = v.InferOutput<typeof PaymentReceiptPayloadSchema>;
