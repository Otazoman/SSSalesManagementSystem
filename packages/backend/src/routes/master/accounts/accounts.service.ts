import { Context } from "hono";
import { AccountsRepository } from "./accounts.repository";
import {
  GetAccountsQuery,
  RegisterAccountInput,
  UpdateAccountInput,
} from "./accounts.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import {
  BadRequestError,
  NotFoundError,
  isForeignKeyConstraintError,
} from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { determineAccountInitialStatus } from "../../../workflow-engine/settings";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "master_accounts";

export class AccountsService {
  constructor(private repo: AccountsRepository) {}

  async getAccounts(query: GetAccountsQuery, sort?: SortQuery) {
    return await this.repo.findMany(query, sort);
  }

  async getAccountsPage(
    query: GetAccountsQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.findManyPage(query, params, sort),
      this.repo.countMany(query),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async registerAccount(
    c: Context<{ Bindings: Env }>,
    input: RegisterAccountInput,
  ) {
    const opId = await this.repo.getFallbackOperatorId(c);
    // 承認機能展開: クライアントの送信値は受け付けず、会社設定の承認フラグからサーバー側で強制する
    const status = await determineAccountInitialStatus(c.env.COMPANY_SETTINGS);

    await this.repo.insert({
      code: input.code,
      name: input.name,
      externalMappingCode: input.externalMappingCode || null,
      status,
      memo: input.memo || null,
      createdBy: opId,
      createdAt: new Date(),
      updatedBy: opId,
      updatedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_ACCOUNT_SUBJECT", RESOURCE_KEY, input.code, null, {
      code: input.code,
      name: input.name,
      externalMappingCode: input.externalMappingCode || null,
      status,
      memo: input.memo || null,
    }),
    );

    return {
      success: true,
      message: "科目を登録しました",
      status,
    };
  }

  async suspendAccount(c: Context<{ Bindings: Env }>, code: string) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();

    const oldSnapshot = await this.repo.findByCode(code);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の科目が見つかりません");
    }

    await this.repo.update(code, {
      status: "suspended",
      updatedBy: opId,
      updatedAt: now,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUSPEND_ACCOUNT_SUBJECT", RESOURCE_KEY, code, oldSnapshot, {
      status: "suspended",
    }),
    );

    return { success: true, message: "該当科目を利用停止しました" };
  }

  async updateAccount(
    c: Context<{ Bindings: Env }>,
    code: string,
    input: UpdateAccountInput,
  ) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findByCode(code);

    const nextStatus = input.status || oldSnapshot?.status || "temporary";

    await this.repo.update(code, {
      name: input.name,
      externalMappingCode: input.externalMappingCode || null,
      status: nextStatus,
      memo: input.memo || null,
      updatedBy: opId,
      updatedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_ACCOUNT_SUBJECT", RESOURCE_KEY, code, oldSnapshot, {
      code,
      name: input.name,
      externalMappingCode: input.externalMappingCode || null,
      status: nextStatus,
      memo: input.memo || null,
    }),
    );

    return { success: true, message: "科目を更新しました" };
  }

  async deleteAccount(c: Context<{ Bindings: Env }>, code: string) {
    const oldSnapshot = await this.repo.findByCode(code);

    if (!oldSnapshot) {
      throw new NotFoundError("対象の科目が見つかりません");
    }
    // 他マスタ(商品/倉庫/商品単価)と同じく、無効化(suspended)を経由した科目のみ物理削除を許可する。
    // 以前はactiveのみ拒否していたため、無効化を挟まずtemporaryから直接削除できてしまっていた。
    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効化状態の科目のみ物理削除できます",
      );
    }

    try {
      await this.repo.delete(code);
    } catch (err) {
      if (isForeignKeyConstraintError(err)) {
        throw new BadRequestError(
          "この科目は品目や在庫トランザクションで既に使用されているため削除できません",
        );
      }
      throw err; // 予期せぬエラーは上方に投げて 500 キャッチへ導く
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_ACCOUNT_SUBJECT", RESOURCE_KEY, code, oldSnapshot, null),
    );

    return { success: true, message: "科目を削除しました" };
  }

  async downloadCsv(c: Context<{ Bindings: Env }>, query: GetAccountsQuery) {
    const data = await this.repo.findMany(query);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_ACCOUNTS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      recordCount: data.length,
    }),
    );

    const headers = ["code", "name", "externalMappingCode", "status", "memo"];
    const rows = data.map((a) =>
      [
        csvField(`${a.code}`),
        csvField(a.name),
        csvField(a.externalMappingCode || ""),
        csvField(`${a.status}`),
        csvField(a.memo || ""),
      ].join(","),
    );

    return withBom(buildCsvContent(headers, rows));
  }

  async bulkRegisterCsv(c: Context<{ Bindings: Env }>, fileText: string) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const allRows = parseCsv(fileText);

    const recordsToInsert = [];
    for (const [code, name, externalMappingCode, status, memo] of allRows.slice(
      1,
    )) {
      if (!code || !name) continue;

      const targetStatus =
        status === "active" || status === "suspended" ? status : "temporary";

      recordsToInsert.push({
        code,
        name,
        externalMappingCode: externalMappingCode || null,
        status: targetStatus,
        memo: memo || null,
        opId,
      });
    }

    const count = await this.repo.bulkUpsert(recordsToInsert);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_ACCOUNTS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
      processedCount: count,
    }),
    );

    return {
      success: true,
      message: `${count}件の科目をパース・同期しました(新規追加分は承認待ち状態となります)`,
    };
  }
}
