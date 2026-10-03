import { Context } from "hono";
import { ProjectsRepository } from "./projects.repository";
import { GetProjectsQuery, RegisterProjectInput, UpdateProjectInput } from "./projects.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { SortQuery } from "../../../platform/http/sort";
import { generateUniqueMasterCode } from "../../../platform/id/resolve-master-id";

const RESOURCE_KEY = "master_projects";

// J-2-e(2026-09-13ユーザー確認済み): プロジェクトマスタ。承認ワークフローは対象外のため
// (locations等のtemporary仮登録とは異なり)active/suspendedの2状態のみで、
// 新規登録は常にactiveとして即時反映する
export class ProjectsService {
  constructor(private repo: ProjectsRepository) {}

  async getProjects(query: GetProjectsQuery, sort?: SortQuery) {
    return await this.repo.findMany(query, sort);
  }

  async getProjectsPage(query: GetProjectsQuery, params: PaginationParams, sort?: SortQuery) {
    const [data, total] = await Promise.all([
      this.repo.findManyPage(query, params, sort),
      this.repo.countMany(query),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async registerProject(c: Context<{ Bindings: Env }>, input: RegisterProjectInput) {
    const now = new Date();
    const operatorId = await this.repo.getFallbackOperatorId(c);

    // マスタコード自動採番: コード未入力時のみmaster_code_formatsの設定に基づき自動採番する。
    // 手入力されたコードが重複していた場合は明示的なエラーで弾く(partners.service.tsと同じ方針)
    const resolvedId =
      input.id?.trim() ||
      (await generateUniqueMasterCode(c, "projects", (id) =>
        this.repo.findById(id).then((r) => !!r),
      ));

    const existing = await this.repo.findById(resolvedId);
    if (existing) {
      throw new BadRequestError("登録エラー: 指定されたPJコードは既に存在します");
    }

    await this.repo.insert({
      id: resolvedId,
      name: input.name,
      memo: input.memo || null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      status: "active",
      createdBy: operatorId,
      createdAt: now,
      updatedBy: operatorId,
      updatedAt: now,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_PROJECT", RESOURCE_KEY, resolvedId, null, {
        id: resolvedId,
        name: input.name,
        memo: input.memo || null,
      }),
    );

    return { success: true, message: "プロジェクトを登録しました", id: resolvedId };
  }

  async updateProject(c: Context<{ Bindings: Env }>, id: string, input: UpdateProjectInput) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象のプロジェクトが見つかりません");
    }

    await this.repo.update(id, {
      name: input.name,
      memo: input.memo || null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      updatedBy: operatorId,
      updatedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_PROJECT", RESOURCE_KEY, id, oldSnapshot, {
        id,
        name: input.name,
        memo: input.memo || null,
      }),
    );

    return { success: true, message: "プロジェクト情報を更新しました" };
  }

  async suspendProject(c: Context<{ Bindings: Env }>, id: string) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象のプロジェクトが見つかりません");
    }

    await this.repo.update(id, {
      status: "suspended",
      updatedBy: operatorId,
      updatedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUSPEND_PROJECT", RESOURCE_KEY, id, oldSnapshot, {
        id,
        status: "suspended",
      }),
    );

    return { success: true, message: "プロジェクトを無効化しました" };
  }

  async deleteProject(c: Context<{ Bindings: Env }>, id: string) {
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("削除対象のプロジェクトが見つかりません");
    }

    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効化状態のプロジェクトのみ物理削除できます",
      );
    }

    await this.repo.delete(id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_PROJECT", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return { success: true, message: "プロジェクトを削除しました" };
  }

  async downloadCsv(c: Context<{ Bindings: Env }>, query: GetProjectsQuery) {
    const data = await this.repo.findMany(query);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_PROJECTS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: data.length,
      }),
    );

    const headers = ["id", "name", "status", "startDate", "endDate", "memo"];
    const rows = data.map((p) =>
      [
        csvField(`${p.id}`),
        csvField(p.name),
        csvField(`${p.status}`),
        csvField(`${p.startDate ? new Date(p.startDate).toISOString().split("T")[0] : ""}`),
        csvField(`${p.endDate ? new Date(p.endDate).toISOString().split("T")[0] : ""}`),
        csvField(p.memo || ""),
      ].join(","),
    );

    return withBom(buildCsvContent(headers, rows));
  }

  async bulkRegisterCsv(c: Context<{ Bindings: Env }>, fileText: string) {
    const now = new Date();
    const operatorId = await this.repo.getFallbackOperatorId(c);

    const allRows = parseCsv(fileText);
    const header = allRows.length > 0 ? allRows[0].map((h) => h.trim()) : [];
    const idxId = header.indexOf("id");
    const idxName = header.indexOf("name");
    const idxStatus = header.indexOf("status");
    const idxStartDate = header.indexOf("startDate");
    const idxEndDate = header.indexOf("endDate");
    const idxMemo = header.indexOf("memo");

    const recordsToInsert = [];
    for (const cols of allRows.slice(1)) {
      const id = idxId !== -1 ? cols[idxId] : undefined;
      const name = idxName !== -1 ? cols[idxName] : undefined;
      if (!id || !name) continue;

      const rawStart = idxStartDate !== -1 ? cols[idxStartDate] : "";
      const rawEnd = idxEndDate !== -1 ? cols[idxEndDate] : "";

      recordsToInsert.push({
        id,
        name,
        memo: (idxMemo !== -1 ? cols[idxMemo] : null) || null,
        startDate: rawStart ? new Date(rawStart) : null,
        endDate: rawEnd ? new Date(rawEnd) : null,
        status: (idxStatus !== -1 ? cols[idxStatus] : "") || "active",
        opId: operatorId,
        now,
      });
    }

    const successCount = await this.repo.bulkUpsert(recordsToInsert);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_PROJECTS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
        processedCount: successCount,
      }),
    );

    return {
      success: true,
      message: `CSVから ${successCount} 件のプロジェクトデータを同期しました`,
    };
  }
}
