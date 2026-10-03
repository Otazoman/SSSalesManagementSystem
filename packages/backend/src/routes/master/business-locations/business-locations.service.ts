import { Context } from "hono";
import { BusinessLocationsRepository } from "./business-locations.repository";
import { BusinessLocationUpsertInput } from "./business-locations.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import {
  BadRequestError,
  NotFoundError,
} from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { determineBusinessLocationInitialStatus } from "../../../workflow-engine/settings";
import { generateUniqueMasterCode } from "../../../platform/id/resolve-master-id";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "master_business_locations";

type BusinessLocationSearchParams = { id?: string; name?: string; status?: string };

export class BusinessLocationsService {
  private repo: BusinessLocationsRepository;

  constructor(repo: BusinessLocationsRepository) {
    this.repo = repo;
  }

  async getBusinessLocations(searchParams: BusinessLocationSearchParams, sort?: SortQuery) {
    return await this.repo.findBusinessLocations(searchParams, sort);
  }

  async getBusinessLocationsPage(
    searchParams: BusinessLocationSearchParams,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.findBusinessLocationsPage(searchParams, params, sort),
      this.repo.countBusinessLocations(searchParams),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async registerBusinessLocation(
    c: Context<{ Bindings: Env }>,
    body: BusinessLocationUpsertInput,
  ) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    // 承認機能展開(Item5方式): クライアントの送信値は受け付けず、会社設定の承認フラグからサーバー側で強制する
    const status = await determineBusinessLocationInitialStatus(c.env.COMPANY_SETTINGS);
    // マスタコード自動採番: コード未入力時のみmaster_code_formatsの設定に基づき自動採番する
    const resolvedId =
      body.id?.trim() ||
      (await generateUniqueMasterCode(c, "business_locations", (id) =>
        this.repo.findById(id).then((r) => !!r),
      ));
    await this.repo.createBusinessLocation({ ...body, id: resolvedId, status }, operatorId);

    try {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "CREATE_BUSINESS_LOCATION", RESOURCE_KEY, resolvedId, null, {
          id: resolvedId,
          name: body.name,
          status,
        }),
      );
    } catch (e) {}

    return { success: true, id: resolvedId };
  }

  async updateBusinessLocation(
    c: Context<{ Bindings: Env }>,
    id: string,
    body: BusinessLocationUpsertInput,
  ) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findById(id);

    await this.repo.updateBusinessLocation(id, body, operatorId);

    try {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "UPDATE_BUSINESS_LOCATION", RESOURCE_KEY, id, oldSnapshot, {
          id,
          name: body.name,
        }),
      );
    } catch (e) {}
  }

  async suspendBusinessLocation(c: Context<{ Bindings: Env }>, id: string) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の営業拠点が見つかりません");
    }

    await this.repo.updateStatus(id, "suspended", operatorId, new Date());

    try {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "SUSPEND_BUSINESS_LOCATION", RESOURCE_KEY, id, oldSnapshot, {
          status: "suspended",
        }),
      );
    } catch (e) {}
  }

  async deleteBusinessLocation(c: Context<{ Bindings: Env }>, id: string) {
    const oldSnapshot = await this.repo.findById(id);

    if (!oldSnapshot) {
      throw new NotFoundError("対象の営業拠点が見つかりません");
    }
    // Item5: 他マスタと同じ制約。無効化(suspended)済みのデータのみ物理削除できる
    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効化状態の営業拠点のみ物理削除できます",
      );
    }

    try {
      await this.repo.deleteBusinessLocation(id);
    } catch (err) {
      throw new BadRequestError(
        "この営業拠点は、すでに他のデータで参照されているため削除できません",
      );
    }

    try {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "DELETE_BUSINESS_LOCATION", RESOURCE_KEY, id, oldSnapshot, null),
      );
    } catch (e) {}
  }

  async generateCsv(searchParams: BusinessLocationSearchParams) {
    const data = await this.repo.findAllForCsv(searchParams);
    const headers = ["id", "name", "postalCode", "address", "phoneNumber", "status", "memo"];

    const rows = data.map((w: any) => {
      const getVal = (camel: string, snake: string) => {
        const val = w[camel] !== undefined ? w[camel] : w[snake];
        return val === null || val === undefined ? "" : String(val);
      };

      return [
        csvField(`${getVal("id", "id")}`),
        csvField(getVal("name", "name")),
        csvField(`${getVal("postalCode", "postal_code")}`),
        csvField(getVal("address", "address")),
        csvField(`${getVal("phoneNumber", "phone_number")}`),
        csvField(`${getVal("status", "status")}`),
        csvField(getVal("memo", "memo")),
      ].join(",");
    });

    return withBom(buildCsvContent(headers, rows));
  }

  async bulkRegisterCsv(c: Context<{ Bindings: Env }>, csvData: string) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    const allRows = parseCsv(csvData);
    if (allRows.length <= 1) {
      throw new BadRequestError("CSVにデータ行が含まれていません");
    }

    const header = allRows[0].map((h) => h.trim());
    const idxId = header.indexOf("id");
    const idxName = header.indexOf("name");
    const idxPostal = header.indexOf("postalCode");
    const idxAddress = header.indexOf("address");
    const idxPhone = header.indexOf("phoneNumber");
    const idxStatus = header.indexOf("status");
    const idxMemo = header.indexOf("memo");

    if (idxId === -1 || idxName === -1) {
      throw new BadRequestError("CSVに必要な列(id, name)がありません");
    }

    let count = 0;
    let currentProcessingId = "UNKNOWN";

    try {
      for (const cols of allRows.slice(1)) {
        const rawId = cols[idxId];
        const rawName = cols[idxName];

        if (!rawId || !rawName) continue;
        currentProcessingId = rawId;

        const row = {
          id: rawId,
          name: rawName,
          postalCode: idxPostal !== -1 ? cols[idxPostal] || null : null,
          address: idxAddress !== -1 ? cols[idxAddress] || null : null,
          phoneNumber: idxPhone !== -1 ? cols[idxPhone] || null : null,
          status: idxStatus !== -1 ? cols[idxStatus] || "active" : "active",
          memo: idxMemo !== -1 ? cols[idxMemo] || null : null,
        };

        await this.repo.upsertBusinessLocationFromCsv(row, operatorId);
        count++;
      }

      try {
        c.executionCtx.waitUntil(
          logAuditEvent(c, "BULK_IMPORT_BUSINESS_LOCATIONS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
            processedCount: count,
          }),
        );
      } catch (auditErr) {}

      return count;
    } catch (err: any) {
      throw new Error(
        `インポート失敗(対象コード: ${currentProcessingId}): ${err.message || "データ保存に失敗しました。"}`,
      );
    }
  }
}
