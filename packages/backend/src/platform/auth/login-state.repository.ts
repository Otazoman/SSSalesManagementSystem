import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";

// BUG-022・BUG-024: ユーザーごとのログインの状態(user_login_states)の読み書き。
// 失敗回数・一時ロックはKVではなくD1に持つ(無料プランのKVは書き込みが1日1000回までで、
// 攻撃で失敗を繰り返されると他の機能の書き込みまで止まるため)。

export type LoginState = typeof schema.userLoginStates.$inferSelect;

export class LoginStateRepository {
  private db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1, { schema });
  }

  async find(userId: string): Promise<LoginState | null> {
    const rows = await this.db
      .select()
      .from(schema.userLoginStates)
      .where(eq(schema.userLoginStates.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async upsert(userId: string, values: Partial<Omit<LoginState, "userId">>) {
    await this.db
      .insert(schema.userLoginStates)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: schema.userLoginStates.userId, set: values });
  }

  recordFailure(userId: string, failedCount: number, at: Date) {
    return this.upsert(userId, { failedCount, lastFailedAt: at });
  }

  resetFailures(userId: string) {
    return this.upsert(userId, { failedCount: 0, lastFailedAt: null, lockedUntil: null });
  }

  lockTemporarily(userId: string, until: Date) {
    return this.upsert(userId, { failedCount: 0, lastFailedAt: null, lockedUntil: until });
  }

  // この時刻より前に発行したログイン(セッション)を無効にする
  revokeSessions(userId: string, at: Date = new Date()) {
    return this.upsert(userId, { sessionsValidAfter: at });
  }

  delete(userId: string) {
    return this.db.delete(schema.userLoginStates).where(eq(schema.userLoginStates.userId, userId));
  }

  // セッションが今も使えるか: アカウントが有効で、取り消しの時刻より後に発行されたもの
  async isSessionActive(userId: string, issuedAtSeconds: number): Promise<boolean> {
    const rows = await this.db
      .select({ isActive: schema.users.isActive, validAfter: schema.userLoginStates.sessionsValidAfter })
      .from(schema.users)
      .leftJoin(schema.userLoginStates, eq(schema.userLoginStates.userId, schema.users.id))
      .where(eq(schema.users.id, userId))
      .limit(1);
    const row = rows[0];
    if (!row || !row.isActive) return false;
    if (row.validAfter && issuedAtSeconds < Math.floor(row.validAfter.getTime() / 1000)) return false;
    return true;
  }
}
