import * as v from "valibot";

// ダッシュボード「システムからのお知らせ」。保存先は専用D1(DB_UI。src/db/ui-schema.ts)。
// 本文はHTML(リンク・書式を含められる)で、保存時にサーバーで無害化する(platform/html/sanitize-html.ts)
export const MAX_ANNOUNCEMENTS = 200;

const DateStringSchema = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, "日付はYYYY-MM-DD形式で指定してください"));

export const AnnouncementPayloadSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1, "タイトルは必須です"), v.maxLength(200, "タイトルは200文字以内です")),
  body: v.optional(v.pipe(v.string(), v.maxLength(20000, "本文は20000文字以内です")), ""),
  // 掲載日(表示する日付)。この日以降にダッシュボードへ表示する
  publishDate: DateStringSchema,
  // 掲載終了日(任意。この日を過ぎると表示しない)
  endDate: v.optional(v.nullable(DateStringSchema), null),
  // 重要フラグ(ダッシュボードで強調表示)
  isImportant: v.optional(v.boolean(), false),
  // 公開フラグ(falseの間は下書き扱いで、ダッシュボードに表示しない)
  isPublished: v.optional(v.boolean(), true),
});

export const AnnouncementPreviewSchema = v.object({
  body: v.pipe(v.string(), v.maxLength(20000, "本文は20000文字以内です")),
});

export type AnnouncementPayload = v.InferOutput<typeof AnnouncementPayloadSchema>;

export interface Announcement extends AnnouncementPayload {
  id: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}
