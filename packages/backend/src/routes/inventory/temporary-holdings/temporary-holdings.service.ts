import { Context } from "hono";
import { Env } from "../../../types/env";
import { TemporaryHoldingsRepository } from "./temporary-holdings.repository";
import {
  MoveTemporaryHoldingToStockInput,
  AdjustTemporaryHoldingInput,
  ReceiveTemporaryHoldingInput,
  ReleaseTemporaryHoldingInput,
  SearchTemporaryHoldingsQuery,
} from "./temporary-holdings.schema";
import {
  HOLDING_TARGET_TYPE,
  confirmHoldingMovement,
  confirmedQuantityOf,
  pendingDecreaseOf,
} from "./temporary-holdings.ledger";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { startReconciliationApproval } from "../../../workflow-engine/start-reconciliation-approval";
import { createDb } from "../../../platform/db/create-db";
import { formatJstDate } from "../../../platform/date/format-jst-date";
import { ReceiptsService } from "../receipts/receipts.service";
import { ReceiptsRepository } from "../receipts/receipts.repository";

export const RESOURCE_KEY = "inventory_temporary_holdings";

const MOVEMENT_LABELS: Record<string, string> = { RECEIVE: "受入", RELEASE: "払出", ADJUST: "調整", MOVE_TO_STOCK: "在庫へ移行" };

/**
 * REQ-011(2): 一時保管の台帳。品目マスタに無い物(自社品・預り品)を在庫とは別に管理する。
 * 受入・払出・調整は動き1件ごとに承認を申請する(申請の種類 inventory_temporary_holdings、金額は 0)。
 * この種類の有効な承認フローが1つも無ければ、申請を作らずにすぐ確定する。
 * 在庫数・引当・棚卸・在庫評価・仕訳には含めない。発注の明細から受け入れても、発注の「入荷済数量」には数えない。
 */
export class TemporaryHoldingsService {
  constructor(private repo: TemporaryHoldingsRepository) {}

  async list(query: SearchTemporaryHoldingsQuery) {
    const holdings = await this.repo.findMany(query);
    const movements = await this.repo.findMovementsByHoldingIds(holdings.map((h) => h.id));
    return holdings.map((h) => {
      const own = movements.filter((m) => m.holdingId === h.id && m.approvalStatus === "PENDING");
      return {
        ...h,
        // 承認待ちの増減(台帳の数量にはまだ入っていない)
        pendingQuantity: own.reduce((sum, m) => sum + m.quantity, 0),
      };
    });
  }

  async getDetail(id: string) {
    const holding = await this.repo.findById(id);
    if (!holding) throw new NotFoundError("対象の一時保管が見つかりません");
    const movements = await this.repo.findMovements(id);
    return { ...holding, movements };
  }

  async receive(c: Context<{ Bindings: Env }>, input: ReceiveTemporaryHoldingInput) {
    if (input.category === "CUSTODY" && !input.partnerId) {
      throw new BadRequestError("預り品は取引先(預け主)が必須です");
    }
    if (!(await this.repo.warehouseExists(input.warehouseId))) {
      throw new BadRequestError(`倉庫[${input.warehouseId}]が見つかりません`);
    }
    if (input.partnerId && !(await this.repo.partnerExists(input.partnerId))) {
      throw new BadRequestError(`取引先[${input.partnerId}]が見つかりません`);
    }
    const receivedDate = new Date(input.receivedDate);
    if (Number.isNaN(receivedDate.getTime())) throw new BadRequestError("受入日が不正です");
    const plannedReleaseDate = input.plannedReleaseDate ? new Date(input.plannedReleaseDate) : null;
    if (plannedReleaseDate && Number.isNaN(plannedReleaseDate.getTime())) throw new BadRequestError("払出予定日が不正です");

    // 発注の明細から受け入れる場合は、直接入力(品目マスタに無い)の明細だけ
    let partnerId = input.partnerId || null;
    if (input.purchaseOrderId || input.purchaseOrderItemId) {
      if (!input.purchaseOrderId || !input.purchaseOrderItemId) {
        throw new BadRequestError("発注から受け入れる時は、発注番号と明細の両方を指定してください");
      }
      const found = await this.repo.findOrderItem(input.purchaseOrderId, input.purchaseOrderItemId);
      if (!found) throw new BadRequestError("指定した発注の明細が見つかりません");
      if (found.item.inputType !== "DIRECT") {
        throw new BadRequestError("品目マスタにある明細は、一時保管ではなく入荷(入庫)で受け入れてください");
      }
      partnerId = partnerId ?? found.partnerId ?? null;
    }

    const operator = await this.repo.getFallbackOperatorId(c);
    const id = await resolveConfiguredDocumentId(c, "temporary_holding", (candidate) => this.repo.existsId(candidate), null);
    const now = new Date();
    await this.repo.insertHolding({
      id,
      category: input.category,
      itemName: input.itemName,
      spec: input.spec || null,
      quantity: 0,
      unitName: input.unitName || null,
      warehouseId: input.warehouseId,
      locationId: input.locationId || null,
      sourceType: input.purchaseOrderId ? "PURCHASE_ORDER" : null,
      sourceId: input.purchaseOrderId || null,
      sourceItemId: input.purchaseOrderItemId || null,
      partnerId,
      receivedDate,
      plannedReleaseDate,
      status: "HOLDING",
      createdBy: operator,
      createdAt: now,
      updatedBy: operator,
      updatedAt: now,
    });
    try {
      const result = await this.recordMovement(c, id, {
        movementType: "RECEIVE",
        quantity: input.quantity,
        movementDate: receivedDate,
        memo: input.memo || null,
      });
      return { ...result, id, message: result.pending ? "受入を記録し、承認を申請しました" : "一時保管に受け入れました" };
    } catch (err) {
      // 受入を記録できなければ(承認の申請に失敗した等)、台帳の行も残さない
      await this.repo.deleteHolding(id);
      throw err;
    }
  }

