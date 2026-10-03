import { Context } from "hono";
import { RolesRepository } from "./roles.repository";
import { writeAuditLog } from "../../../utils/logger";
import { checkAuditLogEnabled } from "../../../utils/auditcheck";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { toCsvBytes, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { CreateRoleInput, UpdateRoleInput } from "./roles.schema";
import {
  BadRequestError,
  NotFoundError,
  isForeignKeyConstraintError,
} from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "admin_roles";

export class RolesService {
  private repo: RolesRepository;

  constructor(env: Env) {
    this.repo = new RolesRepository(env);
  }

  // 1. 一覧取得
  async getAllRoles(sort?: SortQuery) {
    return await this.repo.findAll(sort);
  }

  async getRolesPage(params: PaginationParams, sort?: SortQuery) {
    const [data, total] = await Promise.all([
      this.repo.findPage(params, sort),
      this.repo.countAll(),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  // 2. 新規作成
  async createRole(c: Context<{ Bindings: Env }>, input: CreateRoleInput) {
    const { id, name, description } = input;

    await this.repo.insertRole({
      id,
      name,
      description: description ?? null,
      createdAt: new Date(),
    });

    await logAuditEvent(c, "CREATE_ROLE", RESOURCE_KEY, id, null, {
      id,
      name,
      description: description ?? null,
    });

    return { success: true, message: "役職ロールを新設しました" };
  }

  // 3. 変更 (PUT)
  async updateRole(
    c: Context<{ Bindings: Env }>,
    id: string,
    input: UpdateRoleInput,
  ) {
    const { name, description } = input;

    if (id === "admin") {
      throw new BadRequestError(
        "システム基本ロールの情報を変更することはできません",
      );
    }

    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象のロールが見つかりません");
    }

    const cleanDescription = description ?? null;

    await this.repo.updateRole(id, {
      name,
      description: cleanDescription,
    });

    await logAuditEvent(c, "UPDATE_ROLE", RESOURCE_KEY, id, oldSnapshot, {
      id,
      name,
      description: cleanDescription,
    });

    return { success: true, message: "ロール情報を更新しました" };
  }

  // 4. 削除 (DELETE)
  async deleteRole(c: Context<{ Bindings: Env }>, id: string) {
    if (id === "admin") {
      throw new BadRequestError("システム基本ロールは削除できません");
    }

    try {
      const oldSnapshot = await this.repo.findById(id);

      await this.repo.deleteRole(id);

      await logAuditEvent(c, "DELETE_ROLE", RESOURCE_KEY, id, oldSnapshot, null);

      return { success: true, message: "ロールを削除しました" };
    } catch (err) {
      console.error("ロール削除エラー詳細:", err);

      let friendlyMessage = "ロールの削除中にエラーが発生しました。";
      if (isForeignKeyConstraintError(err)) {
        friendlyMessage =
          "このロールは、既にユーザーに割り当てられているか、承認フローの定義で使用されているため削除できません。先に該当する設定を変更してください。";
      } else if (err instanceof Error) {
        friendlyMessage = `削除エラーが発生しました。(${err.message})`;
      }

      throw new BadRequestError(friendlyMessage);
    }
  }

  // 5. CSVダウンロード
  async generateCsv(c: Context<{ Bindings: Env }>) {
    const result = await this.repo.findAll();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_ROLES_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      recordCount: result.length,
    }),
    );

    const headers = ["id", "name", "description"];
    const rows = result.map((r) => {
      const escapedId = csvField(r.id || "");
      const escapedName = csvField(r.name || "");
      const escapedDesc = csvField(r.description || "");
      return [escapedId, escapedName, escapedDesc].join(",");
    });

    return toCsvBytes(buildCsvContent(headers, rows));
  }

  // 6. CSVインポート
  async importCsv(c: Context<{ Bindings: Env }>, file: File) {
    const text = await file.text();
    const allRows = parseCsv(text);

    if (allRows.length <= 1) {
      throw new BadRequestError("インポートするデータがありません");
    }

    if (allRows[0].join(",") !== "id,name,description") {
      throw new BadRequestError("CSVヘッダー(id,name,description)が一致しません");
    }

    const dataRows = allRows.slice(1);
    let successCount = 0;
    const isAuditEnabled = await checkAuditLogEnabled(c.env.COMPANY_SETTINGS);

    for (const columns of dataRows) {
      const [id, name, description] = columns;
      if (!id || !name) continue;

      const cleanId = id.trim().toLowerCase();

      await this.repo.upsertRole({
        id: cleanId,
        name: name.trim(),
        description: description?.trim() || null,
        createdAt: new Date(),
      });

      await writeAuditLog(
        c,
        "IMPORT_ROLE",
        RESOURCE_KEY,
        cleanId,
        null,
        { id: cleanId, name, description },
        isAuditEnabled,
      );
      successCount++;
    }

    return {
      success: true,
      message: `${successCount}件のロールをインポート・更新しました`,
    };
  }
}
