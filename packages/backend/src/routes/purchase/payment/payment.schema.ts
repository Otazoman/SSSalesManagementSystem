import * as v from "valibot";

// Item10 Phase5: billing.schema.tsと同じヘルパー方針
const optionalString = v.optional(v.nullable(v.string()));

export const SearchPaymentQuerySchema = v.object({
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

const numberish = v.union([
  v.number(),
  v.pipe(
    v.string(),
    v.transform((val) => Number(val) || 0),
  ),
]);

// K-5-1: 検収記録(item_receipt_headers)を仕入計上を介さず直接支払対象にする際の選択行。
// 発注紐付きの検収は金額をサービス層で自動計算するためamount/taxAmountは省略可。発注非依存の検収
// (単価情報を持たない)の場合はサービス層が必須とし、未指定なら400を返す
export const ItemReceiptPaymentItemSchema = v.object({
  id: v.string(),
  amount: v.optional(numberish),
  taxAmount: v.optional(numberish),
});

// K-5-3: 完全手動入力の明細行(購買申請・発注・検収・仕入いずれにも紐づかない支払)。
// billing_itemsと異なり数量×単価の内訳は持たず、支払金額(税込)とその内消費税を直接入力する
// (支払側は対外文書を発行しないため、税区分マスタからの計算は不要という基本方針による)
export const ManualPaymentItemSchema = v.object({
  itemName: v.pipe(v.string(), v.minLength(1, "品目名は必須です")),
  amount: numberish,
  taxAmount: v.optional(numberish, 0),
});

// 支払確定ペイロード。mode=PER_TRANSACTIONはpurchaseRecognitionIds/itemReceipts/manualItemsの
// 合計が1件のみ許可(サービス層で検証)、PERIODICはperiodStart/periodEndが必須(サービス層で検証)。
// K-5-1/K-5-3: 3つの起点(仕入計上/検収記録/完全手動)は排他ではなく併用可能(合計1件以上あればよい)
export const CreatePaymentPayloadSchema = v.object({
  partnerId: v.string(),
  mode: v.picklist(["PER_TRANSACTION", "PERIODIC"]),
  paymentDate: v.string(),
  periodStart: optionalString,
  periodEnd: optionalString,
  title: optionalString,
  memo: optionalString,
  purchaseRecognitionIds: v.optional(v.array(v.string()), []),
  itemReceipts: v.optional(v.array(ItemReceiptPaymentItemSchema), []),
  manualItems: v.optional(v.array(ManualPaymentItemSchema), []),
});

// 手動消込(支払実績記録)ペイロード
export const PaymentDisbursementPayloadSchema = v.object({
  paidDate: v.string(),
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

// ファームバンキング: 全銀「総合振込」フォーマットの振込データファイル作成ペイロード
export const ExportFirmBankingPayloadSchema = v.object({
  paymentHeaderIds: v.pipe(
    v.array(v.string()),
    v.minLength(1, "振込対象の支払を1件以上選択してください"),
  ),
  transferDate: v.string(),
});

export type SearchPaymentQuery = v.InferOutput<typeof SearchPaymentQuerySchema>;
export type ExportFirmBankingPayload = v.InferOutput<typeof ExportFirmBankingPayloadSchema>;
export type CreatePaymentPayload = v.InferOutput<typeof CreatePaymentPayloadSchema>;
export type PaymentDisbursementPayload = v.InferOutput<typeof PaymentDisbursementPayloadSchema>;
