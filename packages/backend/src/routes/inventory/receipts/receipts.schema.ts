import * as v from "valibot";

// Item6 Phase6-3-2: 入庫時検品(破損・不良品管理)。PASSED=良品/DAMAGED=破損/QUARANTINE=検品待ち。
// stocks.qualityStatusとは別に管理する語彙のため、stockQualityStatusSchemaは流用せずここで独自定義する
export const inspectionStatusSchema = v.picklist(["PASSED", "DAMAGED", "QUARANTINE"]);

export const receiptItemInputSchema = v.object({
  itemId: v.string("品目IDは必須です"),
  warehouseId: v.string("倉庫IDは必須です"),
  locationId: v.string("ロケーションIDは必須です"),
  lotNumber: v.optional(v.string(), "NONE"),
  accountCode: v.optional(v.nullable(v.string())),
  quantity: v.pipe(v.number("数量は数値で指定してください"), v.minValue(0.001, "数量は0より大きい値を指定してください")),
  inspectionStatus: v.optional(inspectionStatusSchema, "PASSED"),
  inspectionMemo: v.optional(v.nullable(v.string())),
  qrCodeKey: v.optional(v.nullable(v.string())),
  // Item9: どの発注明細に対する入荷かのトレーサビリティ(起票トリガー「発注から選ぶ」)。
  // 任意起票の入庫はnullのまま
  orderItemId: v.optional(v.nullable(v.string())),
});

export const createReceiptSchema = v.object({
  receivedDate: v.string("入庫日は必須です"),
  supplierInvoiceNumber: v.optional(v.nullable(v.string())),
  items: v.pipe(
    v.array(receiptItemInputSchema),
    v.minLength(1, "明細を1件以上指定してください"),
  ),
  memo: v.optional(v.nullable(v.string())),
  // Item6 Phase6-4: 仕入先(取引先マスタ)。任意項目
  partnerId: v.optional(v.nullable(v.string())),
  // 新規要望(2026-09-23): 倉庫間移動。仕入先の代わりに移動元倉庫を指定できる(partnerIdと排他、
  // service層で検証する)
  sourceWarehouseId: v.optional(v.nullable(v.string())),
  // Item6 Phase6-4: 消込用。外部倉庫からの入荷実績取込時に、対応する入荷指示を指定すると
  // 指示側の充足状況(PARTIALLY_FULFILLED/FULFILLED)が更新される。任意項目
  receiptInstructionId: v.optional(v.nullable(v.string())),
  // Item9: 「発注から選ぶ」で紐付けた発注(任意)。検収書PDFの発注番号欄にも使用する
  orderId: v.optional(v.nullable(v.string())),
  // 追加要望F: 申請者が複数部門に所属する場合に選択した申請部門(任意)
  applicantDepartmentSurrogateId: v.optional(v.nullable(v.string())),
});

export type ReceiptItemInput = v.InferOutput<typeof receiptItemInputSchema>;
export type CreateReceiptInput = v.InferOutput<typeof createReceiptSchema>;

// 入出庫履歴一覧の検索クエリ
export const GetReceiptsQuerySchema = v.object({
  status: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  createdBy: v.optional(v.string()),
  // Item6 Phase6-4フォローアップ: 検索条件強化(倉庫・ロケーションは明細側の項目のため
  // 該当明細を持つヘッダーを絞り込む)
  warehouseId: v.optional(v.string()),
  locationId: v.optional(v.string()),
  partnerId: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

export type GetReceiptsQuery = v.InferOutput<typeof GetReceiptsQuerySchema>;

// CSV一括登録(1ファイル=1入庫。ヘッダー行の次から明細行が並ぶ。ヘッダー項目は先頭明細行の値を使う)
export const bulkRegisterReceiptSchema = v.object({
  csvData: v.string("CSVデータは文字列で指定してください"),
});

export type BulkRegisterReceiptInput = v.InferOutput<typeof bulkRegisterReceiptSchema>;

// 検収書発行(方式A、purchase-order.schema.tsのRequestDownloadOtpSchema等と同型): 発注書と同じ
// メールアドレス入力型のOTPダウンロード(受け身の一斉送信ではなく、相手が自分でメールを入力する)
export const RequestAcceptanceInspectionDownloadOtpSchema = v.object({
  email: v.pipe(
    v.string(),
    v.nonEmpty("メールアドレスは必須です"),
    v.email("有効なメールアドレスの形式で入力してください"),
  ),
});

export const VerifyAcceptanceInspectionDownloadOtpSchema = v.object({
  email: v.pipe(
    v.string(),
    v.nonEmpty("メールアドレスは必須です"),
    v.email("有効なメールアドレスの形式で入力してください"),
  ),
  otp: v.pipe(
    v.string(),
    v.regex(/^\d{4,8}$/, "確認コードは4〜8桁の数字で入力してください"),
  ),
});

export type RequestAcceptanceInspectionDownloadOtpInput = v.InferOutput<
  typeof RequestAcceptanceInspectionDownloadOtpSchema
>;
export type VerifyAcceptanceInspectionDownloadOtpInput = v.InferOutput<
  typeof VerifyAcceptanceInspectionDownloadOtpSchema
>;

export const BulkSendAcceptanceInspectionEmailSchema = v.looseObject({
  receiptIds: v.array(v.string()),
  fallbackOperatorId: v.optional(v.string()),
});

export const SingleSendAcceptanceInspectionEmailSchema = v.looseObject({
  recipientEmail: v.pipe(
    v.string(),
    v.nonEmpty("送信先メールアドレスは必須です"),
    v.email("有効なメールアドレスの形式で入力してください"),
  ),
  fallbackOperatorId: v.optional(v.string()),
});

export type BulkSendAcceptanceInspectionEmailInput = v.InferOutput<
  typeof BulkSendAcceptanceInspectionEmailSchema
>;
export type SingleSendAcceptanceInspectionEmailInput = v.InferOutput<
  typeof SingleSendAcceptanceInspectionEmailSchema
>;
