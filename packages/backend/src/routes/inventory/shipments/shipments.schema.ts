import * as v from "valibot";

// ロケーション・商品コード・ロット・品質区分の4項目で出庫対象のstocks行を一意に特定する。
// (itemIdを省略してロケーションだけから自動推定する設計は、複数ロット/品質区分が
// 同一ロケーションに同居した場合に取り違えの余地があるため廃止した)
export const shipmentItemInputSchema = v.object({
  locationId: v.string("ロケーションIDは必須です"),
  itemId: v.string("品目IDは必須です"),
  quantity: v.pipe(v.number("数量は数値で指定してください"), v.minValue(0.001, "数量は0より大きい値を指定してください")),
  lotNumber: v.optional(v.nullable(v.string())),
  qualityStatus: v.optional(v.nullable(v.string())),
  // Item7残課題6: この明細がどの受注明細の消込対象かを示す(任意、受注に紐づかない出庫ではnull)
  salesOrderItemId: v.optional(v.nullable(v.string())),
});

export const createShipmentSchema = v.object({
  shippedDate: v.string("出庫日は必須です"),
  items: v.pipe(
    v.array(shipmentItemInputSchema),
    v.minLength(1, "明細を1件以上指定してください"),
  ),
  memo: v.optional(v.nullable(v.string())),
  // Item6 Phase6-4: 得意先(取引先マスタ)。任意項目。設定時のみ出庫確定時に
  // 納品書・納品予定データを自動生成する
  partnerId: v.optional(v.nullable(v.string())),
  // 新規要望(2026-09-23): 倉庫間移動。得意先の代わりに移動先倉庫を指定できる(partnerIdと排他、
  // service層で検証する)
  destinationWarehouseId: v.optional(v.nullable(v.string())),
  // Item6 Phase6-4: 消込用。外部倉庫からの出荷実績取込時に、対応する出荷指示を指定すると
  // 指示側の充足状況(PARTIALLY_FULFILLED/FULFILLED)が更新される。任意項目
  shipmentInstructionId: v.optional(v.nullable(v.string())),
  // 追加要望F: 申請者が複数部門に所属する場合に選択した申請部門(任意)
  applicantDepartmentSurrogateId: v.optional(v.nullable(v.string())),
});

export type ShipmentItemInput = v.InferOutput<typeof shipmentItemInputSchema>;
export type CreateShipmentInput = v.InferOutput<typeof createShipmentSchema>;

// 入出庫履歴一覧の検索クエリ
export const GetShipmentsQuerySchema = v.object({
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

export type GetShipmentsQuery = v.InferOutput<typeof GetShipmentsQuerySchema>;

// CSV一括登録(1ファイル=1出庫。ヘッダー行の次から明細行が並ぶ。ヘッダー項目は先頭明細行の値を使う)
export const bulkRegisterShipmentSchema = v.object({
  csvData: v.string("CSVデータは文字列で指定してください"),
});

export type BulkRegisterShipmentInput = v.InferOutput<typeof bulkRegisterShipmentSchema>;

// Item7残課題7: 納品書OTPダウンロード検証(外部公開)
export const VerifyDeliveryNoteDownloadOtpSchema = v.object({
  otp: v.pipe(
    v.string(),
    v.regex(/^\d{4,8}$/, "確認コードは4〜8桁の数字で入力してください"),
  ),
});

export type VerifyDeliveryNoteDownloadOtpInput = v.InferOutput<
  typeof VerifyDeliveryNoteDownloadOtpSchema
>;

// 納品書メール送信(方式A、sales-order.schema.tsのBulkSendEmailSchema/SingleSendEmailSchemaと同型)
export const BulkSendDeliveryNoteEmailSchema = v.looseObject({
  shipmentHeaderIds: v.array(v.string()),
  fallbackOperatorId: v.optional(v.string()),
});

export const SingleSendDeliveryNoteEmailSchema = v.looseObject({
  recipientEmail: v.pipe(
    v.string(),
    v.nonEmpty("送信先メールアドレスは必須です"),
    v.email("有効なメールアドレスの形式で入力してください"),
  ),
  fallbackOperatorId: v.optional(v.string()),
});

export type BulkSendDeliveryNoteEmailInput = v.InferOutput<typeof BulkSendDeliveryNoteEmailSchema>;
export type SingleSendDeliveryNoteEmailInput = v.InferOutput<typeof SingleSendDeliveryNoteEmailSchema>;
