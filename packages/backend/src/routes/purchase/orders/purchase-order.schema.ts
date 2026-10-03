import * as v from "valibot";

// Helper: null, undefined, 空文字を安全に受容して文字列を返す(quote.schema.tsと同じ方針)
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

// Item9 Phase5: OTPダウンロードリクエスト(外部公開エンドポイント用、quotes/sales_ordersと同型)
export const RequestDownloadOtpSchema = v.object({
  email: v.pipe(v.string(), v.email("有効なメールアドレス形式で入力してください")),
});
export type RequestDownloadOtpInput = v.InferOutput<typeof RequestDownloadOtpSchema>;

export const VerifyDownloadOtpSchema = v.object({
  email: v.pipe(v.string(), v.email("有効なメールアドレス形式で入力してください")),
  otp: v.pipe(v.string(), v.regex(/^\d{4,8}$/, "確認コードは4〜8桁の数字で入力してください")),
});
export type VerifyDownloadOtpInput = v.InferOutput<typeof VerifyDownloadOtpSchema>;

// 一覧検索クエリのバリデーション
export const SearchOrdersQuerySchema = v.object({
  id: v.optional(v.string()),
  title: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  partnerId: v.optional(v.string()),
  status: v.optional(v.string()),
  requestId: v.optional(v.string()),
  // 追加要望: 含まれる商品・自社担当者での絞り込み検索
  itemKeyword: v.optional(v.string()),
  personEmployeeNumber: v.optional(v.string()),
  // 追加要望: 注残(発注数量に対して承認済みの仕入計上がまだ満たない明細を持つ)がある発注
  // のみで絞り込む("true"のみ有効)
  hasUnrecognizedPurchase: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// 明細行の型。purchase_request_items/sales_order_itemsと同じ「マスタ選択/手入力」両対応
export const PurchaseOrderItemSchema = v.looseObject({
  itemId: v.string(),
  itemName: optionalString,
  inputType: v.optional(v.picklist(["MASTER", "DIRECT"]), "MASTER"),
  quantity: v.union([
    v.number(),
    v.pipe(v.string(), v.transform((val) => Number(val) || 0)),
  ]),
  unitPrice: v.union([
    v.number(),
    v.pipe(v.string(), v.transform((val) => Number(val) || 0)),
  ]),
  unitCode: optionalString,
  taxCategoryCode: optionalString,
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode: optionalString,
  memo: optionalString,
  // どの購買申請明細に由来するか(購買申請から発注を起票した場合のみ設定、表示用トレーサビリティ)
  purchaseRequestItemId: optionalString,
});

// 添付ファイルの型。quote_attachments/purchase_request_attachmentsと同じR2/外部URL(共有リンク)両対応
export const PurchaseOrderAttachmentInputSchema = v.looseObject({
  fileName: v.string(),
  storageType: v.optional(v.picklist(["R2", "GOOGLE_DRIVE"]), "R2"),
  attachmentR2Path: optionalString,
  externalUrl: optionalString,
  fileType: v.optional(v.string()),
});

// 発注登録・更新 JSON ペイロード用
export const PurchaseOrderPayloadSchema = v.looseObject({
  id: optionalString,
  title: optionalString,
  partnerId: v.optional(v.string()),
  // 購買申請から発注を起票する際、どの購買申請由来かを記録する(スナップショット方式)
  requestId: optionalString,
  orderDate: v.string(),
  status: optionalString,
  projectId: optionalString,
  totalAmount: optionalNumber,
  taxAmount: optionalNumber,
  memo: optionalString,
  companyName: optionalString,
  companyDepartment: optionalString,
  companyAddress: optionalString,
  companyTel: optionalString,
  companyFax: optionalString,
  deliveryDate: optionalString,
  deliveryPlace: optionalString,
  // 新規要望(2026-09-23): 納品場所の「拠点用」「倉庫用」選択(いずれか一方、両方null=手入力のみも可)
  deliveryLocationId: optionalString,
  deliveryWarehouseId: optionalString,
  paymentTerms: optionalString,
  // 見積→受注のsalesPersonEmployeeNumber/inputPersonEmployeeNumberと同じ2担当者分離
  purchasePersonEmployeeNumber: optionalString,
  inputPersonEmployeeNumber: optionalString,
  // 前払の最小対応(Item9追加設計確定)
  isPaid: v.optional(v.boolean()),
  paidAt: optionalString,
  historyComment: optionalString,
  items: v.optional(v.array(PurchaseOrderItemSchema)),
  attachments: v.optional(v.array(PurchaseOrderAttachmentInputSchema)),
  // 購買申請から発注を作成する際、itemsを送らずこちらだけ送ると、サーバー側が購買申請明細から
  // 発注明細を組み立てる(未指定=購買申請全体コピー、指定=選択行+数量のみコピー)。
  // itemsが送られてきた場合は常にitems側を優先する(フロント側で組み立て済みのケース、白紙作成を含む)
  requisitionItemSelections: v.optional(
    v.array(
      v.looseObject({
        requisitionItemId: v.string(),
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
export type PurchaseOrderPayload = v.InferOutput<typeof PurchaseOrderPayloadSchema>;
export type BulkSendEmailInput = v.InferOutput<typeof BulkSendEmailSchema>;
export type SingleSendEmailInput = v.InferOutput<typeof SingleSendEmailSchema>;
