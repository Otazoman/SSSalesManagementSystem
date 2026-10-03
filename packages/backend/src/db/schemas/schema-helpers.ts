import { text, integer } from "drizzle-orm/sqlite-core";

/**
 * 🏢 マスタ・トランザクション共通のフットプリント（監査ログ用カラム）を定義するヘルパー
 *
 * Item1(従業員コード統一): createdBy/updatedByはusers.employeeNumberを保存する方式に変更した。
 * 過去データはusers.id(UUID)のまま残し、新規書き込みからemployeeNumber化するため、
 * この列に対するusers.idへのFK制約は維持できない(意図的に外している)。
 */
export const withAuditColumns = () => ({
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
