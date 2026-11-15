import { TemporaryHoldingsRepository } from "./temporary-holdings.repository";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

/**
 * REQ-011(2): 一時保管の動きを確定し、台帳の数量・状態を確定の動きの合計で計算し直す
 * (承認なしの登録と、承認(アダプター)の両方から使う)。
 * 確定すると数量がマイナスになる動き(払出・減らす調整)は断る(承認待ちの間に他の払出が確定した場合など)。
 */
export const HOLDING_TARGET_TYPE = "inventory_temporary_holdings";

export const confirmedQuantityOf = (movements: Array<{ quantity: number; approvalStatus: string }>) =>
  movements.filter((m) => m.approvalStatus === "CONFIRMED").reduce((sum, m) => sum + m.quantity, 0);

export const pendingDecreaseOf = (movements: Array<{ quantity: number; approvalStatus: string }>) =>
  movements.filter((m) => m.approvalStatus === "PENDING" && m.quantity < 0).reduce((sum, m) => sum - m.quantity, 0);

// 小数の誤差を丸める(数量は小数3桁まで)
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function confirmHoldingMovement(
  repo: TemporaryHoldingsRepository,
  movementId: string,
  operator: string,
  now: Date,
): Promise<void> {
  const movement = await repo.findMovementById(movementId);
  if (!movement) throw new NotFoundError("対象の一時保管の動きが存在しません");
  const holding = await repo.findById(movement.holdingId);
  if (!holding) throw new NotFoundError("対象の一時保管が存在しません");

  const movements = await repo.findMovements(holding.id);
  const others = movements.filter((m) => m.id !== movementId);
  const quantity = round3(confirmedQuantityOf(others) + movement.quantity);
  if (quantity < 0) {
    throw new BadRequestError(
      `確定すると一時保管[${holding.id}]の数量がマイナスになるため確定できません(今の数量 ${confirmedQuantityOf(others)})`,
    );
  }
  await repo.updateMovement(movementId, { approvalStatus: "CONFIRMED", updatedBy: operator, updatedAt: now });
  await repo.updateHolding(holding.id, {
    quantity,
    // REQ-011(3): 在庫へ移す動きが確定したら「在庫へ移行済」
    status: movement.movementType === "MOVE_TO_STOCK" ? "MOVED_TO_STOCK" : quantity > 0 ? "HOLDING" : "RELEASED",
    updatedBy: operator,
    updatedAt: now,
  });
}

/**
 * REQ-011(3): 一時保管から在庫へ移す入庫の承認・取下げに合わせる(inventory-stock.adapter.ts から呼ぶ)。
 * 入庫が承認されたら、在庫へ移す動きを確定し、台帳を「在庫へ移行済」にする。入庫が取り下げられたら、動きを差戻しにする
 * (台帳はまた払出・調整・在庫へ移すことができる)。差戻し(修正して再申請できる)の間は、承認待ちのまま残す。
 */
export async function confirmMoveToStockOfReceipt(db: any, receiptId: string, operator: string, now: Date): Promise<void> {
  const repo = TemporaryHoldingsRepository.fromDb(db);
  const movement = await repo.findPendingMoveBySource(receiptId);
  if (movement) await confirmHoldingMovement(repo, movement.id, operator, now);
}

export async function cancelMoveToStockOfReceipt(db: any, receiptId: string, now: Date): Promise<void> {
  const repo = TemporaryHoldingsRepository.fromDb(db);
  const movement = await repo.findPendingMoveBySource(receiptId);
  if (movement) await repo.updateMovement(movement.id, { approvalStatus: "REMANDED", updatedAt: now });
}
