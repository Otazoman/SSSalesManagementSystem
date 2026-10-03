import * as v from "valibot";
import { requiredString } from "../../../platform/validation/common-schema";

// 1. PUT: テンプレート更新 schema
export const updateTemplateSchema = v.object({
  id: requiredString("帳票IDは必須です"),
  smtpFrom: v.optional(v.string()),
  ccAddress: v.optional(v.string()),
  bccAddress: v.optional(v.string()),
  subjectTemplate: requiredString("件名テンプレートは必須です"),
  bodyTemplate: v.string(),
  // 追加要望L-3-b/c: 帳票PDFのファイル名プレフィックス(省略時は変更しない、空文字は既定の名称に戻す)
  fileNamePrefix: v.optional(v.nullable(v.string())),
});

export type UpdateTemplateInput = v.InferOutput<typeof updateTemplateSchema>;

// 2. POST: テストメール送信 schema
export const sendTestEmailSchema = v.object({
  id: requiredString("帳票IDは必須です"),
  testToEmail: v.pipe(
    v.string(),
    v.nonEmpty("テスト宛先(To)は必須です"),
    v.email("有効なメールアドレス形式で入力してください"),
  ),
  attachedR2Path: v.optional(v.string()),
});

export type SendTestEmailInput = v.InferOutput<typeof sendTestEmailSchema>;

// 3. GET: R2 エクスプローラー クエリ schema
export const r2ExplorerQuerySchema = v.object({
  prefix: v.optional(v.string(), ""),
  bucket: v.optional(v.string(), "system"),
});

export type R2ExplorerQueryInput = v.InferOutput<typeof r2ExplorerQuerySchema>;

// 4. POST: ファイルアップロード schema
export const uploadFileSchema = v.object({
  fileType: v.pipe(
    v.string(),
    v.union(
      [
        v.literal("font"),
        v.literal("logo"),
        v.literal("seal"),
        v.literal("report_template"),
      ],
      "無効なファイルタイプ指定です(font, logo, seal, report_template のいずれか)",
    ),
  ),
  // fileType==="report_template"の場合のみ必須(対象帳票IDを指定)。service層で存在チェックする。
  documentTypeId: v.optional(v.string()),
  file: v.custom<File>(
    (val) => val instanceof File && val.size > 0,
    "アップロードするファイルを指定してください",
  ),
});

export type UploadFileInput = v.InferOutput<typeof uploadFileSchema>;
