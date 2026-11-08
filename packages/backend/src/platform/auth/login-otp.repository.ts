import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/otp-schema";

export type LoginOtpChallenge = typeof schema.loginOtpChallenges.$inferSelect;

// REQ-004: ログイン時の OTP のチャレンジ(OTP 用 DB の login_otp_challenges)
export class LoginOtpRepository {
  private db;

  constructor(dbOtp: D1Database) {
    this.db = drizzle(dbOtp, { schema });
  }

  async insert(data: typeof schema.loginOtpChallenges.$inferInsert) {
    await this.db.insert(schema.loginOtpChallenges).values(data);
  }

  async findById(id: string): Promise<LoginOtpChallenge | null> {
    const rows = await this.db
      .select()
      .from(schema.loginOtpChallenges)
      .where(eq(schema.loginOtpChallenges.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async recordFailedAttempt(id: string, attemptCount: number) {
    await this.db
      .update(schema.loginOtpChallenges)
      .set({ attemptCount })
      .where(eq(schema.loginOtpChallenges.id, id));
  }

  async markVerified(id: string, at: Date) {
    await this.db
      .update(schema.loginOtpChallenges)
      .set({ verifiedAt: at })
      .where(eq(schema.loginOtpChallenges.id, id));
  }

  // 再送: 新しいコードに置き換え、有効期限・試行回数を振り直す
  async replaceCode(id: string, data: { codeHash: string; channel: string; expiresAt: Date; lastSentAt: Date }) {
    await this.db
      .update(schema.loginOtpChallenges)
      .set({ ...data, attemptCount: 0 })
      .where(eq(schema.loginOtpChallenges.id, id));
  }

  async delete(id: string) {
    await this.db.delete(schema.loginOtpChallenges).where(eq(schema.loginOtpChallenges.id, id));
  }
}
