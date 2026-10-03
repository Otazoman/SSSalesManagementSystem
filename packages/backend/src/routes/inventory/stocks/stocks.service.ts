import { StockRepository, StockKey } from "./stocks.repository";
import { GetStocksQuery } from "./stocks.schema";
import { ConflictError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { SortQuery } from "../../../platform/http/sort";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";

export type ReceiptItemForStock = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  receivedQuantity: number;
  inspectionStatus: string;
  qrCodeKey?: string | null;
};

export type ShipmentItemForStock = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  shippedQuantity: number;
  qrCodeKey?: string | null;
};

export type AdjustmentForStock = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  differenceQuantity: number;
};

export type ReclassificationForStock = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  fromQualityStatus: string;
  toQualityStatus: string;
  quantity: number;
  memo?: string | null;
};

export type DisposalForStock = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  quantity: number;
  memo?: string | null;
};

export type ReturnForStock = {
  itemId: string;
  warehouseId: string;
  locationId: string;
  lotNumber: string;
  accountCode: string;
  qualityStatus: string;
  direction: "OUTBOUND" | "INBOUND";
  quantity: number;
  memo?: string | null;
};

export class StocksService {
  constructor(private repo: StockRepository) {}

  // BUG-049: 在庫への書き込みは、1つの処理(入庫・出庫など)ごとに1回の batch で行う。
  // 在庫が足りるかは書き込む前に確かめ、確かめた後に他の処理が同じ在庫を減らしていた場合は、
  // decreaseQuantityOrFail が SQL のエラーになって batch ごと取り消されるため、ここで競合として返す
  private async commitStockWrites(tx: { commit: () => Promise<void> }) {
    try {
      await tx.commit();
    } catch (err) {
      const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined;
      const message = `${err instanceof Error ? err.message : String(err)} ${cause instanceof Error ? cause.message : String(cause ?? "")}`;
      if (/malformed JSON/i.test(message)) {
        throw new ConflictError("在庫が他の処理と競合しました。画面を更新して、もう一度お試しください");
      }
      throw err;
    }
  }

  static fromDb(db: any): StocksService {
    return new StocksService(StockRepository.fromDb(db));
  }

  async getStocks(searchParams: GetStocksQuery, sort?: SortQuery) {
    return await this.repo.findCurrentStocks(searchParams, sort);
  }

