/**
 * REQ-017: targetType = "sales_billing"(請求)用の TargetAdapter。手本は sales-invoices.adapter.ts。
 * 承認で APPROVED(承認済み。PDF を発行すると ISSUED)、差戻し・取下げで DRAFT に戻す。金額は請求の合計。プレビューはヘッダーと明細
 */
import { BillingRepository } from "../../routes/sales/billing/billing.repository";
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
  const header = await BillingRepository.fromDb(db).findHeaderById(targetId);
  if (!header) throw new NotFoundError("対象の請求が存在しません");
  return Number(header.totalAmount || 0);
}

async function applyApproved({ db, reqParent, userId, now }: ApplyApprovedParams): Promise<void> {
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);
  await BillingRepository.fromDb(db).updateHeader(reqParent.targetId, {
    status: "APPROVED",
    updatedBy: approverEmployeeNumber,
    updatedAt: now,
  });
}

async function applyRemanded({ db, reqParent, now }: ApplyApprovedParams): Promise<void> {
  await BillingRepository.fromDb(db).updateHeader(reqParent.targetId, { status: "DRAFT", updatedAt: now });
}

async function loadPreview(db: any, targetId: string) {
  const repo = BillingRepository.fromDb(db);
  const header = await repo.findHeaderById(targetId);
  if (!header) return null;
  const items = await repo.findItemsByHeaderId(targetId);
  return { targetName: header.title || header.id, data: { header, items } };
}

async function getTaskPreview({ db, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
  const live = await loadPreview(db, targetId);
  return live ? { targetName: live.targetName, previewData: live.data } : { targetName: "不明な請求", previewData: null };
}

async function getHistoryPreview({ db, targetId }: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const live = await loadPreview(db, targetId);
  return { targetName: live?.targetName ?? "不明な請求", snapshotNew: live?.data ?? null, snapshotOld: null };
}

export const billingAdapter: TargetAdapter = {
  // BUG-103: 請求は「請求管理」の承認フロー(入金と同じメニュー。documentKind で分けられる)
  async resolveFlowTarget() {
    return { requestType: "sales_billing", documentKind: "BILLING" };
  },
  resolveAmount,
  applyApproved,
  applyRemanded,
  getTaskPreview,
  getHistoryPreview,
};
