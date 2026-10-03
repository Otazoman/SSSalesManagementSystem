import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

// 新規要望(2026-09-23): 取引先ごとの複数納品先。warehouse-contacts.schema.tsと同型(承認ワークフローなし)
export const querySchema = v.object({
  partnerId: v.optional(v.string()),
  status: v.optional(v.string()),
});

export const createPartnerDeliveryDestinationSchema = v.object({
  partnerId: requiredString("取引先IDは必須です"),
  name: requiredString("納品先名は必須です"),
  postalCode: v.optional(v.nullable(v.string())),
  address: v.optional(v.nullable(v.string())),
  phone: v.optional(v.nullable(v.string())),
  memo: v.optional(v.nullable(v.string())),
});

export const updatePartnerDeliveryDestinationSchema = v.object({
  name: requiredString("納品先名は必須です"),
  postalCode: v.optional(v.nullable(v.string())),
  address: v.optional(v.nullable(v.string())),
  phone: v.optional(v.nullable(v.string())),
  memo: v.optional(v.nullable(v.string())),
  status: requiredString("ステータスは必須です"),
});

export type CreatePartnerDeliveryDestinationInput = v.InferOutput<
  typeof createPartnerDeliveryDestinationSchema
>;
export type UpdatePartnerDeliveryDestinationInput = v.InferOutput<
  typeof updatePartnerDeliveryDestinationSchema
>;
export type QueryInput = v.InferOutput<typeof querySchema>;
