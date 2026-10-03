import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

export const ApprovalRequestSchema = v.object({
  targetType: requiredString("targetTypeは必須です"),
  targetId: requiredString("targetIdは必須です"),
  requestType: v.optional(
    v.union([
      v.literal("REGISTER"),
      v.literal("UPDATE"),
      v.literal("SUSPEND"),
      v.literal("DELETE"),
    ]),
  ),
  payload: v.record(
    v.string(),
    v.unknown(),
    "payloadはオブジェクト形式である必要があります",
  ),
  // 💡 undefined, null, 空文字のすべてを安全に許容する定義に変更
  comment: v.optional(v.nullable(v.string())),
  // 追加要望F: 申請者が複数部門に所属する場合に選択した申請部門(任意)
  applicantDepartmentSurrogateId: v.optional(v.nullable(v.string())),
});

export type ApprovalInput = v.InferOutput<typeof ApprovalRequestSchema>;
