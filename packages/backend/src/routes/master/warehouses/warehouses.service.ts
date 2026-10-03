import { Context } from "hono";
import { WarehousesRepository } from "./warehouses.repository";
import { WarehouseUpsertInput } from "./warehouses.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { deleteOrphanedR2Attachments } from "../../../platform/r2/delete-orphaned-attachments";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { Env } from "../../../types/env";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import {
  BadRequestError,
  NotFoundError,
} from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { determineWarehouseInitialStatus } from "../../../workflow-engine/settings";
import { generateUniqueMasterCode } from "../../../platform/id/resolve-master-id";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "master_warehouses";

type WarehouseSearchParams = { id?: string; name?: string; status?: string };

export class WarehousesService {
  private repo: WarehousesRepository;

  constructor(repo: WarehousesRepository) {
    this.repo = repo;
  }

  async getWarehouses(searchParams: WarehouseSearchParams, sort?: SortQuery) {
    return await this.repo.findWarehouses(searchParams, sort);
  }

  async getWarehousesPage(
    searchParams: WarehouseSearchParams,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.findWarehousesPage(searchParams, params, sort),
      this.repo.countWarehouses(searchParams),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async registerWarehouse(
    c: Context<{ Bindings: Env }>,
    body: WarehouseUpsertInput,
  ) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    // 承認機能展開: クライアントの送信値は受け付けず、会社設定の承認フラグからサーバー側で強制する
    const status = await determineWarehouseInitialStatus(c.env.COMPANY_SETTINGS);
    // マスタコード自動採番: コード未入力時のみmaster_code_formatsの設定に基づき自動採番する
    const resolvedId =
      body.id?.trim() ||
      (await generateUniqueMasterCode(c, "warehouses", (id) =>
        this.repo.findById(id).then((r) => !!r),
      ));
    await this.repo.createWarehouse({ ...body, id: resolvedId, status }, operatorId);

    try {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "CREATE_WAREHOUSE", RESOURCE_KEY, resolvedId, null, {
        id: resolvedId,
        name: body.name,
        status,
      }),
      );
    } catch (e) {}

    return { success: true, id: resolvedId };
  }

  async updateWarehouse(
    c: Context<{ Bindings: Env }>,
    id: string,
    body: WarehouseUpsertInput,
  ) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findById(id);

    // R2内の古いファイル自動クリーンアップ
    const oldAttachments = await this.repo.findAttachmentsByWarehouseId(id);
    await deleteOrphanedR2Attachments(
      c.env.WAREHOUSES_BUCKET,
      oldAttachments,
      (body.attachments || []).map((att) => att.attachmentR2Path),
    );

    await this.repo.updateWarehouse(id, body, operatorId);

    try {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "UPDATE_WAREHOUSE", RESOURCE_KEY, id, oldSnapshot, {
        id,
        name: body.name,
      }),
      );
    } catch (e) {}
  }

  async suspendWarehouse(c: Context<{ Bindings: Env }>, id: string) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の倉庫が見つかりません");
    }

    await this.repo.updateStatus(id, "suspended", operatorId, new Date());

    try {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "SUSPEND_WAREHOUSE", RESOURCE_KEY, id, oldSnapshot, {
        status: "suspended",
      }),
      );
    } catch (e) {}
  }

  async deleteWarehouse(c: Context<{ Bindings: Env }>, id: string) {
    const oldSnapshot = await this.repo.findById(id);

    if (!oldSnapshot) {
      throw new NotFoundError("対象の倉庫が見つかりません");
    }
    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効化状態の倉庫のみ物理削除できます",
      );
    }

    // 物理削除前にR2ファイル実体を削除
    const currentAttachments = await this.repo.findAttachmentsByWarehouseId(id);
    for (const att of currentAttachments) {
      if (att.storageType === "R2" && att.attachmentR2Path) {
        try {
          await c.env.WAREHOUSES_BUCKET.delete(att.attachmentR2Path);
        } catch (r2Err) {
          console.error(
            `R2ファイル実体削除失敗 (${att.attachmentR2Path}):`,
            r2Err,
          );
        }
      }
    }

    await this.repo.deleteWarehouse(id);

    try {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "DELETE_WAREHOUSE", RESOURCE_KEY, id, oldSnapshot, null),
      );
    } catch (e) {}
  }

  async generateCsv(searchParams: WarehouseSearchParams) {
    const data = await this.repo.findAllForCsv(searchParams);
    const headers = [
      "id",
      "name",
      "postalCode",
      "address",
      "phoneNumber",
      "faxNumber",
      "email",
      "businessStartTime",
      "businessEndTime",
      "storageRestrictions",
      "warehouseType",
      "status",
      "memo",
    ];

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
        csvField(`${getVal("faxNumber", "fax_number")}`),
        csvField(`${getVal("email", "email")}`),
        csvField(`${getVal("businessStartTime", "business_start_time")}`),
        csvField(`${getVal("businessEndTime", "business_end_time")}`),
        csvField(getVal("storageRestrictions", "storage_restrictions")),
        csvField(`${getVal("warehouseType", "warehouse_type")}`),
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
    const idxFax = header.indexOf("faxNumber");
    const idxEmail = header.indexOf("email");
    const idxStart = header.indexOf("businessStartTime");
    const idxEnd = header.indexOf("businessEndTime");
    const idxRestrictions = header.indexOf("storageRestrictions");
    const idxWarehouseType = header.indexOf("warehouseType");
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
          faxNumber: idxFax !== -1 ? cols[idxFax] || null : null,
          email: idxEmail !== -1 ? cols[idxEmail] || null : null,
          businessStartTime: idxStart !== -1 ? cols[idxStart] || null : null,
          businessEndTime: idxEnd !== -1 ? cols[idxEnd] || null : null,
          storageRestrictions:
            idxRestrictions !== -1 ? cols[idxRestrictions] || null : null,
          warehouseType:
            idxWarehouseType !== -1
              ? cols[idxWarehouseType] || "INTERNAL"
              : "INTERNAL",
          status: idxStatus !== -1 ? cols[idxStatus] || "active" : "active",
          memo: idxMemo !== -1 ? cols[idxMemo] || null : null,
        };

        await this.repo.upsertWarehouseFromCsv(row, operatorId);
        count++;
      }

      try {
        c.executionCtx.waitUntil(
          logAuditEvent(c, "BULK_IMPORT_WAREHOUSES_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
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

  async uploadFile(c: Context<{ Bindings: Env }>, file: File) {
    const r2Key = generateAttachmentKey("warehouses", file.name);

    await c.env.WAREHOUSES_BUCKET.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    return { fileName: file.name, attachmentR2Path: r2Key };
  }

  // DB経由: warehouseId + attachmentId から添付ファイルレコードを引いてR2から配信
  async getFile(
    c: Context<{ Bindings: Env }>,
    warehouseId: string,
    attachmentId: string,
  ) {
    const attachment = await this.repo.findAttachmentByIdAndWarehouseId(
      attachmentId,
      warehouseId,
    );
    if (!attachment) return null;

    if (attachment.storageType !== "R2" || !attachment.attachmentR2Path) {
      if (attachment.externalUrl) {
        return { type: "redirect" as const, url: attachment.externalUrl };
      }
      return null;
    }

    const object = await c.env.WAREHOUSES_BUCKET.get(
      attachment.attachmentR2Path,
    );
    if (!object) {
      return null;
    }

    const headers: Record<string, string> = {};
    const contentType =
      object.httpMetadata?.contentType || "application/octet-stream";
    headers["content-type"] = contentType;

    if (object.httpEtag) headers["etag"] = object.httpEtag;

    const isImage =
      contentType.startsWith("image/") ||
      attachment.fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    if (!isImage) {
      headers["content-disposition"] =
        `attachment; filename="${encodeURIComponent(attachment.fileName)}"`;
    } else {
      headers["content-disposition"] = "inline";
    }

    return { type: "stream" as const, body: object.body, headers };
  }
}
