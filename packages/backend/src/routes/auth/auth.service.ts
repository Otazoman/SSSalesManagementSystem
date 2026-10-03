import { Context } from "hono";
import { AuthRepository } from "./auth.repository";
import { hashPassword, verifyPassword } from "../../utils/crypto";
import { writeAuditLog } from "../../utils/logger";
import {
  isPartnerWorkflowGloballyEnabled,
  isQuoteWorkflowGloballyEnabled,
  isPartnerContactWorkflowGloballyEnabled,
  isUnitWorkflowGloballyEnabled,
  isLocationWorkflowGloballyEnabled,
  isProductPriceWorkflowGloballyEnabled,
  isProductWorkflowGloballyEnabled,
  isAccountWorkflowGloballyEnabled,
  isWarehouseWorkflowGloballyEnabled,
  isBusinessLocationWorkflowGloballyEnabled,
  isItemStructureWorkflowGloballyEnabled,
  isReceivingWorkflowGloballyEnabled,
  isShippingWorkflowGloballyEnabled,
  isInventoryAdjustmentWorkflowGloballyEnabled,
  isDamageWorkflowGloballyEnabled,
  isDisposalWorkflowGloballyEnabled,
  isReturnWorkflowGloballyEnabled,
  isShippingInstructionWorkflowGloballyEnabled,
  isShippingResultWorkflowGloballyEnabled,
  isReceivingInstructionWorkflowGloballyEnabled,
  isReceivingResultWorkflowGloballyEnabled,
  isSalesOrderWorkflowGloballyEnabled,
  isPurchaseRequisitionWorkflowGloballyEnabled,
  isPurchaseOrderWorkflowGloballyEnabled,
  isSalesInvoiceWorkflowGloballyEnabled,
  isPurchaseRecognitionWorkflowGloballyEnabled,
} from "../../workflow-engine/settings";
import { Env } from "../../types/env";
import { LoginInput, UpdateNotificationSettingsInput } from "./auth.schema";
import { SessionPayload } from "../../platform/auth/session-token";
import { setSessionCookie, clearSessionCookie, getSession } from "../../platform/auth/get-session";
import { LoginStateRepository, LoginState } from "../../platform/auth/login-state.repository";
import { getCompanySettings } from "../../platform/kv/company-settings-cache";

const RESOURCE_KEY = "auth";

// 初期のシステム管理者の従業員番号(無効化できない。user.service.ts と同じ判定)
const INITIAL_ADMIN_EMPLOYEE_NUMBER = "admin";
// BUG-022: 初期のシステム管理者を一時的にロックする時間
const INITIAL_ADMIN_LOCK_MS = 15 * 60 * 1000;
// 最後の失敗からこの時間が過ぎたら、失敗の回数を数え直す
const FAILED_COUNT_RESET_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_FAILED_ATTEMPTS = 5;

// 会社設定の値(文字列)を上限回数にする。0は制限なし。未設定・不正な値は既定の5回
export function resolveMaxFailedAttempts(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed >= 0 && String(value ?? "").trim() !== ""
    ? parsed
    : DEFAULT_MAX_FAILED_ATTEMPTS;
}

export class AuthService {
  constructor(
    private repo: AuthRepository,
    private env: Env,
  ) {}

  // ロール1件分の権限IDリストをKVキャッシュ優先で取得する共通ヘルパー
  // (getProfileで複数ロール分をループ呼び出しして合算するために切り出した)
  private async fetchPermissionsForRole(roleId: string): Promise<string[]> {
    try {
      const cached: string[] | null = await this.env.KV_PERMISSIONS.get(
        `role_permissions:${roleId}`,
        { type: "json" },
      );
      if (cached !== null) return cached;

      const fetched = await this.repo.fetchRolePermissions(roleId);
      await this.env.KV_PERMISSIONS.put(
        `role_permissions:${roleId}`,
        JSON.stringify(fetched),
        { expirationTtl: 86400 },
      );
      return fetched;
    } catch (kvErr) {
      console.error("[Profile API KV Permissions Fetch Error]", kvErr);
      return [];
    }
  }

