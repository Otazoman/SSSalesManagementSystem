import { drizzle } from "drizzle-orm/d1";
import { and, count, desc, eq, gt, gte, isNull } from "drizzle-orm";
import * as schema from "../../db/otp-schema";

export class OtpRepository {
  private db;

  constructor(dbOtp: D1Database) {
    this.db = drizzle(dbOtp, { schema });
  }

  async insertChallenge(data: {
    id: string;
    documentType: string;
    documentId: string;
    attachmentId: string;
    email: string;
    otpCode: string;
    expiresAt: Date;
    createdAt: Date;
  }) {
    await this.db.insert(schema.otpChallenges).values(data);
  }

  // 未失効・未検証のうち最新の1件を取得する(同一組み合わせで複数回リクエストされても直近のものを対象にする)
  async findLatestActiveChallenge(
    documentType: string,
    documentId: string,
    attachmentId: string,
    email: string,
    now: Date,
  ) {
    const rows = await this.db
      .select()
      .from(schema.otpChallenges)
      .where(
        and(
          eq(schema.otpChallenges.documentType, documentType),
          eq(schema.otpChallenges.documentId, documentId),
          eq(schema.otpChallenges.attachmentId, attachmentId),
          eq(schema.otpChallenges.email, email),
          isNull(schema.otpChallenges.verifiedAt),
          gt(schema.otpChallenges.expiresAt, now),
        ),
      )
      .orderBy(desc(schema.otpChallenges.createdAt))
      .limit(1);
    return rows[0] || null;
  }

  // 悪用防止(同一組み合わせへのOTP発行連打)のためのレート制限用カウント
  async countRecentChallenges(
    documentType: string,
    documentId: string,
    attachmentId: string,
    email: string,
    since: Date,
  ): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(schema.otpChallenges)
      .where(
        and(
          eq(schema.otpChallenges.documentType, documentType),
          eq(schema.otpChallenges.documentId, documentId),
          eq(schema.otpChallenges.attachmentId, attachmentId),
          eq(schema.otpChallenges.email, email),
          gte(schema.otpChallenges.createdAt, since),
        ),
      );
    return rows[0]?.value || 0;
  }

  // Item6 Phase6-4: 倉庫の複数連絡先対応。受信者が個別にメールアドレスを入力するステップが無く、
  // 同じOTPコードを登録済みの全連絡先へ同時送信するため、emailで絞り込まず
  // (documentType, documentId, attachmentId)のみで直近のチャレンジを引く
  async findLatestActiveChallengeAny(
    documentType: string,
    documentId: string,
    attachmentId: string,
    now: Date,
  ) {
    const rows = await this.db
      .select()
      .from(schema.otpChallenges)
      .where(
        and(
          eq(schema.otpChallenges.documentType, documentType),
          eq(schema.otpChallenges.documentId, documentId),
          eq(schema.otpChallenges.attachmentId, attachmentId),
          isNull(schema.otpChallenges.verifiedAt),
          gt(schema.otpChallenges.expiresAt, now),
        ),
      )
      .orderBy(desc(schema.otpChallenges.createdAt))
      .limit(1);
    return rows[0] || null;
  }

  async countRecentChallengesAny(
    documentType: string,
    documentId: string,
    attachmentId: string,
    since: Date,
  ): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(schema.otpChallenges)
      .where(
        and(
          eq(schema.otpChallenges.documentType, documentType),
          eq(schema.otpChallenges.documentId, documentId),
          eq(schema.otpChallenges.attachmentId, attachmentId),
          gte(schema.otpChallenges.createdAt, since),
        ),
      );
    return rows[0]?.value || 0;
  }

  async incrementAttempt(id: string, newAttemptCount: number) {
    await this.db
      .update(schema.otpChallenges)
      .set({ attemptCount: newAttemptCount })
      .where(eq(schema.otpChallenges.id, id));
  }

  async markVerified(id: string, verifiedAt: Date) {
    await this.db
      .update(schema.otpChallenges)
      .set({ verifiedAt })
      .where(eq(schema.otpChallenges.id, id));
  }
}
