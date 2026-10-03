// src/routes/admin/users/password.service.ts
import { UserRepository } from "./user.repository";
import { hashPassword, verifyPassword } from "../../../utils/crypto";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { Context } from "hono";
import { Env } from "../../../types/env";
import { ChangePasswordInput, ResetPasswordViaTokenInput } from "./user.schema";
import { BadRequestError, HttpError, NotFoundError } from "../../../platform/http/http-error";
import { getSession, refreshSessionCookie } from "../../../platform/auth/get-session";
import { LoginStateRepository } from "../../../platform/auth/login-state.repository";
import { findPasswordPolicyViolation, getPasswordPolicy } from "../../../platform/auth/password-policy";

const RESOURCE_KEY = "admin_users";

export class PasswordService {
  constructor(
    private repo: UserRepository,
    private env: Env,
  ) {}

  // BUG-046: 本人が設定するパスワードは、会社設定のルールを満たす必要がある
  private async assertPasswordPolicy(password: string) {
    const violation = findPasswordPolicyViolation(password, await getPasswordPolicy(this.env.COMPANY_SETTINGS));
    if (violation) throw new BadRequestError(violation);
  }

  async changePassword(
    c: Context<{ Bindings: Env }>,
    input: ChangePasswordInput,
  ) {
    const { currentPassword, newPassword } = input;
    // BUG-021: 変更する相手は、ブラウザが送る userId ではなく、ログイン中の本人(署名付きセッションcookie)に限る
    const session = await getSession(c);
    if (!session) throw new HttpError(401, "ログインが必要です");
    const userId = session.userId;
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundError("ユーザーが見つかりません");

    if (!(await verifyPassword(currentPassword, user.passwordHash)).ok) {
      throw new BadRequestError("現在のパスワードが正しくありません");
    }
    await this.assertPasswordPolicy(newPassword);

    const hashedNew = await hashPassword(newPassword);
    await this.repo.updatePassword(userId, hashedNew);
    await this.env.COMPANY_SETTINGS.delete(`require_change:${userId}`);
    // BUG-024: 他の端末でのログインを無効にし、この端末のログインだけ発行し直して続けて使えるようにする
    await new LoginStateRepository(this.env.DB).revokeSessions(userId);
    await refreshSessionCookie(c, {});

    await logAuditEvent(
      c,
      "INITIAL_PASSWORD_SETUP_SUCCESS",
      RESOURCE_KEY,
      userId,
      { passwordHash: "[REDACTED_OLD]" },
      {
        passwordHash: "[REDACTED_NEW_ESTABLISHED]",
        operatorId: userId,
        operatorName: user.name,
        employeeNumber: user.employeeNumber,
      },
    );
  }

  async forgotPassword(c: Context<{ Bindings: Env }>, email: string) {
    const user = await this.repo.findByActiveEmail(email);
    if (!user) return; // 競合検知防止のため一律で成功扱いにする

    const token = crypto.randomUUID();
    await this.env.COMPANY_SETTINGS.put(`reset_token:${token}`, user.id, {
      expirationTtl: 3600,
    });

    const systemConfig = (await getCompanySettings(this.env.COMPANY_SETTINGS)) || {};
    const siteUrl = (systemConfig.site_url || "http://localhost:3000").replace(/\/$/, "");
    const companyName = systemConfig.company_name || "販売管理システム";

    // 追加要望B: ユーザーの通知方法設定に従う単一チャネル(承認通知の`notifier.ts`と同じ方針)。
    // 'slack'かつSlackメンバーID設定済みならSlack DMのみ。SlackメンバーID未設定、またはSlack Botトークン
    // 未設定(送信できない)場合は、リセット手段を失わないようメールへフォールバックする。
    // リセットURL自体の強度(UUID・1時間TTL・使い捨て)と、アカウント存在の非開示(一律成功応答)は変更しない
    const useSlack =
      user.notificationChannel === "slack" && !!user.slackUserId && !!systemConfig.slack_bot_token;

    const resetBody = [
        `${user.name} 様`,
        "",
        `販売管理システム(${companyName})において、パスワードの再設定要求を受け付けました。`,
        `以下のリンクから、1時間以内に新しいパスワードを設定してください。`,
        "",
        `■ パスワード再設定URL:`,
        `${siteUrl}/password-reset?token=${token}`,
        "",
        useSlack
          ? `※ 本メッセージに覚えがない場合は、お手数ですが破棄してください。`
          : `※ 本メールに覚えがない場合は、お手数ですがメールを破棄してください。`,
      ].join("\n");

    await enqueueNotification({
      dbLog: this.env.DB_LOG,
      type: useSlack ? "slack" : "email",
      category: "password_reset",
      documentId: user.id,
      recipientTo: useSlack ? (user.slackUserId as string) : email,
      subject: "【販売管理システム】アクセスパスワードの再設定",
      body: resetBody,
      performedById: user.id,
    });

    await logAuditEvent(c, "PASSWORD_RESET_REQUESTED", RESOURCE_KEY, user.id, null, {
      email: user.email,
      channel: useSlack ? "slack" : "email",
      ip: c.req.header("CF-Connecting-IP") || "UNKNOWN",
      operatorId: user.id,
      operatorEmployeeNumber: user.employeeNumber,
      operatorName: user.name,
    });
  }

  async resetPasswordViaToken(
    c: Context<{ Bindings: Env }>,
    input: ResetPasswordViaTokenInput,
  ) {
    const { token, newPassword } = input;
    if (!token) throw new BadRequestError("トークンが指定されていません");

    const userId = await this.env.COMPANY_SETTINGS.get(`reset_token:${token}`);
    if (!userId)
      throw new BadRequestError(
        "URLの有効期限が切れているか、または既に利用されています",
      );
    await this.assertPasswordPolicy(newPassword);

    const hashedPassword = await hashPassword(newPassword);
    await this.repo.updatePassword(userId, hashedPassword);
    await this.env.COMPANY_SETTINGS.delete(`reset_token:${token}`);
    // BUG-024: パスワードを忘れた時の再設定でも、それまでのログインを全て無効にする
    await new LoginStateRepository(this.env.DB).revokeSessions(userId);

    await logAuditEvent(
      c,
      "RESET_PASSWORD_BY_TOKEN_SUCCESS",
      RESOURCE_KEY,
      userId,
      { note: "Token-based verification clear" },
      { passwordHash: "[REDACTED_AND_RESET]", operatorId: userId },
    );
  }
}
