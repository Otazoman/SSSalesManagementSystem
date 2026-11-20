/**
 * REQ-026: targetType = "purchase_payment"(支払)用の TargetAdapter。手本は billing.adapter.ts(請求の REQ-017)。
 * 承認で APPROVED(承認済み。支払の記録・総合振込データの対象になる)、差戻し・取下げで DRAFT に戻す。金額は支払の合計。プレビューはヘッダーと明細
 */
import { PaymentRepository } from "../../routes/purchase/payment/payment.repository";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import { NotFoundError } from "../../platform/http/http-error";
import type {
  TargetAdapter,
  ApplyApprovedParams,
  ResolveAmountParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
} from "./registry";

async function resolveAmount({ db, targetId, payload }: ResolveAmountParams): Promise<number> {
  if (payload?.totalAmount !== undefined) return Number(payload.totalAmount) || 0;
  const header = await PaymentRepository.fromDb(db).findHeaderById(targetId);
  if (!header) throw new NotFoundError("対象の支払が存在しません");
  return Number(header.totalAmount || 0);
}

async function applyApproved({ db, reqParent, userId, now }: ApplyApprovedParams): Promise<void> {
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);
  await PaymentRepository.fromDb(db).updateHeader(reqParent.targetId, {
    status: "APPROVED",
    updatedBy: approverEmployeeNumber,
    updatedAt: now,
  });
}

async function applyRemanded({ db, reqParent, now }: ApplyApprovedParams): Promise<void> {
  await PaymentRepository.fromDb(db).updateHeader(reqParent.targetId, { status: "DRAFT", updatedAt: now });
}

async function loadPreview(db: any, targetId: string) {
  const repo = PaymentRepository.fromDb(db);
  const header = await repo.findHeaderById(targetId);
  if (!header) return null;
  const items = await repo.findItemsByHeaderId(targetId);
  return { targetName: header.title || header.id, data: { header, items } };
}

async function getTaskPreview({ db, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
  const live = await loadPreview(db, targetId);
  return live ? { targetName: live.targetName, previewData: live.data } : { targetName: "不明な支払", previewData: null };
}

async function getHistoryPreview({ db, targetId }: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const live = await loadPreview(db, targetId);
  return { targetName: live?.targetName ?? "不明な支払", snapshotNew: live?.data ?? null, snapshotOld: null };
}

export const paymentsAdapter: TargetAdapter = {
  // 支払は「支払管理」の承認フロー(支払の消込と同じメニュー。documentKind で分けられる)
  async resolveFlowTarget() {
    return { requestType: "purchase_payment", documentKind: "PAYMENT" };
  },
  resolveAmount,
  applyApproved,
  applyRemanded,
  getTaskPreview,
  getHistoryPreview,
};