  async getStocksPage(
    searchParams: GetStocksQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.findCurrentStocksPage(searchParams, params, sort),
      this.repo.countCurrentStocks(searchParams),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  // Item6 Phase6-4: 在庫表CSVダウンロード。外部倉庫が自倉庫の現在庫を確認する際にも使う
  // (棚卸実績入力の照合元データとして)、一覧取得と同じ検索条件(searchParams)を使い回す。
  // countedQuantity列はquantity(理論値)と同じ値で仮埋めしておき、外部倉庫が実棚数量に
  // 書き換えてそのまま棚卸CSVインポート(stock-audits/bulk-register)へ再アップロードできる
  // ようにする(列名がインポート側の必須列名と一致していないと取込エラーになるため)
  async generateCsv(searchParams: GetStocksQuery) {
    const rows = await this.repo.findCurrentStocks(searchParams);
    const headers = [
      "itemId",
      "itemName",
      "warehouseId",
      "warehouseName",
      "locationId",
      "locationName",
      "lotNumber",
      "accountCode",
      "qualityStatus",
      "quantity",
      "countedQuantity",
      "updatedAt",
    ];
    const csvRows = rows.map((r: any) =>
      [
        csvField(r.itemId),
        csvField(r.itemName),
        csvField(r.warehouseId),
        csvField(r.warehouseName),
        csvField(r.locationId),
        csvField(r.locationName),
        csvField(r.lotNumber),
        csvField(r.accountCode),
        csvField(r.qualityStatus),
        csvField(r.quantity),
        csvField(r.quantity),
        csvField(r.updatedAt ? new Date(r.updatedAt).toISOString() : ""),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, csvRows));
  }

  // 入庫確定/入庫承認確定時に共通で呼ばれる: item_receipt_itemsの内容をstocks/stock_transactionsへ反映する。
  // 検品ステータス(PASSED以外)は品質区分QUARANTINE(検品待ち)として在庫計上する
  async applyReceiptItems(
    items: ReceiptItemForStock[],
    headerId: string,
    operatorId: string,
    now: Date,
  ) {
    const tx = recordWritesForBatch(this.repo);
    for (const item of items) {
      const qualityStatus =
        item.inspectionStatus === "PASSED"
          ? "NORMAL"
          : item.inspectionStatus === "DAMAGED"
            ? "DAMAGED"
            : "QUARANTINE";
      const key: StockKey = {
        itemId: item.itemId,
        warehouseId: item.warehouseId,
        locationId: item.locationId,
        lotNumber: item.lotNumber,
        accountCode: item.accountCode,
        qualityStatus,
      };
      await tx.repo.increaseQuantity(key, item.receivedQuantity, now);
      await tx.repo.insertTransaction({
        id: crypto.randomUUID(),
        itemId: item.itemId,
        warehouseId: item.warehouseId,
        locationId: item.locationId,
        lotNumber: item.lotNumber,
        qualityStatus,
        quantity: item.receivedQuantity,
        type: "RECEIPT",
        refId: headerId,
        qrCodeKey: item.qrCodeKey ?? null,
        memo: null,
        createdBy: operatorId,
        createdAt: now,
      });
    }
    await this.commitStockWrites(tx);
  }

  // 出庫確定/出庫承認確定時に共通で呼ばれる: item_shipment_itemsの内容をstocks/stock_transactionsへ反映する
  async applyShipmentItems(
    items: ShipmentItemForStock[],
    headerId: string,
    operatorId: string,
    now: Date,
  ) {
    // 先に全ての明細の在庫を確かめる(同じ在庫の行を複数の明細が使う場合は合計で比べる)。足りない明細があれば、何も書き込まない
    const required = new Map<string, number>();
    const targets: { item: ShipmentItemForStock; stockId: string }[] = [];
    for (const item of items) {
      const key: StockKey = {
        itemId: item.itemId,
        warehouseId: item.warehouseId,
        locationId: item.locationId,
        lotNumber: item.lotNumber,
        accountCode: item.accountCode,
        qualityStatus: item.qualityStatus,
      };
      const stockRow = await this.repo.findStockByKey(key);
      if (!stockRow) {
        throw new ConflictError(
          `出庫対象の在庫が見つかりません(品目:${item.itemId} ロケーション:${item.locationId})`,
        );
      }
      const total = (required.get(stockRow.id) ?? 0) + item.shippedQuantity;
      if (stockRow.quantity < total) {
        throw new ConflictError(
          `出庫数量が在庫残数を超えています、または他の処理と競合しました(品目:${item.itemId} ロケーション:${item.locationId})`,
        );
      }
      required.set(stockRow.id, total);
      targets.push({ item, stockId: stockRow.id });
    }

    const tx = recordWritesForBatch(this.repo);
    for (const { item, stockId } of targets) {
      await tx.repo.decreaseQuantityOrFail(stockId, item.shippedQuantity, now);
      await tx.repo.insertTransaction({
        id: crypto.randomUUID(),
        itemId: item.itemId,
        warehouseId: item.warehouseId,
        locationId: item.locationId,
        lotNumber: item.lotNumber,
        qualityStatus: item.qualityStatus,
        quantity: -item.shippedQuantity,
        type: "SHIPMENT",
        refId: headerId,
        qrCodeKey: item.qrCodeKey ?? null,
        memo: null,
        createdBy: operatorId,
        createdAt: now,
      });
    }
    await this.commitStockWrites(tx);
  }

  // 棚卸確定/棚卸承認確定時に共通で呼ばれる: 理論値との差異(署名付き)をstocks/stock_transactionsへ反映する。
  // increaseQuantity()は既にfind-or-create+delta加算(ON CONFLICT)のため、対象在庫が未登録(理論値0)の
  // ケースでもそのまま使える(その場合differenceQuantityは常に0以上になるため負残の心配はない)
  async applyAdjustment(
    adjustment: AdjustmentForStock,
    auditId: string,
    operatorId: string,
    now: Date,
  ) {
    const key: StockKey = {
      itemId: adjustment.itemId,
      warehouseId: adjustment.warehouseId,
      locationId: adjustment.locationId,
      lotNumber: adjustment.lotNumber,
      accountCode: adjustment.accountCode,
      qualityStatus: adjustment.qualityStatus,
    };
    const tx = recordWritesForBatch(this.repo);
    if (adjustment.differenceQuantity !== 0) {
      await tx.repo.increaseQuantity(key, adjustment.differenceQuantity, now);
    }
    await tx.repo.insertTransaction({
      id: crypto.randomUUID(),
      itemId: adjustment.itemId,
      warehouseId: adjustment.warehouseId,
      locationId: adjustment.locationId,
      lotNumber: adjustment.lotNumber,
      qualityStatus: adjustment.qualityStatus,
      quantity: adjustment.differenceQuantity,
      type: "ADJUSTMENT",
      refId: auditId,
      qrCodeKey: null,
      memo: null,
      createdBy: operatorId,
      createdAt: now,
    });
    await this.commitStockWrites(tx);
  }

  // 品質区分変更確定/承認確定時に共通で呼ばれる: 良品⇔破損品/検品待ちの間で在庫を付け替える。
  // 移動元(マイナス)・移動先(プラス)の2件のstock_transactions行を、同じrefId(=reclassificationId)で対にして記録する
  async applyReclassification(
    r: ReclassificationForStock,
    reclassificationId: string,
    operatorId: string,
    now: Date,
  ) {
    const fromKey: StockKey = {
      itemId: r.itemId,
      warehouseId: r.warehouseId,
      locationId: r.locationId,
      lotNumber: r.lotNumber,
      accountCode: r.accountCode,
      qualityStatus: r.fromQualityStatus,
    };
    const toKey: StockKey = { ...fromKey, qualityStatus: r.toQualityStatus };

    const fromStock = await this.repo.findStockByKey(fromKey);
    if (!fromStock) {
      throw new ConflictError(
        `変更元の在庫が見つかりません(品目:${r.itemId} ロケーション:${r.locationId} 品質区分:${r.fromQualityStatus})`,
      );
    }
    if (fromStock.quantity < r.quantity) {
      throw new ConflictError(
        `変更元の在庫残数が不足しています、または他の処理と競合しました(品目:${r.itemId} ロケーション:${r.locationId})`,
      );
    }
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.decreaseQuantityOrFail(fromStock.id, r.quantity, now);
    await tx.repo.increaseQuantity(toKey, r.quantity, now);

    await tx.repo.insertTransaction({
      id: crypto.randomUUID(),
      itemId: r.itemId,
      warehouseId: r.warehouseId,
      locationId: r.locationId,
      lotNumber: r.lotNumber,
      qualityStatus: r.fromQualityStatus,
      quantity: -r.quantity,
      type: "DAMAGE",
      refId: reclassificationId,
      memo: r.memo ?? null,
      createdBy: operatorId,
      createdAt: now,
    });
    await tx.repo.insertTransaction({
      id: crypto.randomUUID(),
      itemId: r.itemId,
      warehouseId: r.warehouseId,
      locationId: r.locationId,
      lotNumber: r.lotNumber,
      qualityStatus: r.toQualityStatus,
      quantity: r.quantity,
      type: "DAMAGE",
      refId: reclassificationId,
      memo: r.memo ?? null,
      createdBy: operatorId,
      createdAt: now,
    });
    await this.commitStockWrites(tx);
  }

  // 廃棄確定/廃棄承認確定時に共通で呼ばれる: 対象在庫を一方的に減算する(戻り先はない)
  async applyDisposal(
    d: DisposalForStock,
    disposalId: string,
    operatorId: string,
    now: Date,
  ) {
    const key: StockKey = {
      itemId: d.itemId,
      warehouseId: d.warehouseId,
      locationId: d.locationId,
      lotNumber: d.lotNumber,
      accountCode: d.accountCode,
      qualityStatus: d.qualityStatus,
    };
    const stock = await this.repo.findStockByKey(key);
    if (!stock) {
      throw new ConflictError(
        `廃棄対象の在庫が見つかりません(品目:${d.itemId} ロケーション:${d.locationId})`,
      );
    }
    if (stock.quantity < d.quantity) {
      throw new ConflictError(
        `廃棄数量が在庫残数を超えています、または他の処理と競合しました(品目:${d.itemId} ロケーション:${d.locationId})`,
      );
    }
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.decreaseQuantityOrFail(stock.id, d.quantity, now);
    await tx.repo.insertTransaction({
      id: crypto.randomUUID(),
      itemId: d.itemId,
      warehouseId: d.warehouseId,
      locationId: d.locationId,
      lotNumber: d.lotNumber,
      qualityStatus: d.qualityStatus,
      quantity: -d.quantity,
      type: "DISPOSAL",
      refId: disposalId,
      memo: d.memo ?? null,
      createdBy: operatorId,
      createdAt: now,
    });
    await this.commitStockWrites(tx);
  }

  // 返品確定/返品承認確定時に共通で呼ばれる: OUTBOUND(仕入先へ返品)は減算、INBOUND(得意先から返品)は増加
  async applyReturn(
    r: ReturnForStock,
    returnId: string,
    operatorId: string,
    now: Date,
  ) {
    const key: StockKey = {
      itemId: r.itemId,
      warehouseId: r.warehouseId,
      locationId: r.locationId,
      lotNumber: r.lotNumber,
      accountCode: r.accountCode,
      qualityStatus: r.qualityStatus,
    };
    const tx = recordWritesForBatch(this.repo);
    if (r.direction === "OUTBOUND") {
      const stock = await this.repo.findStockByKey(key);
      if (!stock) {
        throw new ConflictError(
          `返品対象の在庫が見つかりません(品目:${r.itemId} ロケーション:${r.locationId})`,
        );
      }
      if (stock.quantity < r.quantity) {
        throw new ConflictError(
          `返品数量が在庫残数を超えています、または他の処理と競合しました(品目:${r.itemId} ロケーション:${r.locationId})`,
        );
      }
      await tx.repo.decreaseQuantityOrFail(stock.id, r.quantity, now);
    } else {
      await tx.repo.increaseQuantity(key, r.quantity, now);
    }
    await tx.repo.insertTransaction({
      id: crypto.randomUUID(),
      itemId: r.itemId,
      warehouseId: r.warehouseId,
      locationId: r.locationId,
      lotNumber: r.lotNumber,
      qualityStatus: r.qualityStatus,
      quantity: r.direction === "OUTBOUND" ? -r.quantity : r.quantity,
      type: "RETURN",
      refId: returnId,
      memo: r.memo ?? null,
      createdBy: operatorId,
      createdAt: now,
    });
    await this.commitStockWrites(tx);
  }
}