  async release(c: Context<{ Bindings: Env }>, id: string, input: ReleaseTemporaryHoldingInput) {
    const holding = await this.loadActiveHolding(id);
    if (input.salesOrderId || input.salesOrderItemId) {
      if (!input.salesOrderId || !input.salesOrderItemId) {
        throw new BadRequestError("受注に紐づけて払い出す時は、受注番号と明細の両方を指定してください");
      }
      const item = await this.repo.findSalesOrderItem(input.salesOrderId, input.salesOrderItemId);
      if (!item) throw new BadRequestError("指定した受注の明細が見つかりません");
      if (item.inputType !== "DIRECT") {
        throw new BadRequestError("品目マスタにある明細は、一時保管ではなく出荷(出庫)で払い出してください");
      }
    }
    await this.assertNotBelowZero(holding.id, input.quantity, "払出");
    const movementDate = this.parseDate(input.movementDate, "払出日");
    const result = await this.recordMovement(c, holding.id, {
      movementType: "RELEASE",
      quantity: -input.quantity,
      movementDate,
      memo: input.memo || null,
      sourceType: input.salesOrderId ? "SALES_ORDER" : null,
      sourceId: input.salesOrderId || null,
      sourceItemId: input.salesOrderItemId || null,
    });
    return { ...result, message: result.pending ? "払出を記録し、承認を申請しました" : "払い出しました" };
  }

  async adjust(c: Context<{ Bindings: Env }>, id: string, input: AdjustTemporaryHoldingInput) {
    const holding = await this.loadActiveHolding(id);
    if (input.quantity < 0) await this.assertNotBelowZero(holding.id, -input.quantity, "減らす調整");
    const movementDate = this.parseDate(input.movementDate, "調整日");
    const result = await this.recordMovement(c, holding.id, {
      movementType: "ADJUST",
      quantity: input.quantity,
      movementDate,
      memo: input.memo,
    });
    return { ...result, message: result.pending ? "数量の調整を記録し、承認を申請しました" : "数量を調整しました" };
  }

