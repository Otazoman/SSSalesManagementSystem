import * as v from "valibot";

// 追加要望L-1-a: 単体入金(請求を介さない入金)
export const CASH_RECEIPT_METHODS = ["BANK_TRANSFER", "CASH", "OTHER"] as const;

export const SearchCashReceiptsQuerySchema = v.object({
  partnerId: v.optional(v.string()),
  // UNLINKED(未紐づけ) / LINKED(請求に紐づけ済み) / all
  status: v.optional(v.picklist(["UNLINKED", "LINKED", "all"])),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
});
export type SearchCashReceiptsQuery = v.InferOutput<typeof SearchCashReceiptsQuerySchema>;

export const RegisterCashReceiptSchema = v.object({
  partnerId: v.pipe(v.string(), v.minLength(1, "取引先は必須です")),
  receiptDate: v.pipe(v.string(), v.minLength(1, "入金日は必須です")),
  amount: v.pipe(v.number("金額は数値で指定してください"), v.integer("金額は整数で指定してください"), v.minValue(1, "金額は1円以上で指定してください")),
  method: v.optional(v.picklist(CASH_RECEIPT_METHODS), "BANK_TRANSFER"),
  memo: v.optional(v.nullable(v.string())),
});
export type RegisterCashReceiptPayload = v.InferOutput<typeof RegisterCashReceiptSchema>;

export const LinkCashReceiptSchema = v.object({
  billingHeaderId: v.pipe(v.string(), v.minLength(1, "紐づけ先の請求は必須です")),
});
export type LinkCashReceiptPayload = v.InferOutput<typeof LinkCashReceiptSchema>;
