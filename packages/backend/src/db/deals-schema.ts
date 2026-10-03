import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// 商談管理(別DB: DB_DEALS側へデプロイする隔離スキーマ)。追加要望M-1。
// journal-schema.ts(DB_JOURNAL) / otp-schema.ts(DB_OTP) / audit-schema.ts(DB_LOG)と同じ「隔離スキーマ」方式。
//
// メインDBと分ける理由(2026-09-20ユーザー指示「商談管理は別D1に分けたい」):
//   商談は見込み客との面談内容・メモ・次回タスクなど、伝票(受注〜支払)とは性格・保存年限・
//   閲覧範囲が異なる営業活動データのため、影響範囲と運用を独立させる。
//
// D1はDB跨ぎのFK・JOIN・トランザクションが張れないため、以下の方針を採る:
//   - メインDBのマスタ/伝票(取引先・見積・社員・取引先担当者)への参照はFKを張らないただの文字列とし、
//     存在確認・名称解決はアプリケーション側(メインDBを別途参照)で行う
//   - 面談者は氏名をスナップショットで保存する(後日の担当者名変更・削除で過去の商談記録が
//     読めなくならないようにするため)
//   - 同じDB内の従属テーブル(面談者・タスク・添付・見積紐づけ)は商談へのFK(削除時カスケード)を張る

// 見込み客の担当者。見込み客(取引先マスタの種別PROSPECT)は取引先担当者マスタ(partner_contacts)に
// 未登録のことが多いため、商談入力中にその場で登録できる専用の担当者管理を持つ
export const prospectContacts = sqliteTable(
  "prospect_contacts",
  {
    id: text("id").primaryKey(), // UUID
    partnerId: text("partner_id").notNull(), // 取引先マスタ(メインDB)のid。FKなし
    name: text("name").notNull(),
    departmentName: text("department_name"),
    position: text("position"),
    email: text("email"),
    phone: text("phone"),
    memo: text("memo"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_prospect_contacts_partner").on(table.partnerId)],
);

// 商談。1見込み客(取引先)に対して複数
export const deals = sqliteTable(
  "deals",
  {
    id: text("id").primaryKey(), // 伝票番号(接頭辞DL、会社設定の伝票番号設定で採番)
    partnerId: text("partner_id").notNull(), // 取引先マスタ(メインDB)のid。FKなし
    title: text("title").notNull(),
    dealDate: integer("deal_date", { mode: "timestamp" }).notNull(), // 商談日
    startTime: text("start_time"), // "HH:MM"
    endTime: text("end_time"), // "HH:MM"
    location: text("location"),
    memo: text("memo"),
    // OPEN=商談中 / WON=受注(成約) / LOST=失注
    status: text("status").notNull().default("OPEN"),
    ownerEmployeeNumber: text("owner_employee_number"), // 自社の商談担当者(社員番号)
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_deals_partner").on(table.partnerId), index("idx_deals_date").on(table.dealDate)],
);

// 面談者(誰と会ったか)。氏名はスナップショット。
// kind: PROSPECT_CONTACT(見込客用担当者=prospect_contacts.id) / PARTNER_CONTACT(取引先担当者マスタ=メインDB)
//       / EMPLOYEE(自社同席者=社員番号) / FREE(未登録の相手を自由記入)
export const dealAttendees = sqliteTable(
  "deal_attendees",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    refId: text("ref_id"), // FREE以外の参照先(FKなし)
    name: text("name").notNull(),
    note: text("note"), // 役職・所属など
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("idx_deal_attendees_deal").on(table.dealId)],
);

// 次回までのタスク
export const dealTasks = sqliteTable(
  "deal_tasks",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueDate: integer("due_date", { mode: "timestamp" }),
    assigneeEmployeeNumber: text("assignee_employee_number"),
    isDone: integer("is_done", { mode: "boolean" }).notNull().default(false),
    doneAt: integer("done_at", { mode: "timestamp" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("idx_deal_tasks_deal").on(table.dealId),
    index("idx_deal_tasks_assignee").on(table.assigneeEmployeeNumber, table.isDone),
  ],
);

// 添付ファイル(実体は専用R2バケット DEALS_BUCKET)
export const dealAttachments = sqliteTable(
  "deal_attachments",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    attachmentR2Path: text("attachment_r2_path").notNull(),
    fileType: text("file_type").notNull().default("OTHER"),
    uploadedById: text("uploaded_by_id").notNull(),
    uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_deal_attachments_deal").on(table.dealId)],
);

// 商談に紐づく見積(見積はメインDB。FKなし。紐づけは同じ取引先の見積のみ、アプリ側で検証)
export const dealQuotes = sqliteTable(
  "deal_quotes",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    quoteId: text("quote_id").notNull(),
    linkedBy: text("linked_by").notNull(),
    linkedAt: integer("linked_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_deal_quotes_deal_quote").on(table.dealId, table.quoteId),
    index("idx_deal_quotes_quote").on(table.quoteId),
  ],
);
