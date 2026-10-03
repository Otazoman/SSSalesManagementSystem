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

// Item7: OTPダウンロードリクエスト(外部公開エンドポイント用、quotesと同型)
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
  otp: v.pipe(
    v.string(),
    v.regex(/^\d{4,8}$/, "確認コードは4〜8桁の数字で入力してください"),
  ),
});
export type VerifyDownloadOtpInput = v.InferOutput<
  typeof VerifyDownloadOtpSchema
>;

// 一覧検索クエリのバリデーション
export const SearchOrdersQuerySchema = v.object({
  id: v.optional(v.string()),
  title: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  partnerId: v.optional(v.string()),
  status: v.optional(v.string()),
  itemName: v.optional(v.string()),
  salesPerson: v.optional(v.string()),
  sourceQuoteId: v.optional(v.string()),
  // Item7残課題2-5: バックオーダー(引当不足)がある受注のみで絞り込む("true"のみ有効)
  hasBackorder: v.optional(v.string()),
  // 追加要望: 注残(承認済みの売上計上がまだ受注数量に満たない明細を持つ)がある受注のみで
  // 絞り込む("true"のみ有効)
  hasUnrecognizedSales: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// 明細行の型 (v.looseObject で未知のプロパティを許容)
export const SalesOrderItemSchema = v.looseObject({
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
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode: optionalString,
  // Item7: どの見積明細に由来するか(見積からの受注作成時のみ設定、表示用トレーサビリティのみ)
  sourceQuoteItemId: optionalString,
  // Item7残課題2-5: 倉庫×数量の内訳リクエスト(JSON文字列)。未指定なら引当実行時に自動でFIFO割当する
  warehouseAllocationRequest: optionalString,
});

// 添付ファイルの型
export const SalesOrderAttachmentInputSchema = v.looseObject({
  fileName: v.string(),
  storageType: v.string(),
  attachmentR2Path: optionalString,
  externalUrl: optionalString,
  fileType: v.optional(v.string()),
});

// 受注登録・更新 JSON ペイロード用
export const SalesOrderPayloadSchema = v.looseObject({
  id: optionalString,
  title: optionalString,
  partnerId: v.optional(v.string()),
  // Item7: 見積起点の受注作成時、どの見積由来かを記録する(スナップショット方式、数量消込はしない)
  sourceQuoteId: optionalString,
  orderDate: v.string(),
  status: optionalString,
  totalAmount: optionalNumber,
  taxAmount: optionalNumber,
  memo: optionalString,
  terms: optionalString,
  companyDepartment: optionalString,
  salesPersonEmployeeNumber: optionalString,
  // Item7残課題: 営業担当(見積から引き継ぐ)とは別に、実際にこの伝票を入力する担当者
  inputPersonEmployeeNumber: optionalString,
  companyName: optionalString,
  companyAddress: optionalString,
  companyTel: optionalString,
  companyFax: optionalString,
  deliveryDate: optionalString,
  deliveryPlace: optionalString,
  // 新規要望(2026-09-23): 取引先ごとの複数納品先(partner_delivery_destinations)からの選択
  deliveryDestinationId: optionalString,
  paymentTerms: optionalString,
  // 追加要望: プロジェクト。見積からそのまま引き継ぎ、売上計上まで伝播させる
  projectId: optionalString,
  // Item9: 前受の最小対応(発注のisPaid/paidAtと対称の設計、支払完了/入金完了を先に記録するためのマーカーのみ)
  isPrepaid: v.optional(v.boolean()),
  prepaidAt: optionalString,
  updatedBy: optionalString,
  historyComment: optionalString,
  items: v.optional(v.array(SalesOrderItemSchema)),
  attachments: v.optional(v.array(SalesOrderAttachmentInputSchema)),
  // Item7: 見積から受注を作成する際、itemsを送らずこちらだけ送ると、サーバー側が見積明細から
  // 受注明細を組み立てる(未指定=見積全体コピー、指定=選択行+数量のみコピー)。
  // itemsが送られてきた場合は常にitems側を優先する(フロント側で既に組み立て済みのケース)
  quoteItemSelections: v.optional(
    v.array(
      v.looseObject({
        quoteItemId: v.string(),
        quantity: optionalNumber,
      }),
    ),
  ),
});

// メール一括送信リクエスト
export const BulkSendEmailSchema = v.looseObject({
  orderIds: v.array(v.string()),
  fallbackOperatorId: v.optional(v.string()),
});

// 一括出荷指示/出庫作成リクエスト(プレビュー計算・実行確定の両エンドポイントで共用)
export const BulkShipmentPlanSchema = v.looseObject({
  orderIds: v.array(v.string()),
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

export type SearchOrdersQuery = v.InferOutput<typeof SearchOrdersQuerySchema>;
export type SalesOrderPayload = v.InferOutput<typeof SalesOrderPayloadSchema>;
export type BulkSendEmailInput = v.InferOutput<typeof BulkSendEmailSchema>;
export type BulkShipmentPlanInput = v.InferOutput<typeof BulkShipmentPlanSchema>;
