import { Context } from "hono";
import { LocationsRepository } from "./locations.repository";
import {
  GetLocationsQuery,
  RegisterLocationInput,
  UpdateLocationInput,
} from "./locations.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { determineLocationInitialStatus } from "../../../workflow-engine/settings";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "master_locations";

export class LocationsService {
  constructor(private repo: LocationsRepository) {}

  async getLocations(query: GetLocationsQuery, sort?: SortQuery) {
    return await this.repo.findMany(query, sort);
  }

  async getLocationsPage(
    query: GetLocationsQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.findManyPage(query, params, sort),
      this.repo.countMany(query),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async registerLocation(
    c: Context<{ Bindings: Env }>,
    input: RegisterLocationInput,
  ) {
    const now = new Date();
    const operatorId = await this.repo.getFallbackOperatorId(c);

    // Item5: クライアントの送信値は受け付けず、会社設定の承認フラグからサーバー側で強制する
    const status = await determineLocationInitialStatus(
      c.env.COMPANY_SETTINGS,
    );

    await this.repo.insert({
      id: input.id,
      warehouseId: input.warehouseId,
      name: input.name,
      memo: input.memo || null,
      status,
      createdBy: operatorId,
      createdAt: now,
      updatedBy: operatorId,
      updatedAt: now,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_LOCATION", RESOURCE_KEY, input.id, null, {
      id: input.id,
      warehouseId: input.warehouseId,
      name: input.name,
      memo: input.memo || null,
      status,
    }),
    );

    return { success: true, message: "ロケーションを登録しました", status };
  }

  async suspendLocation(c: Context<{ Bindings: Env }>, id: string) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象のロケーションが見つかりません");
    }

    await this.repo.update(id, {
      status: "suspended",
      updatedBy: operatorId,
      updatedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUSPEND_LOCATION", RESOURCE_KEY, id, oldSnapshot, {
      id,
      status: "suspended",
    }),
    );

    return { success: true, message: "ロケーションを無効化しました" };
  }

  async updateLocation(
    c: Context<{ Bindings: Env }>,
    id: string,
    input: UpdateLocationInput,
  ) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findById(id);

    await this.repo.update(id, {
      warehouseId: input.warehouseId,
      name: input.name,
      memo: input.memo || null,
      status: input.status,
      updatedBy: operatorId,
      updatedAt: new Date(),
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_LOCATION", RESOURCE_KEY, id, oldSnapshot, {
      id,
      warehouseId: input.warehouseId,
      name: input.name,
      memo: input.memo || null,
      status: input.status,
    }),
    );

    return { success: true, message: "ロケーション情報を更新しました" };
  }

  async deleteLocation(c: Context<{ Bindings: Env }>, id: string) {
    const oldSnapshot = await this.repo.findById(id);

    if (!oldSnapshot) {
      throw new NotFoundError("削除対象のロケーションが見つかりません");
    }

    // Item5: partners.purge()と同じ制約。無効化(suspended)済みのデータのみ物理削除できる
    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効化状態のロケーションのみ物理削除できます",
      );
    }

    await this.repo.delete(id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_LOCATION", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return { success: true, message: "ロケーションを削除しました" };
  }

  async downloadCsv(c: Context<{ Bindings: Env }>, query: GetLocationsQuery) {
    const data = await this.repo.findMany(query);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_LOCATIONS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      recordCount: data.length,
    }),
    );

    const headers = ["id", "warehouseId", "name", "status", "memo"];
    const rows = data.map((l) =>
      [
        csvField(`${l.id}`),
        csvField(`${l.warehouseId}`),
        csvField(l.name),
        csvField(`${l.status}`),
        csvField(l.memo || ""),
      ].join(","),
    );

    return withBom(buildCsvContent(headers, rows));
  }

  async bulkRegisterCsv(c: Context<{ Bindings: Env }>, fileText: string) {
    const now = new Date();
    const operatorId = await this.repo.getFallbackOperatorId(c);

    const allRows = parseCsv(fileText);

    // warehouses.service.tsのbulkRegisterCsvと同じ方針(列名でインデックスを引く)。
    // status列が無い旧形式のCSVもそのままインポートできるよう、列自体が無い/空の場合は
    // "active"を補う(未指定のままだとDB既定値の"temporary"になり、一覧に出てこなくなるため)
    const header = allRows.length > 0 ? allRows[0].map((h) => h.trim()) : [];
    const idxId = header.indexOf("id");
    const idxWarehouseId = header.indexOf("warehouseId");
    const idxName = header.indexOf("name");
    const idxStatus = header.indexOf("status");
    const idxMemo = header.indexOf("memo");

    const recordsToInsert = [];
    for (const cols of allRows.slice(1)) {
      const id = idxId !== -1 ? cols[idxId] : undefined;
      const warehouseId = idxWarehouseId !== -1 ? cols[idxWarehouseId] : undefined;
      const name = idxName !== -1 ? cols[idxName] : undefined;

      if (!id || !warehouseId || !name) continue;

      recordsToInsert.push({
        id,
        warehouseId,
        name,
        memo: (idxMemo !== -1 ? cols[idxMemo] : null) || null,
        status: (idxStatus !== -1 ? cols[idxStatus] : "") || "active",
        opId: operatorId,
        now,
      });
    }

    const successCount = await this.repo.bulkUpsert(recordsToInsert);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_LOCATIONS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
      processedCount: successCount,
    }),
    );

    return {
      success: true,
      message: `CSVから ${successCount} 件のロケーションデータを同期しました`,
    };
  }
}