  async login(c: Context<{ Bindings: Env }>, input: LoginInput) {
    const { email, employeeNumber, password } = input;
    const now = new Date();
    const clientIp =
      c.req.header("CF-Connecting-IP") ||
      c.req.header("X-Forwarded-For") ||
      "UNKNOWN_IP";

    const found = email
      ? await this.repo.findUserByEmail(email)
      : await this.repo.findUserByEmployeeNumber(employeeNumber!);
    // BUG-022: 初期のシステム管理者は、従業員番号(推測しやすい "admin")ではログインできない(メールアドレスのみ)
    const user =
      found && !email && found.employeeNumber === INITIAL_ADMIN_EMPLOYEE_NUMBER ? undefined : found;

    const invalidCredentials = {
      status: 401,
      data: {
        success: false,
        message: "メールアドレス(または従業員番号)またはパスワードが正しくありません",
      },
    };

    // ❌ 失敗①：メールアドレス/従業員番号なし
    if (!user) {
      await writeAuditLog(
        c,
        "LOGIN_FAILED_UNKNOWN_EMAIL",
        "users",
        "UNKNOWN",
        null,
        {
          ...(email
            ? { attemptedEmail: email }
            : { attemptedEmployeeNumber: employeeNumber }),
          ipAddress: clientIp,
          reason:
            "入力されたメールアドレス/従業員番号がマスタに存在しません。",
        },
      );
      return invalidCredentials;
    }

    const loginStates = new LoginStateRepository(this.env.DB);
    const loginState = await loginStates.find(user.id);

    // ❌ 一時的なロック中(初期のシステム管理者だけ。パスワードが合っていてもログインさせない)
    if (loginState?.lockedUntil && loginState.lockedUntil > now) {
      return {
        status: 403,
        data: {
          success: false,
          message: "ログインの失敗が続いたため、一時的にログインを止めています。しばらくしてからお試しください",
        },
      };
    }

    // ❌ 失敗②：パスワード不一致(BUG-021: 保存値そのものを入力しても一致しない)
    const verified = await verifyPassword(password, user.passwordHash);
    if (!verified.ok) {
      await writeAuditLog(
        c,
        "LOGIN_FAILED_WRONG_PASSWORD",
        RESOURCE_KEY,
        user.id,
        null,
        {
          email: user.email,
          ipAddress: clientIp,
          reason: "パスワードが一致しません。",
        },
      );
      // 無効化済みのアカウントは数えない(既にロックされているため)
      if (!user.isActive) return invalidCredentials;
      const locked = await this.recordLoginFailure(c, user, loginState, now, clientIp);
      return locked ?? invalidCredentials;
    }

    // ❌ 失敗③：無効化アカウント(BUG-022: パスワードが合っている時だけ伝える。存在の有無を漏らさないため)
    if (!user.isActive) {
      await writeAuditLog(
        c,
        "LOGIN_FAILED_INACTIVE_USER",
        "users",
        user.id,
        null,
        {
          email: user.email,
          ipAddress: clientIp,
          reason: "無効化されているアカウントへのアクセス試行です。",
        },
      );
      return {
        status: 403,
        data: {
          success: false,
          message: "このアカウントは無効化されています(ログインの失敗が続いてロックされた場合を含みます)。管理者に連絡してください",
        },
      };
    }

    // ログインに成功したら、続けて失敗した回数を0に戻す
    if (loginState && (loginState.failedCount > 0 || loginState.lockedUntil)) {
      await loginStates.resetFailures(user.id);
    }

    // BUG-021: 古い形(全ユーザー共通の固定ソルト)で保存されていれば、ユーザーごとのソルトの形へ書き換える
    if (verified.needsRehash) {
      await this.repo.updatePasswordHash(user.id, await hashPassword(password));
    }

    // 所属・権限関係の読み込み
    const relations = await this.repo.fetchUserMatrixRelations(user.id, now);
    let assignedRole = "user";
    let departmentName = "未配属";

    if (relations.length > 0) {
      // 複数ロールが付与されている場合、表示用ロール(role Cookie/部署名)はadminを優先する。
      // 実際の画面権限はgetProfile側で付与済み全ロールの権限を合算して決めるため、ここでの
      // 選択はログイン直後の表示・監査ログ用のラベルにのみ影響する。
      const primaryRel =
        relations.find((r) => r.roleId === "admin") || relations[0];
      assignedRole = primaryRel.roleId;
      if (primaryRel.roleId === "admin") {
        departmentName = "全社共通";
      } else {
        departmentName = primaryRel.departmentName || "名称未設定";
      }
    }

    // KV から設定を取得
    const kvData = await this.env.COMPANY_SETTINGS.get("config");
    let isAuditLogEnabled = true;
    let companyName = "サンプル";

    if (kvData && kvData.trim() !== "") {
      try {
        const parsed = JSON.parse(kvData);
        if (parsed && typeof parsed === "object") {
          companyName = parsed.company_name || companyName;
          isAuditLogEnabled =
            parsed.is_audit_log_enabled === true ||
            parsed.is_audit_log_enabled === "true";
        }
      } catch (parseError) {
        console.error(
          "KV 'config' のパースに失敗したため、デフォルト値を適用します:",
          parseError,
        );
      }
    }

    const hasRequireChangeKey = await this.env.COMPANY_SETTINGS.get(
      `require_change:${user.id}`,
    );
    const isFirstLogin = hasRequireChangeKey === "true";

    // 署名付きセッションcookieの発行(httpOnly・改ざん不可)。
    // 従来6本のcookieに分散していた値を1本のJSON化ペイロードにまとめ、HMAC署名する。
    await setSessionCookie(c, {
      userId: user.id,
      employeeNumber: user.employeeNumber,
      name: user.name,
      role: assignedRole,
      deptName: departmentName,
      companyName: companyName,
      isAuditEnabled: isAuditLogEnabled,
    });

    // 監査ログ
    await writeAuditLog(
      c,
      "USER_LOGIN_SUCCESS",
      RESOURCE_KEY,
      user.id,
      null,
      {
        email: user.email,
        name: user.name,
        role: assignedRole,
        departmentName: departmentName,
        ipAddress: clientIp,
      },
      isAuditLogEnabled,
    );

    return {
      status: 200,
      data: {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: assignedRole,
          departmentName: departmentName,
          companyName: companyName,
          mustChangePassword: isFirstLogin,
        },
      },
    };
  }

  // BUG-022: パスワードの失敗を数え、上限に達したらロックする。ロックした場合はその応答を返す。
  // 上限(会社設定の login_max_failed_attempts。0は制限なし)に達したら、通常のユーザーは無効化し、
  // 無効化できない初期のシステム管理者は一定時間ログインを止める。
  // 最後の失敗から時間が空いた場合は、数え直す(たまの入力ミスが積み重なってロックされないように)
  private async recordLoginFailure(
    c: Context<{ Bindings: Env }>,
    user: { id: string; email: string; employeeNumber: string },
    loginState: LoginState | null,
    now: Date,
    clientIp: string,
  ) {
    const config = (await getCompanySettings(this.env.COMPANY_SETTINGS).catch(() => null)) ?? {};
    const maxAttempts = resolveMaxFailedAttempts(config.login_max_failed_attempts);
    const loginStates = new LoginStateRepository(this.env.DB);

    const isRecent =
      loginState?.lastFailedAt && now.getTime() - loginState.lastFailedAt.getTime() < FAILED_COUNT_RESET_MS;
    const failedCount = (isRecent ? loginState!.failedCount : 0) + 1;

    if (maxAttempts === 0 || failedCount < maxAttempts) {
      await loginStates.recordFailure(user.id, failedCount, now);
      return null;
    }

    const isInitialAdmin = user.employeeNumber === INITIAL_ADMIN_EMPLOYEE_NUMBER;
    if (isInitialAdmin) {
      await loginStates.lockTemporarily(user.id, new Date(now.getTime() + INITIAL_ADMIN_LOCK_MS));
    } else {
      await this.repo.deactivateUser(user.id, now);
      await loginStates.resetFailures(user.id);
      await loginStates.revokeSessions(user.id, now);
    }

    const isAuditLogEnabled = config.is_audit_log_enabled === undefined
      ? true
      : config.is_audit_log_enabled === true || config.is_audit_log_enabled === "true";
    await writeAuditLog(
      c,
      "LOGIN_ACCOUNT_LOCKED",
      RESOURCE_KEY,
      user.id,
      null,
      {
        email: user.email,
        employeeNumber: user.employeeNumber,
        ipAddress: clientIp,
        failedCount,
        lockType: isInitialAdmin ? "TEMPORARY" : "DEACTIVATED",
        reason: `ログインに${failedCount}回続けて失敗したため、アカウントをロックしました。`,
      },
      isAuditLogEnabled,
    );

    return {
      status: 403,
      data: {
        success: false,
        message: isInitialAdmin
          ? "ログインの失敗が続いたため、一時的にログインを止めています。しばらくしてからお試しください"
          : "ログインの失敗が続いたため、アカウントをロックしました。管理者に連絡してください",
      },
    };
  }

  async getProfile(
    c: Context<{ Bindings: Env }>,
    session: SessionPayload | null,
  ) {
    if (!session) {
      return {
        status: 401,
        data: { success: false, message: "セッションがありません" },
      };
    }

    const { userId, employeeNumber, name, role, deptName, companyName, isAuditEnabled } =
      session;
    const currentRoleId = role || "general_user";

    // 💡 複数ロール付与時の権限合算(不具合修正): 以前はログインcookieに保存した単一ロールの
    // 権限しか見ておらず、ユーザーに複数ロールが付与されていても(例: 課長 + 経理確認者)、
    // 後から付与したロール次第で先に付与されていたロールの権限が反映されなくなっていた
    // (ロール追加のたびに参照先ロールが不定に変わり、弱い方の権限しか有効にならないように
    // 見える不具合)。ここではユーザーに紐づく全ロールを取り直し、各ロールの権限を和集合として
    // 合算する。
    const relations = await this.repo.fetchUserMatrixRelations(userId, new Date());
    const roleIds =
      relations.length > 0
        ? Array.from(new Set(relations.map((r) => r.roleId)))
        : [currentRoleId];

    const permissionSet = new Set<string>();
    for (const roleId of roleIds) {
      const rolePermissions = await this.fetchPermissionsForRole(roleId);
      rolePermissions.forEach((p) => permissionSet.add(p));
    }
    const permissions = Array.from(permissionSet);

    // 画面側のadminバイパス判定(roleId === "admin")のため、付与ロールにadminが含まれる場合は
    // それを優先して返す(ログイン時点でadmin以外のロールがcookieに記録されていても正しく判定される)
    const displayRoleId = roleIds.includes("admin") ? "admin" : currentRoleId;

    void writeAuditLog(
      c,
      "VERIFY_AUTH_PROFILE",
      RESOURCE_KEY,
      userId,
      null,
      {
        roleId: displayRoleId,
        companyName: companyName || "",
        message:
          "Webフロントエンド初期化に伴うセッション検証が正常に通過しました",
      },
      isAuditEnabled,
    );

    // Item5: 5つとも同じCOMPANY_SETTINGS KVの"config"キーを個別に読みに行くため、
    // 逐次awaitだと5回分のKVレイテンシが直列に積み上がってしまう(実測でauth/profileが
    // 4秒超に悪化する原因になっていた)。並列実行してレイテンシを1回分に抑える。
    const [
      isPartnerWfEnabled,
      isQuoteWfEnabled,
      isPartnerContactWfEnabled,
      isUnitWfEnabled,
      isLocationWfEnabled,
      isProductPriceWfEnabled,
      isProductWfEnabled,
      isAccountWfEnabled,
      isWarehouseWfEnabled,
      isBusinessLocationWfEnabled,
      isItemStructureWfEnabled,
      isReceivingWfEnabled,
      isShippingWfEnabled,
      isInventoryWfEnabled,
      isDamageWfEnabled,
      isDisposalWfEnabled,
      isReturnWfEnabled,
      isShippingInstructionWfEnabled,
      isShippingResultWfEnabled,
      isReceivingInstructionWfEnabled,
      isReceivingResultWfEnabled,
      isSalesOrderWfEnabled,
      isPurchaseRequisitionWfEnabled,
      isPurchaseOrderWfEnabled,
      isSalesInvoiceWfEnabled,
      isPurchaseRecognitionWfEnabled,
    ] = await Promise.all([
      isPartnerWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isQuoteWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isPartnerContactWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isUnitWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isLocationWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isProductPriceWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isProductWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isAccountWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isWarehouseWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isBusinessLocationWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isItemStructureWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isReceivingWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isShippingWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isInventoryAdjustmentWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isDamageWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isDisposalWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isReturnWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isShippingInstructionWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isShippingResultWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isReceivingInstructionWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isReceivingResultWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isSalesOrderWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isPurchaseRequisitionWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isPurchaseOrderWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isSalesInvoiceWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
      isPurchaseRecognitionWorkflowGloballyEnabled(this.env.COMPANY_SETTINGS),
    ]);

    const notificationSettings = await this.repo.findNotificationSettings(
      userId,
    );

    // 追加要望F: 申請部門選択のため、ユーザーが実際に所属する部門一覧(重複除去)を返す。
    // 有効期間外(validFrom/validTo)の部門はfetchUserMatrixRelations内のJOIN条件で
    // 既に除外されているため、departmentId/departmentNameがnullの行はスキップする。
    const departmentMap = new Map<
      string,
      { surrogateId: string; id: string; name: string }
    >();
    for (const r of relations) {
      if (r.departmentSurrogateId && r.departmentId && r.departmentName) {
        departmentMap.set(r.departmentSurrogateId, {
          surrogateId: r.departmentSurrogateId,
          id: r.departmentId,
          name: r.departmentName,
        });
      }
    }
    const departments = Array.from(departmentMap.values());

    return {
      status: 200,
      data: {
        id: userId,
        employeeNumber: employeeNumber,
        name: name,
        roleId: displayRoleId,
        deptName: deptName || "未配属",
        companyName: companyName || "サンプル 販売管理",
        permissions: permissions,
        departments: departments,
        isPartnerWfEnabled: isPartnerWfEnabled,
        isQuoteWfEnabled: isQuoteWfEnabled,
        isPartnerContactWfEnabled: isPartnerContactWfEnabled,
        isUnitWfEnabled: isUnitWfEnabled,
        isLocationWfEnabled: isLocationWfEnabled,
        isProductPriceWfEnabled: isProductPriceWfEnabled,
        isProductWfEnabled: isProductWfEnabled,
        isAccountWfEnabled: isAccountWfEnabled,
        isWarehouseWfEnabled: isWarehouseWfEnabled,
        isBusinessLocationWfEnabled: isBusinessLocationWfEnabled,
        isItemStructureWfEnabled: isItemStructureWfEnabled,
        isReceivingWfEnabled: isReceivingWfEnabled,
        isShippingWfEnabled: isShippingWfEnabled,
        isInventoryWfEnabled: isInventoryWfEnabled,
        isDamageWfEnabled: isDamageWfEnabled,
        isDisposalWfEnabled: isDisposalWfEnabled,
        isReturnWfEnabled: isReturnWfEnabled,
        isShippingInstructionWfEnabled: isShippingInstructionWfEnabled,
        isShippingResultWfEnabled: isShippingResultWfEnabled,
        isReceivingInstructionWfEnabled: isReceivingInstructionWfEnabled,
        isReceivingResultWfEnabled: isReceivingResultWfEnabled,
        isSalesOrderWfEnabled: isSalesOrderWfEnabled,
        isPurchaseRequisitionWfEnabled: isPurchaseRequisitionWfEnabled,
        isPurchaseOrderWfEnabled: isPurchaseOrderWfEnabled,
        isSalesInvoiceWfEnabled: isSalesInvoiceWfEnabled,
        isPurchaseRecognitionWfEnabled: isPurchaseRecognitionWfEnabled,
        slackUserId: notificationSettings?.slackUserId || null,
        notificationChannel: notificationSettings?.notificationChannel || "email",
      },
    };
  }

  // Item0: プロフィール画面からの自己編集(Slack通知設定)
  async updateNotificationSettings(
    c: Context<{ Bindings: Env }>,
    session: SessionPayload | null,
    input: UpdateNotificationSettingsInput,
  ) {
    if (!session) {
      return {
        status: 401,
        data: { success: false, message: "セッションがありません" },
      };
    }

    await this.repo.updateNotificationSettings(session.userId, {
      slackUserId:
        input.slackUserId === undefined
          ? undefined
          : input.slackUserId?.trim() || null,
      notificationChannel: input.notificationChannel,
    });

    void writeAuditLog(
      c,
      "UPDATE_NOTIFICATION_SETTINGS",
      RESOURCE_KEY,
      session.userId,
      null,
      {
        slackUserIdSet: input.slackUserId !== undefined,
        notificationChannel: input.notificationChannel,
      },
      session.isAuditEnabled,
    );

    return {
      status: 200,
      data: { success: true, message: "通知設定を更新しました" },
    };
  }

  // ログアウト：署名付きセッションcookieを失効させる(httpOnlyのためJSからは消せない)。
  // BUG-024: cookieを消すだけでは、盗まれたcookieが期限まで使えるため、このユーザーのそれまでのログインを全て無効にする
  // (他の端末でのログインも終わる)
  async logout(c: Context<{ Bindings: Env }>) {
    const session = await getSession(c);
    if (session) await new LoginStateRepository(this.env.DB).revokeSessions(session.userId);
    clearSessionCookie(c);
    return { status: 200, data: { success: true } };
  }
}
