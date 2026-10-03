import { Context } from "hono";
import { PermissionsRepository } from "./permissions.repository";
import { SCREEN_MASTER } from "../../../constants/screens";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { BulkCreatePermissionsInput } from "./permissions.schema";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { toCsvBytes, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { BadRequestError } from "../../../platform/http/http-error";

const RESOURCE_KEY = "admin_permissions";

/**
 * 画面ごとの標準の操作。画面・権限マスタの画面(frontend の app/admin/permissions/_types の
 * STANDARD_ACTIONS)と同じ内容にする(同じ ID・名前の権限枠を作るため)
 */
export const STANDARD_PERMISSION_ACTIONS = [
  { key: "menu", label: "メニュー表示" },
  { key: "read", label: "閲覧 (R)" },
  { key: "create", label: "登録 (C)" },
  { key: "update", label: "編集 (U)" },
  { key: "delete", label: "削除 (D)" },
] as const;

/** 画面マスタ(SCREEN_MASTER)× 標準の操作 の権限枠の一覧 */
export function buildStandardPermissions() {
  return SCREEN_MASTER.flatMap((screen) =>
    STANDARD_PERMISSION_ACTIONS.map((act) => ({
      id: `${screen.resource}:${act.key}`.toLowerCase(),
      resource: screen.resource,
      action: act.key,
      name: `${screen.name} [${act.label}]`,
      description: `${screen.name}画面における${act.label}標準権限(自動初期展開)`,
    })),
  );
}

export class PermissionsService {
  private repo: PermissionsRepository;

  constructor(env: Env) {
    this.repo = new PermissionsRepository(env);
  }

  // KVキャッシュ削除用プライベートヘルパー
  private async clearRoleCache(kv: KVNamespace, roleId: string) {
    try {
      await kv.delete(`role_permissions:${roleId}`);
    } catch (err) {
      console.error(`[KV Cache Delete Error] Role ID: ${roleId}`, err);
    }
  }

  // 1. 画面マスタ定義の取得
  getScreenMaster() {
    return SCREEN_MASTER;
  }

  // 2. 機能権限マスタ一覧の取得
  async getAllPermissions() {
    return await this.repo.findAllPermissions();
  }

  async getPermissionsPage(params: PaginationParams) {
    const [data, total] = await Promise.all([
      this.repo.findPermissionsPage(params),
      this.repo.countPermissions(),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  // 3. 基本権限の一括自動生成
  async bulkCreatePermissions(
    c: Context<{ Bindings: Env }>,
    items: BulkCreatePermissionsInput["items"],
  ) {
    if (items.length === 0) {
      return { success: true, message: "処理対象データがありません" };
    }

    const queries = items.map((item) =>
      this.repo.buildInsertPermissionQuery({
        id: item.id.trim().toLowerCase(),
        resource: item.resource.trim().toLowerCase(),
        action: item.action.trim().toLowerCase(),
        name: item.name.trim(),
        description: item.description?.trim() || null,
      }),
    );

    await this.repo.executeBatch(queries);

    c.executionCtx.waitUntil(
      logAuditEvent(
      c,
      "BULK_CREATE_PERMISSION_KEYS",
      RESOURCE_KEY,
      "BULK_AUTO_GENERATION",
      null,
      { count: items.length },
    ),
    );

    return {
      success: true,
      message: `${items.length}件の基本権限枠を一括自動展開しました`,
    };
  }

  /**
   * 標準の権限枠(画面 × 操作)のうち、無いものを作る。既にあるものは変更しない。
   * BUG-006 と同時期の BUG-001(2026-09-23): 以前は管理者が「画面・権限マスタ」の画面を開いた時に
   * 画面側で作っていたため、画面を開く前に CSV でロールの権限を取り込むと 500 エラーになっていた。
   * 初期設定(管理者の作成時)と、ロール×権限の CSV 取込の前に、Backend で作るようにした
   */
  async ensureStandardPermissions() {
    const queries = buildStandardPermissions().map((p) => this.repo.buildInsertPermissionIfMissingQuery(p));
    if (queries.length > 0) await this.repo.executeBatch(queries as [any, ...any[]]);
  }

  // 4. ロール紐づく権限ID一覧の取得 (KVキャッシュ付き)
  async getPermissionsByRoleId(c: Context<{ Bindings: Env }>, roleId: string) {
    try {
      const cached: string[] | null = await c.env.KV_PERMISSIONS.get(
        `role_permissions:${roleId}`,
        { type: "json" },
      );
      if (cached !== null) return cached;
    } catch (kvErr) {
      console.error("[KV Read Error]", kvErr);
    }

    const result = await this.repo.findPermissionsByRoleId(roleId);
    const permissionIds = result.map((r) => r.permissionId);

    try {
      await c.env.KV_PERMISSIONS.put(
        `role_permissions:${roleId}`,
        JSON.stringify(permissionIds),
        { expirationTtl: 86400 },
      );
    } catch (kvErr) {
      console.error("[KV Write Error]", kvErr);
    }

    return permissionIds;
  }

  // 5. ロールの権限上書き更新 (PUT)
  async updateRolePermissions(
    c: Context<{ Bindings: Env }>,
    roleId: string,
    permissionIds: string[],
  ) {
    const beforeMapping = await this.repo.findPermissionsByRoleId(roleId);

    const oldSnapshot = {
      roleId,
      assignedPermissions: beforeMapping.map((b) => b.permissionId),
    };

    const queries: any[] = [
      this.repo.buildDeleteRolePermissionsByRoleIdQuery(roleId),
    ];

    permissionIds.forEach((pId: string) => {
      queries.push(
        this.repo.buildInsertRolePermissionQuery({ roleId, permissionId: pId }),
      );
    });

    await this.repo.executeBatch(queries);
    await this.clearRoleCache(c.env.KV_PERMISSIONS, roleId);

    c.executionCtx.waitUntil(
      logAuditEvent(
      c,
      "UPDATE_ROLE_MATRIX_PERMISSIONS",
      "role_permissions",
      roleId,
      oldSnapshot,
      { roleId, assignedPermissions: permissionIds },
    ),
    );

    return {
      success: true,
      message: "ロールの権限設定を上書き更新しました",
    };
  }

  // 6. CSVダウンロード（ロール×権限マトリクス）
  async generateCsv(c: Context<{ Bindings: Env }>) {
    const result = await this.repo.findAllRolePermissions();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_ROLE_MATRIX_CSV", "role_permissions", "ALL_RECORDS", null, {
        recordCount: result.length,
      }),
    );

    const headers = ["role_id", "permission_id"];
    const rows = result.map((r) => {
      const escapedRoleId = csvField(r.roleId || "");
      const escapedPermissionId = csvField(r.permissionId || "");
      return [escapedRoleId, escapedPermissionId].join(",");
    });

    return toCsvBytes(buildCsvContent(headers, rows));
  }

  // 7. CSVインポート（ロール×権限マトリクス、ロール単位で全上書き）
  async importCsv(c: Context<{ Bindings: Env }>, file: File) {
    const text = await file.text();
    const allRows = parseCsv(text);

    if (allRows.length <= 1) {
      throw new BadRequestError("インポートするデータがありません");
    }

    if (allRows[0].join(",") !== "role_id,permission_id") {
      throw new BadRequestError("CSVヘッダー(role_id,permission_id)が一致しません");
    }

    const dataRows = allRows.slice(1);
    const mappings = dataRows
      .map(([roleId, permissionId]) => ({ roleId, permissionId }))
      .filter((m) => m.roleId && m.permissionId);

    if (mappings.length === 0) {
      throw new BadRequestError("有効なCSVデータが検出できません");
    }

    // 標準の権限枠が無いと、割り当て先が無く DB のエラー(500)になるため、先に作る(BUG-001)
    await this.ensureStandardPermissions();
    const existingIds = new Set((await this.repo.findAllPermissions()).map((p) => p.id));
    const unknownIds = Array.from(new Set(mappings.map((m) => m.permissionId))).filter((id) => !existingIds.has(id));
    if (unknownIds.length > 0) {
      throw new BadRequestError(
        `存在しない権限が含まれています: ${unknownIds.slice(0, 10).join(", ")}${unknownIds.length > 10 ? ` ほか${unknownIds.length - 10}件` : ""}`,
      );
    }

    const uniqueRoleIds = Array.from(new Set(mappings.map((m) => m.roleId)));

    const queries: any[] = uniqueRoleIds.map((rId) =>
      this.repo.buildDeleteRolePermissionsByRoleIdQuery(rId),
    );
    mappings.forEach((mapping) => {
      queries.push(this.repo.buildInsertRolePermissionQuery(mapping));
    });

    await this.repo.executeBatch(queries);

    for (const rId of uniqueRoleIds) {
      await this.clearRoleCache(c.env.KV_PERMISSIONS, rId);
    }

    c.executionCtx.waitUntil(
      logAuditEvent(
        c,
        "IMPORT_ROLE_MATRIX_CSV",
        "role_permissions",
        "CSV_IMPORT",
        null,
        { affectedRoles: uniqueRoleIds, totalCount: mappings.length },
      ),
    );

    return {
      success: true,
      message: `CSVから ${mappings.length} 件のデータをインポートしました`,
    };
  }
}
