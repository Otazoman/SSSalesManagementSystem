import { Context } from "hono";
import { ProductPriceRepository } from "./product-price.repository";
import {
  RegisterProductPriceInput,
  ItemPriceStatus,
} from "./product-price.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { withBom, buildCsvContent } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { determineProductPriceInitialStatus } from "../../../workflow-engine/settings";
import { SortQuery } from "../../../platform/http/sort";
import { csvField } from "../../../platform/csv/csv-writer";

const RESOURCE_KEY = "master_prices";

export class ProductPriceService {
  private repo: ProductPriceRepository;

  constructor(d1: D1Database) {
    this.repo = new ProductPriceRepository(d1);
  }

  // マスタ管理画面(パターンB)・CSVエクスポート共通の条件マッピング。
  // (計算モード専用のquantityはここでは扱わない。呼び出し側でquantity指定時は分岐する)
  private toMasterParams(query: {
    itemId?: string;
    priceType?: string;
    partnerId?: string; // customerId -> partnerId
    status?: string;
  }) {
    const itemId = query.itemId?.trim();
    const priceType = query.priceType?.trim();
    const partnerId = query.partnerId?.trim(); // customerId -> partnerId
    const statusParam = query.status?.trim();

    let status: ItemPriceStatus | undefined = undefined;
    if (
      statusParam === "temporary" ||
      statusParam === "active" ||
      statusParam === "suspended"
    ) {
      status = statusParam;
    }

    return { itemId, priceType, partnerId, statusParam: status };
  }

  async listPrices(
    query: {
      itemId?: string;
      priceType?: string;
      partnerId?: string; // customerId -> partnerId
      quantity?: string;
      status?: string;
    },
    sort?: SortQuery,
  ) {
    if (query.quantity !== undefined) {
      const quantityNum = Number(query.quantity || 0);
      return await this.repo.getPricesForCalculation({
        itemId: query.itemId?.trim(),
        priceType: query.priceType?.trim(),
        partnerId: query.partnerId?.trim(), // customerId -> partnerId
        quantityNum,
      });
    }

    return await this.repo.getPricesForMaster(this.toMasterParams(query), sort);
  }

