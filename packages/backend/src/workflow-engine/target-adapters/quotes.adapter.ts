/**
 * targetType = "sales_quotes" 用のTargetAdapter実装(admin/approval-flows画面の
 * 「対象業務」選択肢がscreens.tsのresource値をそのまま使う仕様のため、それに合わせている)。
 * partners.adapter.ts(マスタ)と異なり、対象の見積(quotes)行はDRAFTとして
 * 既にDB上に実在している状態から申請が始まるため、REGISTER(初回承認申請)でも
 * 「新規作成」ではなく「既存DRAFT行のステータス確定」として扱う。
 */
import { QuoteRepository } from "../../routes/sales/quotes/quote.repository";
import { QuoteService } from "../../routes/sales/quotes/quote.service";
import {
  buildQuoteItemInsertRow,
  QuoteItemInput,
} from "../../routes/sales/quotes/quote-item-mapper";
import { WorkflowTasksRepository } from "../../routes/workflow/workflow-tasks/workflow-tasks.repository";
import { NotFoundError } from "../../platform/http/http-error";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import type {
  TargetAdapter,
  ResolveAmountParams,
  ApplyApprovedParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
} from "./registry";
import { recalculateDocumentTotals } from "../../platform/tax/recalculate-document-totals";

interface QuoteUpdateSnapshot {
  header?: Record<string, any>;
  items?: Array<Record<string, any>>;
}

async function resolveAmount({
  db,
  targetId,
  payload,
}: ResolveAmountParams): Promise<number> {
  if (payload.totalAmount !== undefined) {
    return Number(payload.totalAmount) || 0;
  }

  const repo = QuoteRepository.fromDb(db);
  const quote = await repo.findQuoteById(targetId);
  if (!quote) {
    throw new NotFoundError("対象の見積レコードが存在しません");
  }
  return Number(quote.totalAmount || 0);
}