  /**
   * REQ-011(3): 自社品を品目マスタの品目として在庫へ移す。残りの数量で入庫を作り(今の入庫と承認の流れを通る)、
   * 入庫が確定したら台帳を「在庫へ移行済」にする。預り品は自社の在庫にしないため対象外。承認待ちの動きがある間はできない
   */
  async moveToStock(c: Context<{ Bindings: Env }>, id: string, input: MoveTemporaryHoldingToStockInput) {
    const holding = await this.loadActiveHolding(id);
    if (holding.category !== "OWN") throw new BadRequestError("預り品は自社の在庫に移せません(払出で返却してください)");
    if (holding.status !== "HOLDING" || holding.quantity <= 0) {
      throw new BadRequestError("保管中で数量が残っている一時保管だけを在庫へ移せます");
    }
    const movements = await this.repo.findMovements(id);
    if (movements.some((m) => m.approvalStatus === "PENDING")) {
      throw new BadRequestError("承認待ちの動きがあるため、在庫へ移せません(承認されてから移してください)");
    }
    const receivedDate = this.parseDate(input.receivedDate, "入庫日");

    const receipt = await new ReceiptsService(new ReceiptsRepository(c.env.DB)).createReceipt(c, {
      receivedDate: input.receivedDate,
      items: [
        {
          itemId: input.itemId,
          warehouseId: holding.warehouseId,
          locationId: input.locationId,
          lotNumber: input.lotNumber || "NONE",
          quantity: holding.quantity,
          inspectionStatus: "PASSED",
        },
      ],
      memo: `一時保管[${holding.id}] ${holding.itemName} から在庫へ移行`,
      partnerId: null,
      applicantDepartmentSurrogateId: input.applicantDepartmentSurrogateId ?? null,
    } as Parameters<ReceiptsService["createReceipt"]>[1]);

    const operator = await this.repo.getFallbackOperatorId(c);
    const now = new Date();
    const movementId = crypto.randomUUID();
    await this.repo.insertMovement({
      id: movementId,
      holdingId: id,
      movementType: "MOVE_TO_STOCK",
      quantity: -holding.quantity,
      movementDate: receivedDate,
      memo: `品目[${input.itemId}]として入庫[${receipt.headerId}]`,
      sourceType: "STOCK_RECEIPT",
      sourceId: receipt.headerId,
      sourceItemId: null,
      approvalStatus: "PENDING",
      createdBy: operator,
      createdAt: now,
      updatedBy: operator,
      updatedAt: now,
    });
    // 入庫の承認が無効ですぐ確定した場合は、台帳もすぐ「在庫へ移行済」にする
    const header = await new ReceiptsRepository(c.env.DB).findHeaderById(receipt.headerId);
    const confirmed = header?.status === "APPROVED";
    if (confirmed) await confirmHoldingMovement(this.repo, movementId, operator, now);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "TEMPORARY_HOLDING_MOVE_TO_STOCK", RESOURCE_KEY, id, holding, {
        movementId,
        itemId: input.itemId,
        receiptId: receipt.headerId,
        quantity: holding.quantity,
        confirmed,
      }),
    );
    return {
      success: true,
      movementId,
      receiptId: receipt.headerId,
      pending: !confirmed,
      message: confirmed
        ? `入庫[${receipt.headerId}]を作り、在庫へ移しました`
        : `入庫[${receipt.headerId}]の承認を申請しました(入庫が承認されると在庫へ移行済になります)`,
    };
  }

  // 確定した動きが無く、承認待ちも無い行(差し戻された受入だけの行など)は削除できる
  async remove(c: Context<{ Bindings: Env }>, id: string) {
    const holding = await this.repo.findById(id);
    if (!holding) throw new NotFoundError("対象の一時保管が見つかりません");
    const movements = await this.repo.findMovements(id);
    if (movements.some((m) => m.approvalStatus === "PENDING")) {
      throw new BadRequestError("承認待ちの動きがあるため削除できません(申請を取り下げてから削除してください)");
    }
    if (movements.some((m) => m.approvalStatus === "CONFIRMED")) {
      throw new BadRequestError("確定した受入・払出がある一時保管は削除できません(数量の調整・払出で管理してください)");
    }
    await this.repo.deleteHolding(id);
    const db = createDb(c.env.DB);
    for (const m of movements) {
      await WorkflowEngine.closeRemandedRequestsOfDeletedTarget(db, HOLDING_TARGET_TYPE, m.id);
    }
    c.executionCtx.waitUntil(logAuditEvent(c, "DELETE_TEMPORARY_HOLDING", RESOURCE_KEY, id, holding, null));
    return { success: true, message: "一時保管を削除しました" };
  }

  async exportCsv(c: Context<{ Bindings: Env }>, query: SearchTemporaryHoldingsQuery) {
    const rows = await this.list(query);
    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_TEMPORARY_HOLDINGS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, { recordCount: rows.length }),
    );
    const headers = [
      "id", "category", "itemName", "spec", "quantity", "pendingQuantity", "unitName", "warehouseId", "locationId",
      "sourceType", "sourceId", "sourceItemId", "partnerId", "receivedDate", "plannedReleaseDate", "status",
    ];
    const dateOf = (d: Date | null) => (d ? formatJstDate(d) : "");
    const lines = rows.map((r) =>
      [
        csvField(r.id),
        csvField(r.category),
        csvField(r.itemName),
        csvField(r.spec ?? ""),
        r.quantity,
        r.pendingQuantity,
        csvField(r.unitName ?? ""),
        csvField(r.warehouseId),
        csvField(r.locationId ?? ""),
        csvField(r.sourceType ?? ""),
        csvField(r.sourceId ?? ""),
        csvField(r.sourceItemId ?? ""),
        csvField(r.partnerId ?? ""),
        csvField(dateOf(r.receivedDate)),
        csvField(dateOf(r.plannedReleaseDate)),
        csvField(r.status),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, lines));
  }

  // ---- 内部 ----

  private async loadActiveHolding(id: string) {
    const holding = await this.repo.findById(id);
    if (!holding) throw new NotFoundError("対象の一時保管が見つかりません");
    if (holding.status === "MOVED_TO_STOCK") throw new BadRequestError("在庫へ移行済みの一時保管は変更できません");
    // REQ-011(3): 在庫へ移す入庫の承認待ちの間は、払出・調整をしない
    const movements = await this.repo.findMovements(id);
    if (movements.some((m) => m.movementType === "MOVE_TO_STOCK" && m.approvalStatus === "PENDING")) {
      throw new BadRequestError("在庫へ移す入庫の承認待ちのため、変更できません");
    }
    return holding;
  }

  private parseDate(value: string, label: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestError(`${label}が不正です`);
    return date;
  }

  // 確定の数量から、承認待ちの減る動きも引いた残りを超えて減らさない
  private async assertNotBelowZero(holdingId: string, decrease: number, label: string) {
    const movements = await this.repo.findMovements(holdingId);
    const available = confirmedQuantityOf(movements) - pendingDecreaseOf(movements);
    if (decrease > available + 1e-9) {
      throw new BadRequestError(`${label}の数量(${decrease})が、一時保管の残り(承認待ちを除く ${available})を超えています`);
    }
  }

  private async recordMovement(
    c: Context<{ Bindings: Env }>,
    holdingId: string,
    movement: {
      movementType: "RECEIVE" | "RELEASE" | "ADJUST";
      quantity: number;
      movementDate: Date;
      memo: string | null;
      sourceType?: string | null;
      sourceId?: string | null;
      sourceItemId?: string | null;
    },
  ): Promise<{ success: true; movementId: string; pending: boolean }> {
    const operator = await this.repo.getFallbackOperatorId(c);
    const now = new Date();
    const movementId = crypto.randomUUID();
    // 承認フローが1つも無ければ、承認なしですぐ確定する
    const needsApproval = await WorkflowEngine.hasActiveFlow(createDb(c.env.DB), HOLDING_TARGET_TYPE);
    await this.repo.insertMovement({
      id: movementId,
      holdingId,
      movementType: movement.movementType,
      quantity: movement.quantity,
      movementDate: movement.movementDate,
      memo: movement.memo,
      sourceType: movement.sourceType ?? null,
      sourceId: movement.sourceId ?? null,
      sourceItemId: movement.sourceItemId ?? null,
      approvalStatus: needsApproval ? "PENDING" : "CONFIRMED",
      createdBy: operator,
      createdAt: now,
      updatedBy: operator,
      updatedAt: now,
    });

    if (needsApproval) {
      await startReconciliationApproval(
        c,
        {
          targetType: HOLDING_TARGET_TYPE,
          targetId: movementId,
          amount: 0,
          comment: `一時保管[${holdingId}]の${MOVEMENT_LABELS[movement.movementType]}(${movement.quantity})の承認申請`,
        },
        () => this.repo.deleteMovement(movementId),
      );
    } else {
      try {
        await confirmHoldingMovement(this.repo, movementId, operator, now);
      } catch (err) {
        await this.repo.deleteMovement(movementId);
        throw err;
      }
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, `TEMPORARY_HOLDING_${movement.movementType}`, RESOURCE_KEY, holdingId, null, {
        movementId,
        quantity: movement.quantity,
        approvalStatus: needsApproval ? "PENDING" : "CONFIRMED",
      }),
    );
    return { success: true, movementId, pending: needsApproval };
  }
}
