import { Context } from "hono";
import { ItemReorderSettingsRepository } from "./item-reorder-settings.repository";
import { ItemReorderSettingPayload } from "./item-reorder-settings.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { WarehouseStockReservationRepository } from "../../../platform/inventory/warehouse-stock-reservation.repository";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "master_item_reorder_settings";

export class ItemReorderSettingsService {
  private repo: ItemReorderSettingsRepository;
  private stockRepo: WarehouseStockReservationRepository;

  constructor(d1: D1Database) {
    this.repo = new ItemReorderSettingsRepository(d1);
    this.stockRepo = new WarehouseStockReservationRepository(d1);
  }

  async getAll(sort?: SortQuery) {
    return await this.repo.findAll(sort);
  }

  async create(c: Context<{ Bindings: Env }>, input: ItemReorderSettingPayload) {
    const existing = await this.repo.findByItemAndWarehouse(input.itemId, input.warehouseId);
    if (existing) {
      throw new BadRequestError("この品目×倉庫の組み合わせは既に登録されています");
    }

    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();
    const id = crypto.randomUUID();
    await this.repo.insert(id, input, opId, now);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_ITEM_REORDER_SETTING", RESOURCE_KEY, id, null, { ...input }),
    );

    return { id };
  }

  async update(c: Context<{ Bindings: Env }>, id: string, input: ItemReorderSettingPayload) {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new NotFoundError("対象の発注点/安全在庫設定が見つかりません");
    }

    const conflicting = await this.repo.findByItemAndWarehouse(input.itemId, input.warehouseId);
    if (conflicting && conflicting.id !== id) {
      throw new BadRequestError("この品目×倉庫の組み合わせは既に登録されています");
    }

    const opId = await this.repo.getFallbackOperatorId(c);
    await this.repo.update(id, input, opId, new Date());

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_ITEM_REORDER_SETTING", RESOURCE_KEY, id, existing, { ...input }),
    );
  }

  async delete(c: Context<{ Bindings: Env }>, id: string) {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new NotFoundError("対象の発注点/安全在庫設定が見つかりません");
    }

    await this.repo.delete(id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_ITEM_REORDER_SETTING", RESOURCE_KEY, id, existing, null),
    );
  }

  async exportCsv() {
    const data = await this.repo.findAll();
    const headers = ["itemId", "itemName", "warehouseId", "warehouseName", "reorderPoint", "safetyStock", "memo"];

    const rows = data.map((row) =>
      [
        csvField(row.itemId),
        csvField(row.itemName),
        csvField(row.warehouseId),
        csvField(row.warehouseName),
        csvField(row.reorderPoint),
        csvField(row.safetyStock),
        csvField(row.memo),
      ].join(","),
    );

    return withBom(buildCsvContent(headers, rows));
  }

  async importCsv(c: Context<{ Bindings: Env }>) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();

    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      throw new BadRequestError("ファイルがありません");
    }

    const text = await file.text();
    const allLines = parseCsv(text);
    if (allLines.length <= 1) {
      return 0;
    }

    const headers = allLines[0].map((h) => h.toLowerCase().trim());
    const idxItemId = headers.findIndex((h) => h === "itemid");
    const idxWarehouseId = headers.findIndex((h) => h === "warehouseid");
    const idxReorderPoint = headers.findIndex((h) => h === "reorderpoint");
    const idxSafetyStock = headers.findIndex((h) => h === "safetystock");
    const idxMemo = headers.findIndex((h) => h === "memo");

    if (idxItemId === -1 || idxWarehouseId === -1 || idxReorderPoint === -1 || idxSafetyStock === -1) {
      throw new BadRequestError(
        "CSVのヘッダーに 'itemId'/'warehouseId'/'reorderPoint'/'safetyStock' が見つかりません",
      );
    }

    const parsedRows: {
      itemId: string;
      warehouseId: string;
      reorderPoint: number;
      safetyStock: number;
      memo: string | null;
    }[] = [];

    for (const cols of allLines.slice(1)) {
      const itemId = cols[idxItemId]?.trim();
      const warehouseId = cols[idxWarehouseId]?.trim();
      if (!itemId || !warehouseId) continue;

      parsedRows.push({
        itemId,
        warehouseId,
        reorderPoint: Number(cols[idxReorderPoint]) || 0,
        safetyStock: Number(cols[idxSafetyStock]) || 0,
        memo: idxMemo !== -1 && cols[idxMemo] ? cols[idxMemo].trim() : null,
      });
    }

    let successCount = 0;
    for (const row of parsedRows) {
      const existing = await this.repo.findByItemAndWarehouse(row.itemId, row.warehouseId);
      if (existing) {
        await this.repo.update(existing.id, row, opId, now);
      } else {
        await this.repo.insert(crypto.randomUUID(), row, opId, now);
      }
      successCount++;
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "IMPORT_ITEM_REORDER_SETTINGS_CSV", RESOURCE_KEY, `BULK_${successCount}`, null, {
        count: successCount,
      }),
    );

    return successCount;
  }

  // Item9 Phase7: 欠品自動提案②(発注点/安全在庫方式)。品目×倉庫の利用可能数量(在庫合計-引当済)が
  // 発注点を下回っている設定行のみを候補として返す。安全在庫まで補充する数量を提案する
  async getLowStockCandidates() {
    const settings = await this.repo.findAll();
    if (settings.length === 0) return [];

    const availabilityByItem = new Map<string, Map<string, number>>();
    const itemIds = [...new Set(settings.map((s) => s.itemId))];
    for (const itemId of itemIds) {
      const rows = await this.stockRepo.getAvailableByWarehouse(itemId);
      availabilityByItem.set(itemId, new Map(rows.map((r) => [r.warehouseId, r.available])));
    }

    return settings
      .map((s) => {
        const available = availabilityByItem.get(s.itemId)?.get(s.warehouseId) ?? 0;
        return { ...s, currentStock: available, suggestedQuantity: Math.max(s.safetyStock - available, 0) };
      })
      .filter((s) => s.currentStock < s.reorderPoint);
  }
}