// 最終承認確定時: quotes.status を "APPROVED" にする。UPDATE(承認済み見積の編集申請)の場合は
// 退避スナップショット(header/items)を正式反映してからAPPROVEDにする。DELETE(削除申請)の場合は
// 既存のQuoteService.deleteQuote()(R2添付削除込み)をそのまま呼び出す。
async function applyApproved({
  db,
  reqParent,
  userId,
  now,
  c,
}: ApplyApprovedParams): Promise<void> {
  const repo = QuoteRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(
    db,
    userId,
  );

  if (reqParent.requestType === "DELETE") {
    if (!c) {
      console.error(
        "見積の削除承認確定にはContext(R2バインディング)が必要ですが渡されていません",
      );
      return;
    }
    const service = new QuoteService(new QuoteRepository(c.env.DB));
    await service.performQuoteDeletion(c, reqParent.targetId);
    return;
  }

  if (reqParent.requestType === "REGISTER") {
    // 内容は既にDRAFT行として存在するため、ステータスのみ確定する
    await repo.updateQuote(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }

  // UPDATE: 承認済み見積の編集申請。退避スナップショットを正式反映する
  const contextRecord = await WorkflowTasksRepository.getApprovalContext(
    db,
    reqParent.id,
  );

  if (!contextRecord || !contextRecord.generalMemo) {
    await repo.updateQuote(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }

  // BUG-048: 読み取りに失敗した申請内容は、内容を変えずに承認済みにする(従来どおり)。
  // 反映の書き込みは repo.applyApprovedUpdate の1回の batch で行い、失敗した場合はエラーを返す(明細が消えたまま承認済みにしない)
  let snapshot: QuoteUpdateSnapshot;
  try {
    snapshot = JSON.parse(
      contextRecord.generalMemo,
    ) as QuoteUpdateSnapshot;
  } catch (jsonErr) {
    console.error("見積編集申請の退避データを読み取れないため、内容は変えずに承認済みにします:", jsonErr);
    await repo.updateQuote(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }
  const header = snapshot.header || {};

  // BUG-042: 反映する合計・消費税は、申請内容の明細から計算し直す(会社設定の端数処理)。Context が無い場合は申請時の値
  const totals = c
    ? await recalculateDocumentTotals(
        c.env.COMPANY_SETTINGS,
        { items: snapshot.items as any[] | undefined, totalAmount: header.totalAmount, taxAmount: header.taxAmount },
        await repo.findTaxCategoryRates(),
      )
    : header;
  const headerData = {
    title: header.title ?? null,
    partnerId: header.partnerId ?? undefined,
    quoteDate: header.quoteDate ? new Date(header.quoteDate) : undefined,
    validUntil: header.validUntil ? new Date(header.validUntil) : null,
    status: "APPROVED",
    totalAmount: totals.totalAmount || 0,
    taxAmount: totals.taxAmount || 0,
    memo: header.memo ?? null,
    terms: header.terms ?? null,
    companyName: header.companyName ?? null,
    companyDepartment: header.companyDepartment ?? null,
    salesPersonEmployeeNumber: header.salesPersonEmployeeNumber ?? null,
    inputPersonEmployeeNumber: header.inputPersonEmployeeNumber ?? null,
    companyAddress: header.companyAddress ?? null,
    companyTel: header.companyTel ?? null,
    companyFax: header.companyFax ?? null,
    deliveryDate: header.deliveryDate ?? null,
    deliveryPlace: header.deliveryPlace ?? null,
    paymentTerms: header.paymentTerms ?? null,
    updatedBy: approverEmployeeNumber,
    updatedAt: now,
  };

  const itemRows = Array.isArray(snapshot.items)
    ? snapshot.items.map((item, index) => buildQuoteItemInsertRow(item as QuoteItemInput, reqParent.targetId, index))
    : null;

  await repo.applyApprovedUpdate(reqParent.targetId, headerData, itemRows, {
    id: crypto.randomUUID(),
    quoteId: reqParent.targetId,
    version: 1,
    action: "UPDATE",
    snapshotData: contextRecord.generalMemo,
    changedById: approverEmployeeNumber,
    changedAt: now,
    comment: "承認により内容を反映しました",
  });
}

// 差戻し確定時: REGISTER/UPDATE(承認申請中)はDRAFTへ戻す(業務ルール: 否決された見積は
// 自動的にDRAFTへ戻り、修正して再度承認申請できる)。DELETE(削除申請)の差戻しは、
// 削除申請時にPENDING_DELETIONへ変更した状態をAPPROVEDへ戻す。
async function applyRemanded({
  db,
  reqParent,
  now,
}: ApplyApprovedParams): Promise<void> {
  const repo = QuoteRepository.fromDb(db);
  const revertStatus =
    reqParent.requestType === "DELETE" ? "APPROVED" : "DRAFT";

  await repo.updateQuote(reqParent.targetId, {
    status: revertStatus,
    updatedAt: now,
  });
}

async function buildPreviewFromLive(
  repo: QuoteRepository,
  targetId: string,
): Promise<{ targetName: string; data: unknown } | null> {
  const quote = await repo.findQuoteById(targetId);
  if (!quote) return null;
  const items = await repo.findQuoteItems(targetId);
  return {
    targetName: quote.title || quote.id,
    data: { header: quote, items },
  };
}

async function getTaskPreview({
  db,
  requestId,
  targetId,
}: TaskPreviewParams): Promise<TaskPreviewResult> {
  const repo = QuoteRepository.fromDb(db);
  const savedContext = await WorkflowTasksRepository.getApprovalContext(
    db,
    requestId,
  );

  if (savedContext && savedContext.generalMemo) {
    try {
      const snapshot = JSON.parse(savedContext.generalMemo);
      const header = snapshot.header || snapshot;
      return {
        targetName: header.title || targetId,
        previewData: snapshot,
      };
    } catch (_) {
      // フォールスルーして現在のDB内容を使う
    }
  }

  const live = await buildPreviewFromLive(repo, targetId);
  if (live) return { targetName: live.targetName, previewData: live.data };
  return { targetName: "不明な見積", previewData: null };
}

async function getHistoryPreview({
  db,
  requestId,
  targetId,
  requestType,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = QuoteRepository.fromDb(db);
  const savedContext = await WorkflowTasksRepository.getApprovalContext(
    db,
    requestId,
  );

  let targetName = "不明な見積";
  let snapshotNew: unknown = null;
  let snapshotOld: unknown = null;

  if (savedContext && savedContext.generalMemo) {
    try {
      const snapshot = JSON.parse(savedContext.generalMemo);
      snapshotNew = snapshot;
      const header = snapshot.header || snapshot;
      targetName = header.title || targetId;
    } catch (_) {
      targetName = "データパースエラー";
    }
  }

  if (requestType === "UPDATE" || requestType === "DELETE") {
    const live = await buildPreviewFromLive(repo, targetId);
    if (live) {
      snapshotOld = live.data;
      if (targetName === "不明な見積") targetName = live.targetName;
    }
  } else if (!snapshotNew) {
    const live = await buildPreviewFromLive(repo, targetId);
    if (live) {
      snapshotNew = live.data;
      targetName = live.targetName;
    }
  }

  return { targetName, snapshotNew, snapshotOld };
}

export const quotesAdapter: TargetAdapter = {
  resolveAmount,
  applyApproved,
  applyRemanded,
  getTaskPreview,
  getHistoryPreview,
};
