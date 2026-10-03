import * as v from "valibot";

// 各画面の見出し下に出す説明(HTML)。保存先は専用D1(DB_UI。src/db/ui-schema.ts)。
// 未登録の画面は、コードに書かれた既定の説明を表示する。本文は保存時にサーバーで無害化する
export const MAX_DESCRIPTION_LENGTH = 20000;

// 画面のパス(例: /sales/quotes)。英小文字・数字・ハイフン・アンダースコア・スラッシュのみ
export const ScreenPathSchema = v.pipe(
  v.string(),
  v.regex(/^\/[a-z0-9/_-]{0,99}$/, "画面のパスが不正です"),
);

export const ScreenDescriptionPayloadSchema = v.object({
  path: ScreenPathSchema,
  descriptionHtml: v.pipe(
    v.string(),
    v.maxLength(MAX_DESCRIPTION_LENGTH, `説明は${MAX_DESCRIPTION_LENGTH}文字以内です`),
  ),
});

export const ScreenDescriptionPreviewSchema = v.object({
  body: v.pipe(v.string(), v.maxLength(MAX_DESCRIPTION_LENGTH, `説明は${MAX_DESCRIPTION_LENGTH}文字以内です`)),
});

export type ScreenDescriptionPayload = v.InferOutput<typeof ScreenDescriptionPayloadSchema>;

export interface ScreenDescription {
  path: string;
  descriptionHtml: string;
  updatedBy: string;
  updatedAt: string;
}
