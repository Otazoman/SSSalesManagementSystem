import * as v from "valibot";

export const shipmentInstructionItemInputSchema = v.object({
  itemId: v.string("品目IDは必須です"),
  lotNumber: v.optional(v.string(), "NONE"),
  accountCode: v.optional(v.nullable(v.string())),
  instructedQuantity: v.pipe(
    v.number("数量は数値で指定してください"),
    v.minValue(0.001, "数量は0より大きい値を指定してください"),
  ),
  memo: v.optional(v.nullable(v.string())),
  // Item7残課題6: この明細がどの受注明細の消込対象かを示す(任意、単独作成の出荷指示ではnull)
  salesOrderItemId: v.optional(v.nullable(v.string())),
});

export const createShipmentInstructionSchema = v.object({
  // Item6 Phase6-4追加: 見積書と同様、管理番号を任意入力できるようにする。未指定時は自動採番する
  id: v.optional(v.nullable(v.string())),
  partnerId: v.string("得意先は必須です"),
  warehouseId: v.string("倉庫IDは必須です"),
  instructedShipDate: v.string("出荷予定日は必須です"),
  items: v.pipe(
    v.array(shipmentInstructionItemInputSchema),
    v.minLength(1, "明細を1件以上指定してください"),
  ),
  memo: v.optional(v.nullable(v.string())),
  // 追加要望F: 申請者が複数部門に所属する場合に選択した申請部門(任意)
  applicantDepartmentSurrogateId: v.optional(v.nullable(v.string())),
});

export type ShipmentInstructionItemInput = v.InferOutput<
  typeof shipmentInstructionItemInputSchema
>;
export type CreateShipmentInstructionInput = v.InferOutput<
  typeof createShipmentInstructionSchema
>;

export const GetShipmentInstructionsQuerySchema = v.object({
  status: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  createdBy: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

export type GetShipmentInstructionsQuery = v.InferOutput<
  typeof GetShipmentInstructionsQuerySchema
>;

// Item6 Phase6-4: OTPダウンロード検証(外部公開)。宛先は倉庫マスタ登録メールへ固定するため、
// 見積のRequestDownloadOtpSchemaと異なりemail入力は不要
export const VerifyInstructionDownloadOtpSchema = v.object({
  otp: v.pipe(
    v.string(),
    v.regex(/^\d{4,8}$/, "確認コードは4〜8桁の数字で入力してください"),
  ),
});

export type VerifyInstructionDownloadOtpInput = v.InferOutput<
  typeof VerifyInstructionDownloadOtpSchema
>;

// Item6 Phase6-4: 複数選択して一括PDF発行・送信するための入力
export const BulkGeneratePdfSchema = v.object({
  ids: v.pipe(v.array(v.string()), v.minLength(1, "対象を1件以上選択してください")),
});
export type BulkGeneratePdfInput = v.InferOutput<typeof BulkGeneratePdfSchema>;
