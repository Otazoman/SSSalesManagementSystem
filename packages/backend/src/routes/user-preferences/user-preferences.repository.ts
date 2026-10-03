import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as uiSchema from "../../db/ui-schema";

// #14-2⑤: index.tsに直接書かれていたDBクエリをRepository層へ移す(ロジック変更なし)
export class UserPreferencesRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema: uiSchema });
  }

  async findByUserId(userId: string) {
    const [row] = await this.db
      .select()
      .from(uiSchema.userPreferences)
      .where(eq(uiSchema.userPreferences.userId, userId));
    return row ?? null;
  }

  async upsert(userId: string, values: { themeMode: string; accentColor: string }) {
    const updatedAt = new Date().toISOString();
    await this.db
      .insert(uiSchema.userPreferences)
      .values({ userId, ...values, updatedAt })
      .onConflictDoUpdate({
        target: uiSchema.userPreferences.userId,
        set: { ...values, updatedAt },
      });
  }
}
