import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

// 💡 undefined, null, 空文字のすべてを安全に許容するコメント用共通スキーマ
const OptionalCommentSchema = v.optional(v.nullable(v.string()));

// GET /my-pending クエリ
export const MyPendingQuerySchema = v.object({
  userId: requiredString("ユーザーIDは必須です"),
});

// POST /approve リクエスト
export const ApproveRequestSchema = v.object({
  logId: requiredString("logIdは必須です"),
  requestId: requiredString("requestIdは必須です"),
  userId: requiredString("userIdは必須です"),
  comment: OptionalCommentSchema,
});

// POST /remand リクエスト
export const RemandRequestSchema = v.object({
  logId: requiredString("logIdは必須です"),
  requestId: requiredString("requestIdは必須です"),
  userId: requiredString("userIdは必須です"),
  comment: OptionalCommentSchema,
});

// GET /history クエリ
export const HistoryQuerySchema = v.object({
  userId: requiredString("ユーザーIDは必須です"),
  status: v.optional(v.nullable(v.string())),
  applicantId: v.optional(v.nullable(v.string())),
  startDate: v.optional(v.nullable(v.string())),
  endDate: v.optional(v.nullable(v.string())),
});

// POST /bulk-approve リクエスト（一括承認）
export const BulkApproveRequestSchema = v.object({
  logIds: v.pipe(
    v.array(v.string()),
    v.minLength(1, "処理対象が選択されていません"), // 💡 チェックボックス未選択時のみこのエラーを出力
  ),
  userId: requiredString("userIdは必須です"),
  comment: OptionalCommentSchema, // 💡 コメント未入力(null/undefined/空文字)を安全に許容
});

// POST /bulk-remand リクエスト（一括差戻し）
export const BulkRemandRequestSchema = v.object({
  logIds: v.pipe(
    v.array(v.string()),
    v.minLength(1, "処理対象が選択されていません"),
  ),
  userId: requiredString("userIdは必須です"),
  comment: OptionalCommentSchema, // 💡 コメント未入力(null/undefined/空文字)を安全に許容
});

// POST /cancel リクエスト
export const CancelRequestSchema = v.object({
  targetId: requiredString("targetIdは必須です"),
  logId: requiredString("logIdは必須です"),
  userId: requiredString("userIdは必須です"),
});

// 型定義のエクスポート
export type MyPendingQuery = v.InferOutput<typeof MyPendingQuerySchema>;
export type ApproveRequestInput = v.InferOutput<typeof ApproveRequestSchema>;
export type RemandRequestInput = v.InferOutput<typeof RemandRequestSchema>;
export type HistoryQuery = v.InferOutput<typeof HistoryQuerySchema>;
export type BulkApproveRequestInput = v.InferOutput<
  typeof BulkApproveRequestSchema
>;
export type BulkRemandRequestInput = v.InferOutput<
  typeof BulkRemandRequestSchema
>;
export type CancelRequestInput = v.InferOutput<typeof CancelRequestSchema>;
