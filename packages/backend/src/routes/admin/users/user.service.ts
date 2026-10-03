// src/routes/admin/users/user.service.ts
import { UserRepository } from "./user.repository";
import { PermissionsService } from "../permissions/permissions.service";
import { hashPassword } from "../../../utils/crypto";
import { LoginStateRepository } from "../../../platform/auth/login-state.repository";
import { generateInitialPassword, getPasswordPolicy } from "../../../platform/auth/password-policy";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { enqueueNotification } from "../../../platform/notifications/enqueue-notification";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { Context } from "hono";
import { Env } from "../../../types/env";
import { toCsvBytes, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import {
  SetupAdminInput,
  RegisterUserInput,
  UpdateUserInput,
  UserListQueryInput,
} from "./user.schema";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../../../platform/http/http-error";
import { PaginationParams, toOffset, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { applyInMemorySort } from "../../../platform/http/sort";
import { containsText } from "../../../platform/repository/text-search";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

const RESOURCE_KEY = "admin_users";

// ヘッダクリックソート(追加要望D)の許可カラム。所属・権限マトリクス結合後のJSオブジェクト向けなのでSQLではなくaccessor
const USERS_SORT_COLUMNS: Record<string, (u: { employeeNumber: string; name: string; email: string; isActive: boolean }) => unknown> = {
  employeeNumber: (u) => u.employeeNumber,
  name: (u) => u.name,
  email: (u) => u.email,
  isActive: (u) => u.isActive,
};

export class UserService {
  constructor(
    private repo: UserRepository,
    private env: Env,
  ) {}

  async setupInitialAdmin(
    c: Context<{ Bindings: Env }>,
    input: SetupAdminInput,
  ) {
    const total = await this.repo.countUsers();
    if (total > 0) throw new BadRequestError("既に初期化されています");

    let expectedSetupToken: string | null;
    try {
      expectedSetupToken = await this.env.SETUP_TOKEN.get();
    } catch {
      expectedSetupToken = null;
    }
    if (!expectedSetupToken || input.setupToken !== expectedSetupToken) {
      throw new ForbiddenError("初期セットアップトークンが正しくありません");
    }

    const now = new Date();
    const rootAdminId = crypto.randomUUID();
    const hashedPassword = await hashPassword(input.password);

    await this.repo.setupInitialAdmin(
      {
        id: rootAdminId,
        employeeNumber: input.employeeNumber,
        email: input.email,
        name: input.name,
        passwordHash: hashedPassword,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      // 1. システム管理者
      {
        id: "admin",
        name: "システム管理者",
        description: "システム全般の設定・全マスタデータの統制・権限管理",
        createdAt: now,
      },
      // 2. ワークフロー管理者 💡 追加
      {
        id: "workflow_admin",
        name: "ワークフロー管理者",
        description: "全ワークフローの決裁・閲覧・処理状況の統制・監視",
        createdAt: now,
      },
      {
        userId: rootAdminId,
        roleId: "admin",
        departmentSurrogateId: null,
      },
    );

    // 標準の権限枠(画面 × 操作)を作る。ロールへの権限の割り当て(画面・CSV)の前提になる(BUG-001)
    await new PermissionsService(this.env).ensureStandardPermissions();

    await logAuditEvent(c, "SETUP_INITIAL_ADMIN", RESOURCE_KEY, rootAdminId, null, {
      employeeNumber: input.employeeNumber,
      email: input.email,
      name: input.name,
      roleId: "admin",
    });
  }

  // 💡 操作を行っているユーザーがシステム管理者(admin)であるか判定するヘルパー
  private async checkIsSystemAdmin(operatorUserId: string): Promise<boolean> {
    const now = new Date();
    const matrixRels = await this.repo.fetchUserMatrixRelations(now);
    const myRels = matrixRels.filter((r) => r.userId === operatorUserId);
    return myRels.some((r) => r.roleId === "admin");
  }

  async getUserList(query: UserListQueryInput) {
    const now = new Date();
    const status = query.status || "active";
    const searchEmpNum = query.employeeNumber?.trim();
    const searchName = query.name?.trim();
    const searchNameMode = query.nameMode || "partial";
    const searchEmail = query.email?.trim();
    const searchEmailMode = query.emailMode || "partial";

    const conditions = [];
    if (status === "active") conditions.push(eq(schema.users.isActive, true));
    else if (status === "inactive")
      conditions.push(eq(schema.users.isActive, false));

    if (searchEmpNum)
      conditions.push(containsText(schema.users.employeeNumber, searchEmpNum));

    if (searchName) {
      conditions.push(
        searchNameMode === "exact"
          ? eq(schema.users.name, searchName)
          : containsText(schema.users.name, searchName),
      );
    }

    if (searchEmail) {
      conditions.push(
        searchEmailMode === "exact"
          ? eq(schema.users.email, searchEmail)
          : containsText(schema.users.email, searchEmail),
      );
    }

    const rawUsers = await this.repo.fetchFilteredUsers(conditions);
    const matrixRels = await this.repo.fetchUserMatrixRelations(now);

    const filtered = rawUsers
      .map((u) => {
        const myRels = matrixRels.filter((r) => r.userId === u.id);
        const mappedRelations = myRels.map((r) => ({
          departmentId: r.departmentId || null,
          departmentName:
            r.departmentName ||
            (r.roleId === "admin" || r.roleId === "workflow_admin"
              ? "全社共通"
              : "名称未設定"),
          roleId: r.roleId,
          roleName: r.roleName,
        }));

        return {
          id: u.id,
          employeeNumber: u.employeeNumber,
          name: u.name,
          email: u.email,
          isActive: u.isActive,
          slackUserId: u.slackUserId ?? null,
          notificationChannel: u.notificationChannel ?? "email",
          relations: mappedRelations,
        };
      })
      .filter((user) => {
        if (
          query.departmentId &&
          !user.relations.some((r) => r.departmentId === query.departmentId)
        ) {
          return false;
        }
        if (
          query.roleId &&
          !user.relations.some((r) => r.roleId === query.roleId)
        ) {
          return false;
        }
        return true;
      });

    return applyInMemorySort(
      filtered,
      { sortBy: query.sortBy, sortOrder: query.sortOrder },
      USERS_SORT_COLUMNS,
    );
  }

  // department/role条件がSQLでなくJS側フィルタのため、全件取得後にin-memoryでページ分割する
  async getUserListPage(query: UserListQueryInput, params: PaginationParams) {
    const all = await this.getUserList(query);
    const start = toOffset(params);
    const data = all.slice(start, start + params.limit);
    return buildListResponse(data, buildPaginationMeta(params, all.length));
  }

  async registerUser(c: Context<{ Bindings: Env }>, input: RegisterUserInput) {
    const slackUserId = input.slackUserId?.trim() || null;
    const notificationChannel = input.notificationChannel ?? "email";
    if (notificationChannel === "slack" && !slackUserId) {
      throw new BadRequestError("通知方法を「Slack」にする場合はSlackメンバーIDの入力が必要です");
    }
    const now = new Date();
    const newUserId = crypto.randomUUID();
    // BUG-046: 管理者が入力したパスワードは、会社設定のルールを確かめずにそのまま使う。
    // 入力が無い場合は、ルールを満たす初期パスワードを暗号用の乱数で作る
    const initialPassword =
      input.password ||
      generateInitialPassword(await getPasswordPolicy(this.env.COMPANY_SETTINGS));
    const hashedPassword = await hashPassword(initialPassword);

    await this.repo.createUser(
      {
        id: newUserId,
        employeeNumber: input.employeeNumber,
        email: input.email,
        name: input.name,
        passwordHash: hashedPassword,
        isActive: true,
        slackUserId,
        notificationChannel,
        createdAt: now,
        updatedAt: now,
      },
      input.relations || [],
      now,
    );

    if (input.sendEmail) {
      const companySettings = this.env.COMPANY_SETTINGS;
      if (companySettings) {
        await companySettings.put(`require_change:${newUserId}`, "true", {
          expirationTtl: 259200,
        });

        const systemConfig = (await getCompanySettings(companySettings)) || {};
        const siteUrl = (systemConfig.site_url || "http://localhost:3000").replace(/\/$/, "");
        const companyName = systemConfig.company_name || "販売管理システム";

        await enqueueNotification({
          dbLog: this.env.DB_LOG,
          type: "email",
          category: "account_creation",
          documentId: newUserId,
          recipientTo: input.email,
          subject: "【販売管理システム】アカウント開設のお知らせ",
          body: [
            `${input.name} 様`,
            "",
            `「${companyName}」へのアカウント登録が完了いたしました。`,
            `以下の初期パスワードを使用してシステムへログインしてください。`,
            "",
            `■ ログインURL: ${siteUrl}/login`,
            `■ 初期パスワード: ${initialPassword}`,
            "",
            `※ 初回ログイン時にパスワードの変更が必要です。`,
          ].join("\n"),
          performedById: newUserId,
        });
      }
    }

    await logAuditEvent(c, "CREATE_USER", RESOURCE_KEY, newUserId, null, {
      employeeNumber: input.employeeNumber,
      name: input.name,
      email: input.email,
      relations: input.relations,
    });
  }

  async exportCsvBuffer(
    c: Context<{ Bindings: Env }>,
    query: UserListQueryInput,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const users = await this.getUserList(query);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_USERS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      recordCount: users.length,
    }),
    );

    const headers = [
      "employeeNumber",
      "name",
      "email",
      "departmentId",
      "roleId",
      "passwordRaw",
      "slackUserId",
      "notificationChannel",
    ];
    const rows: string[] = [];

    users.forEach((u) => {
      const emp = csvField(u.employeeNumber || "");
      const name = csvField(u.name || "");
      const email = csvField(u.email || "");
      const pass = `""`;
      const slackUserId = csvField(u.slackUserId || "");
      const channel = csvField(u.notificationChannel || "email");

      if (u.relations.length === 0) {
        rows.push([emp, name, email, `""`, `""`, pass, slackUserId, channel].join(","));
      } else {
        u.relations.forEach((rel) => {
          const deptId = csvField(rel.departmentId || "");
          const roleId = csvField(rel.roleId || "");
          rows.push([emp, name, email, deptId, roleId, pass, slackUserId, channel].join(","));
        });
      }
    });

    return toCsvBytes(buildCsvContent(headers, rows));
  }

  async bulkRegisterFromCsv(
    c: Context<{ Bindings: Env }>,
    file: File,
  ): Promise<number> {
    const text = await file.text();
    const allRows = parseCsv(text);

    // 追加要望B: 出力形式は末尾にSlack列(slackUserId,notificationChannel)を持つ。
    // 従来の6列形式のCSVも受け付け、その場合はSlack設定を変更しない(後方互換)
    const LEGACY_HEADER = "employeeNumber,name,email,departmentId,roleId,passwordRaw";
    const headerLine = allRows[0]?.join(",");
    const hasSlackColumns = headerLine === `${LEGACY_HEADER},slackUserId,notificationChannel`;
    if (allRows.length <= 1 || (headerLine !== LEGACY_HEADER && !hasSlackColumns)) {
      throw new BadRequestError("CSVヘッダー書式が正しくありません");
    }

    // Slack列がある場合は、書き込み前に全行を検証する(途中で失敗して一部だけ反映されるのを防ぐ)
    if (hasSlackColumns) {
      allRows.slice(1).forEach((columns, index) => {
        const [employeeNumber, , , , , , slackUserId, channel] = columns;
        if (!employeeNumber || employeeNumber === "admin") return;
        const normalizedChannel = (channel || "").trim() || "email";
        if (normalizedChannel !== "email" && normalizedChannel !== "slack") {
          throw new BadRequestError(
            `${index + 2}行目: notificationChannelは email または slack を指定してください`,
          );
        }
        if (normalizedChannel === "slack" && !(slackUserId || "").trim()) {
          throw new BadRequestError(
            `${index + 2}行目: 通知方法がslackの場合はslackUserIdが必要です`,
          );
        }
      });
    }

    const now = new Date();
    let successCount = 0;
    const clearedUserIds = new Set<string>();

    for (const columns of allRows.slice(1)) {
      const [
        employeeNumber,
        name,
        email,
        departmentId,
        roleId,
        passwordRaw,
        slackUserIdRaw,
        channelRaw,
      ] = columns;

      if (!employeeNumber || !email || !name || employeeNumber === "admin")
        continue;

      // BUG-049: 1行ごとに、ユーザーの登録・更新と役割(権限)の削除・登録を1回の batch で書き込む
      // (役割を消した後に失敗して、権限が無くなることがないように)。同じ社員が複数の行にあるため、ファイル全体ではまとめない
      const tx = recordWritesForBatch(this.repo);
      const uid = await tx.repo.upsertUserForBulk(
        employeeNumber,
        email,
        name,
        passwordRaw,
        clearedUserIds,
        now,
        hasSlackColumns
          ? {
              slackUserId: (slackUserIdRaw || "").trim() || null,
              notificationChannel: ((channelRaw || "").trim() || "email") as "email" | "slack",
            }
          : undefined,
      );

      if (roleId) {
        await tx.repo.insertUserRelations(
          uid,
          [{ roleId, departmentId }],
          now,
        );
      }
      await tx.commit();
      successCount++;
    }

    await logAuditEvent(c, "BULK_REGISTER_USERS", RESOURCE_KEY, "BATCH_PROCESS", null, {
      successCount,
    });

    return successCount;
  }

  async updateUserProfile(
    c: Context<{ Bindings: Env }>,
    id: string,
    input: UpdateUserInput,
    operatorUserId?: string, // 💡 操作者IDを受け取る引数を追加
  ) {
    // 💡 操作者が admin でない場合（workflow_adminなど）は拒否
    if (operatorUserId) {
      const isAdmin = await this.checkIsSystemAdmin(operatorUserId);
      if (!isAdmin) {
        throw new ForbiddenError(
          "ユーザーを編集する権限がありません(システム管理者のみ可能です)",
        );
      }
    }

    const current = await this.repo.findById(id);
    if (!current) throw new NotFoundError("ユーザーが見つかりません");
    if (current.employeeNumber === "admin" && input.isActive === false) {
      throw new BadRequestError(
        "初期システム管理者を無効化することはできません",
      );
    }

    // 追加要望B: Slack通知設定は指定された項目のみ更新する。更新後の組み合わせで「Slack」なのにIDが無い状態は拒否
    const nextSlackUserId =
      input.slackUserId !== undefined ? input.slackUserId?.trim() || null : current.slackUserId;
    const nextChannel = input.notificationChannel ?? current.notificationChannel ?? "email";
    if (nextChannel === "slack" && !nextSlackUserId) {
      throw new BadRequestError("通知方法を「Slack」にする場合はSlackメンバーIDの入力が必要です");
    }

    const now = new Date();
    const oldSnapshot = { ...current, passwordHash: "[REDACTED]" };
    const updateData: Record<string, any> = {
      name: input.name,
      email: input.email,
      isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
      updatedAt: now,
    };
    if (input.slackUserId !== undefined) updateData.slackUserId = nextSlackUserId;
    if (input.notificationChannel !== undefined) updateData.notificationChannel = nextChannel;
    if (input.password)
      updateData.passwordHash = await hashPassword(input.password);

    await this.repo.updateUserProfile(
      id,
      updateData,
      input.relations || [],
      now,
    );

    // BUG-024: 無効化・パスワードの変更をしたら、そのユーザーのそれまでのログインを無効にする
    if (updateData.isActive === false || input.password) {
      await new LoginStateRepository(this.env.DB).revokeSessions(id, now);
    }

    await logAuditEvent(c, "UPDATE_USER_PROFILES", RESOURCE_KEY, id, oldSnapshot, {
      name: input.name,
      email: input.email,
      isActive: input.isActive,
      slackUserId: nextSlackUserId,
      notificationChannel: nextChannel,
      relations: input.relations,
    });
  }

  async suspendUser(
    c: Context<{ Bindings: Env }>,
    id: string,
    operatorUserId?: string, // 💡 操作者IDを受け取る引数を追加
  ) {
    // 💡 操作者が admin でない場合（workflow_adminなど）は拒否
    if (operatorUserId) {
      const isAdmin = await this.checkIsSystemAdmin(operatorUserId);
      if (!isAdmin) {
        throw new ForbiddenError(
          "ユーザーを無効化する権限がありません(システム管理者のみ可能です)",
        );
      }
    }

    const current = await this.repo.findById(id);
    if (!current) throw new NotFoundError("ユーザーが見つかりません");
    if (current.employeeNumber === "admin")
      throw new BadRequestError(
        "初期システム管理者を無効化することはできません",
      );

    const oldSnapshot = { ...current, passwordHash: "[REDACTED]" };
    await this.repo.suspendUser(id);
    await new LoginStateRepository(this.env.DB).revokeSessions(id); // BUG-024

    await logAuditEvent(c, "SUSPEND_USER_ACCOUNT", RESOURCE_KEY, id, oldSnapshot, {
      isActive: false,
      autoClearedRelations: true,
    });
  }

  async purgeUser(
    c: Context<{ Bindings: Env }>,
    id: string,
    operatorUserId?: string, // 💡 操作者IDを受け取る引数を追加
  ) {
    // 💡 操作者が admin でない場合（workflow_adminなど）は拒否
    if (operatorUserId) {
      const isAdmin = await this.checkIsSystemAdmin(operatorUserId);
      if (!isAdmin) {
        throw new ForbiddenError(
          "ユーザーを削除する権限がありません(システム管理者のみ可能です)",
        );
      }
    }

    const current = await this.repo.findById(id);
    if (!current) throw new NotFoundError("ユーザーが見つかりません");
    if (current.employeeNumber === "admin")
      throw new BadRequestError("初期システム管理者は物理削除できません");

    const oldSnapshot = { ...current, passwordHash: "[REDACTED]" };
    try {
      await this.repo.purgeUser(id);
      await new LoginStateRepository(this.env.DB).delete(id); // BUG-022・024: ログインの状態も消す
    } catch (err) {
      if (err instanceof Error && err.message === "HAS_RELATIONS_REMAINING") {
        throw new BadRequestError(
          "まだ所属・権限マトリックスが残っているため削除できません",
        );
      }
      throw err;
    }

    await logAuditEvent(c, "PURGE_USER_ACCOUNT", RESOURCE_KEY, id, oldSnapshot, null);
  }
}
