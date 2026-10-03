import * as v from "valibot";

// Helper: null, undefined, 空文字を安全に受容して文字列を返す
const optionalString = v.optional(v.nullable(v.string()));

// Helper: 数値、または数値に変換可能な文字列/null/undefinedを安全に受容
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

// Item4-c: OTPダウンロードリクエスト(外部公開エンドポイント用)
export const RequestDownloadOtpSchema = v.object({
  email: v.pipe(
    v.string(),
    v.email("有効なメールアドレス形式で入力してください"),
  ),
});
export type RequestDownloadOtpInput = v.InferOutput<
  typeof RequestDownloadOtpSchema
>;

export const VerifyDownloadOtpSchema = v.object({
  email: v.pipe(
    v.string(),
    v.email("有効なメールアドレス形式で入力してください"),
  ),
  // 桁数は会社設定(otp_digit_count)で可変のため、ここでは「数字のみ・妥当な桁数レンジ」の緩い検証に留め、
  // 実際の一致判定はサービス層でDB保存済みのコードと直接比較する
  otp: v.pipe(
    v.string(),
    v.regex(/^\d{4,8}$/, "確認コードは4〜8桁の数字で入力してください"),
  ),
});
export type VerifyDownloadOtpInput = v.InferOutput<
  typeof VerifyDownloadOtpSchema
>;

// 一覧検索クエリのバリデーション
export const SearchQuotesQuerySchema = v.object({
  id: v.optional(v.string()),
  title: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  partnerId: v.optional(v.string()),
  status: v.optional(v.string()),
  itemName: v.optional(v.string()),
  salesPerson: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// 明細行の型 (v.looseObject で inputType など未知のプロパティを許容)
export const QuoteItemSchema = v.looseObject({
  itemId: v.string(),
  itemName: optionalString,
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
});

// 添付ファイルの型
export const QuoteAttachmentInputSchema = v.looseObject({
  fileName: v.string(),
  storageType: v.string(),
  attachmentR2Path: optionalString,
  externalUrl: optionalString,
  fileType: v.optional(v.string()),
});

// 見積登録・更新 JSON ペイロード用 (v.looseObject で customerName, isRevisionUp など未知のプロパティを許容)
export const QuotePayloadSchema = v.looseObject({
  id: optionalString,
  title: optionalString,
  partnerId: v.optional(v.string()),
  customerId: optionalString,
  customerName: optionalString,
  quoteDate: v.string(),
  validUntil: optionalString,
  status: optionalString,
  totalAmount: optionalNumber,
  taxAmount: optionalNumber,
  memo: optionalString,
  terms: optionalString,
  companyDepartment: optionalString,
  company_department: optionalString,
  // Item4-d: 自社担当者(employeeNumber)。以前のsalesPerson/salesPersonId(userId)は廃止
  salesPersonEmployeeNumber: optionalString,
  // Item7残課題(見積へも展開): 営業担当とは別の、実際にこの伝票を入力する担当者
  inputPersonEmployeeNumber: optionalString,
  companyName: optionalString,
  companyZip: optionalString,
  companyAddress: optionalString,
  companyTel: optionalString,
  companyFax: optionalString,
  deliveryDate: optionalString,
  deliveryPlace: optionalString,
  paymentTerms: optionalString,
  // 追加要望: プロジェクト。受注作成時にそのまま引き継ぐ
  projectId: optionalString,
  updatedBy: optionalString,
  historyComment: optionalString,
  items: v.optional(v.array(QuoteItemSchema)),
  attachments: v.optional(v.array(QuoteAttachmentInputSchema)),
});

// メール一括送信リクエスト
export const BulkSendEmailSchema = v.looseObject({
  quoteIds: v.array(v.string()),
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

export type SearchQuotesQuery = v.InferOutput<typeof SearchQuotesQuerySchema>;
export type QuotePayload = v.InferOutput<typeof QuotePayloadSchema>;
export type BulkSendEmailInput = v.InferOutput<typeof BulkSendEmailSchema>;
