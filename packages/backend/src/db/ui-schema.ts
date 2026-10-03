import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// 画面表示まわりの設定・コンテンツ(別DB: DB_UI側へデプロイする隔離スキーマ)。
// deals-schema.ts(DB_DEALS) / journal-schema.ts(DB_JOURNAL) / otp-schema.ts(DB_OTP) / audit-schema.ts(DB_LOG)と同じ「隔離スキーマ」方式。
//
// メインDBと分ける理由(2026-09-21ユーザー指示「お知らせ・画面説明・ユーザ設定は専用D1に保存」):
//   伝票・マスタとは性格が異なる表示用データのため、影響範囲と運用を独立させる。
//   従来お知らせはKV(結果整合)に保存していたが、削除・更新が他拠点へ即時に反映されず
//   「削除したのに残る」状態になり得たため、強い整合性を持つD1へ移す。
//
// D1はDB跨ぎのFK・JOINが張れないため、メインDBのユーザーへの参照(user_id)はFKなしの文字列とする。

// ダッシュボード「システムからのお知らせ」。本文はサニタイズ済みのHTML(リンク・書式を含められる)
export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").primaryKey(), // UUID
    title: text("title").notNull(),
    body: text("body").notNull().default(""), // サニタイズ済みHTML(保存前にサーバーで無害化)
    publishDate: text("publish_date").notNull(), // YYYY-MM-DD。この日以降に表示
    endDate: text("end_date"), // YYYY-MM-DD(任意)。この日を過ぎると表示しない
    isImportant: integer("is_important", { mode: "boolean" }).notNull().default(false),
    isPublished: integer("is_published", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(), // ISO8601
    updatedBy: text("updated_by").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_announcements_publish").on(table.isPublished, table.publishDate)],
);

// 画面ごとの説明(各画面の見出し下に出す文章)。未登録の画面は、コードに書かれた既定の説明を表示する
export const screenDescriptions = sqliteTable("screen_descriptions", {
  path: text("path").primaryKey(), // 画面のパス(例: /sales/quotes)
  descriptionHtml: text("description_html").notNull(), // サニタイズ済みHTML
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ユーザーごとの表示設定(色・ダークモード)。別の端末でも同じ見た目になるようDBに保持する
export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id").primaryKey(), // メインDB users.id(FKなし)
  themeMode: text("theme_mode").notNull().default("system"), // system | light | dark
  accentColor: text("accent_color").notNull().default("indigo"), // 画面の主要色(パレット名)
  updatedAt: text("updated_at").notNull(),
});