  // マスタ管理画面(パターンB)専用のページネーション付き一覧。計算用(パターンA)は対象外。
  async listPricesPage(
    query: {
      itemId?: string;
      priceType?: string;
      partnerId?: string; // customerId -> partnerId
      status?: string;
    },
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const masterParams = this.toMasterParams(query);
    const [data, total] = await Promise.all([
      this.repo.getPricesForMasterPage(masterParams, params, sort),
      this.repo.countPricesForMaster(masterParams),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async registerPrice(
    c: Context<{ Bindings: Env }>,
    input: RegisterProductPriceInput,
  ) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();

    const partnerId = input.partnerId || null; // input.customerId -> input.partnerId
    const minQuantity = Number(input.minQuantity || 0);
    const unitPrice = Number(input.unitPrice || 0);
    const unitCode = input.unitCode || "PCS";

    const targetItem = await this.repo.findItemById(input.itemId);
    if (!targetItem) {
      throw new BadRequestError(`品目コード [${input.itemId}] は存在しません`);
    }
    if (targetItem.status !== "active") {
      throw new BadRequestError(
        `品目「${targetItem.name}」は取引停止または審査中です`,
      );
    }

    let existingRecord = null;
    if (input.id) {
      existingRecord = await this.repo.findPriceById(input.id);
    }
    if (!existingRecord) {
      existingRecord = await this.repo.findMatchingPrice(
        input.itemId,
        input.priceType,
        minQuantity,
        partnerId, // customerId -> partnerId
      );
    }

    // 💡 承認機能展開: statusが明示指定されていればそれを優先(承認フローの仮ロック/申請時の
    // 最終ステータス指定に使う)。未指定の場合、新規登録は会社設定に応じてtemporary/activeを
    // 決定し(取引先・単位等と同じdetermineXxxInitialStatusパターン)、既存レコードの更新は
    // 現在のstatusを維持する(フィールド編集だけでstatusが意図せず変わらないようにする)。
    let targetStatus: ItemPriceStatus;
    if (input.status) {
      targetStatus = input.status as ItemPriceStatus;
    } else if (existingRecord) {
      targetStatus = existingRecord.status as ItemPriceStatus;
    } else {
      targetStatus = await determineProductPriceInitialStatus(
        c.env.COMPANY_SETTINGS,
      );
    }

    if (existingRecord) {
      const oldSnapshot = { ...existingRecord };

      await this.repo.updatePrice(existingRecord.id, {
        minQuantity,
        unitPrice,
        unitCode,
        status: targetStatus,
        updatedBy: opId,
        updatedAt: now,
      });

      c.executionCtx.waitUntil(
        logAuditEvent(c, "UPDATE_PRODUCT_PRICE", RESOURCE_KEY, existingRecord.id, oldSnapshot, {
        id: existingRecord.id,
        itemId: input.itemId,
        priceType: input.priceType,
        partnerId, // customerId -> partnerId
        minQuantity,
        unitPrice,
        unitCode,
      }),
      );

      return {
        success: true,
        id: existingRecord.id,
        message:
          targetStatus === "active"
            ? "標準単価設定を更新しました"
            : "取引先特値を更新しました(承認待ち)",
      };
    }

    const newPriceId = `PRC-PARTNER-${input.itemId}-${partnerId || "STD"}-${input.priceType}-${minQuantity}-${Date.now()}`;
    await this.repo.insertPrice({
      id: newPriceId,
      itemId: input.itemId,
      priceType: input.priceType as "SALES" | "PURCHASE",
      partnerId, // customerId -> partnerId
      minQuantity,
      unitPrice,
      unitCode,
      status: targetStatus,
      validFrom: now,
      createdBy: opId,
      createdAt: now,
      updatedBy: opId,
      updatedAt: now,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_PRODUCT_PRICE", RESOURCE_KEY, newPriceId, null, {
      id: newPriceId,
      itemId: input.itemId,
      priceType: input.priceType,
      partnerId, // customerId -> partnerId
      minQuantity,
      unitPrice,
      unitCode,
    }),
    );

    return {
      success: true,
      id: newPriceId,
      message:
        targetStatus === "active"
          ? "標準単価設定を新規登録しました"
          : "取引先特値を新規登録しました(承認待ち)",
    };
  }

  async deletePrice(c: Context<{ Bindings: Env }>, id: string) {
    const oldSnapshot = await this.repo.findPriceById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("削除対象の単価設定が存在しません");
    }
    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効化状態の単価設定のみ物理削除できます",
      );
    }
    await this.repo.deletePrice(id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_PRODUCT_PRICE", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return { success: true, message: "単価設定を削除しました" };
  }

  async exportCsv(
    c: Context<{ Bindings: Env }>,
    query: {
      itemId?: string;
      priceType?: string;
      partnerId?: string; // customerId -> partnerId
      status?: string;
    },
  ) {
    const data = await this.repo.getPricesForMaster(this.toMasterParams(query));

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_PRODUCT_PRICES_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      recordCount: data.length,
    }),
    );

    const headers = [
      "id",
      "itemId",
      "priceType",
      "partnerId", // customerId -> partnerId
      "minQuantity",
      "unitPrice",
      "unitCode",
      "status",
    ];
    const rows = data.map((x) =>
      [
        csvField(`${x.id}`),
        csvField(`${x.itemId}`),
        csvField(`${x.priceType}`),
        csvField(`${x.partnerId || ""}`), // x.customerId -> x.partnerId
        x.minQuantity,
        x.unitPrice,
        csvField(`${x.unitCode}`),
        csvField(`${x.status || "active"}`),
      ].join(","),
    );

    return withBom(buildCsvContent(headers, rows));
  }

  async bulkRegisterCsv(c: Context<{ Bindings: Env }>, file: File) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();

    const text = await file.text();
    const allRows = parseCsv(text);

    const itemStatusCache = new Map<string, string>();
    let count = 0;
    let skipCount = 0;

    for (const cols of allRows.slice(1)) {
      const [
        id,
        itemId,
        priceType,
        partnerId, // customerId -> partnerId
        minQuantity,
        unitPrice,
        unitCode,
        status,
      ] = cols;

      if (!itemId || !priceType) continue;

      if (!itemStatusCache.has(itemId)) {
        const itemRecord = await this.repo.findItemById(itemId);
        itemStatusCache.set(itemId, itemRecord?.status || "NOT_FOUND");
      }
      if (itemStatusCache.get(itemId) !== "active") {
        skipCount++;
        continue;
      }

      const targetPartner = partnerId || null; // customerId -> partnerId
      const targetQty = Number(minQuantity || 0);

      let parsedStatus: ItemPriceStatus = "temporary";
      if (status === "active" || status === "suspended") {
        parsedStatus = status;
      }
      const rowStatus: ItemPriceStatus =
        targetPartner === null ? "active" : parsedStatus;

      const checkEx = await this.repo.findMatchingPrice(
        itemId,
        priceType,
        targetQty,
        targetPartner, // customerId -> partnerId
      );

      if (checkEx) {
        await this.repo.updatePrice(checkEx.id, {
          unitPrice: Number(unitPrice || 0),
          unitCode: unitCode || "PCS",
          status: rowStatus,
          updatedBy: opId,
          updatedAt: now,
        });
      } else {
        const finalId =
          id ||
          `PRC-PARTNER-${itemId}-${partnerId || "STD"}-${priceType}-${targetQty}-${Date.now()}`;

        await this.repo.insertPrice({
          id: finalId,
          itemId,
          priceType: priceType as "SALES" | "PURCHASE",
          partnerId: targetPartner, // customerId -> partnerId
          minQuantity: targetQty,
          unitPrice: Number(unitPrice || 0),
          unitCode: unitCode || "PCS",
          status: rowStatus,
          validFrom: now,
          createdBy: opId,
          createdAt: now,
          updatedBy: opId,
          updatedAt: now,
        });
      }
      count++;
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_PRODUCT_PRICES_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
      processedCount: count,
      skippedCount: skipCount,
    }),
    );

    return {
      success: true,
      message: `CSVから ${count} 件のデータを同期しました`,
    };
  }
}
