/**
 * targetType = "sales_invoices" 用のTargetAdapter実装(quotes.adapter.tsと同じ方針)。
 * REGISTER(初回承認申請)は既にDRAFT行として実在する売上の「ステータス確定」として扱う。
 * 仕訳は承認確定時に自動転記せず、仕訳データ出力画面で「伝票を選んで仕訳を作成」する(V-4)。
 */
import { SalesInvoiceRepository } from "../../routes/sales/invoices/sales-invoice.repository";
import { SalesInvoiceService } from "../../routes/sales/invoices/sales-invoice.service";
import {
  buildSalesInvoiceItemInsertRow,
  SalesInvoiceItemInput,
} from "../../routes/sales/invoices/sales-invoice-item-mapper";
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

interface SalesInvoiceUpdateSnapshot {
  header?: Record<string, any>;
  items?: Array<Record<string, any>>;
}

async function resolveAmount({ db, targetId, payload }: ResolveAmountParams): Promise<number> {
  if (payload.totalAmount !== undefined) {
    return Number(payload.totalAmount) || 0;
  }
  const repo = SalesInvoiceRepository.fromDb(db);
  const invoice = await repo.findInvoiceById(targetId);
  if (!invoice) {
    throw new NotFoundError("対象の売上レコードが存在しません");
  }
  return Number(invoice.totalAmount || 0);
}

async function applyApproved({ db, reqParent, userId, now, c }: ApplyApprovedParams): Promise<void> {
  const repo = SalesInvoiceRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(db, userId);

  if (reqParent.requestType === "DELETE") {
    if (!c) {
      console.error("売上の削除承認確定にはContext(R2バインディング)が必要ですが渡されていません");
      return;
    }
    const service = new SalesInvoiceService(new SalesInvoiceRepository(c.env.DB));
    await service.performInvoiceDeletion(c, reqParent.targetId);
    return;
  }

  if (reqParent.requestType === "REGISTER") {
    await repo.updateInvoice(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }

  // UPDATE: 承認済み売上の編集申請。退避スナップショットを正式反映する
  const contextRecord = await WorkflowTasksRepository.getApprovalContext(db, reqParent.id);

  if (!contextRecord || !contextRecord.generalMemo) {
    await repo.updateInvoice(reqParent.targetId, {
      status: "APPROVED",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
    return;
  }

  // BUG-048: 読み取りに失敗した申請内容は、内容を変えずに承認済みにする(従来どおり)。
  // 反映の書き込みは repo.applyApprovedUpdate の1回の batch で行い、失敗した場合はエラーを返す(明細が消えたまま承認済みにしない)
  let snapshot: SalesInvoiceUpdateSnapshot;
  try {
    snapshot = JSON.parse(contextRecord.generalMemo) as SalesInvoiceUpdateSnapshot;
  } catch (jsonErr) {
    console.error("売上編集申請の退避データを読み取れないため、内容は変えずに承認済みにします:", jsonErr);
    await repo.updateInvoice(reqParent.targetId, {
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
    salesOrderId: header.salesOrderId ?? null,
    invoiceDate: header.invoiceDate ? new Date(header.invoiceDate) : undefined,
    status: "APPROVED",
    documentType: header.documentType ?? "SALE",
    originalInvoiceId: header.originalInvoiceId ?? null,
    totalAmount: totals.totalAmount || 0,
    taxAmount: totals.taxAmount || 0,
    memo: header.memo ?? null,
    companyName: header.companyName ?? null,
    companyDepartment: header.companyDepartment ?? null,
    salesPersonEmployeeNumber: header.salesPersonEmployeeNumber ?? null,
    inputPersonEmployeeNumber: header.inputPersonEmployeeNumber ?? null,
    companyAddress: header.companyAddress ?? null,
    companyTel: header.companyTel ?? null,
    companyFax: header.companyFax ?? null,
    paymentTerms: header.paymentTerms ?? null,
    updatedBy: approverEmployeeNumber,
    updatedAt: now,
  };

  const itemRows = Array.isArray(snapshot.items)
    ? snapshot.items.map((item, index) => buildSalesInvoiceItemInsertRow(item as SalesInvoiceItemInput, reqParent.targetId, index))
    : null;

  await repo.applyApprovedUpdate(reqParent.targetId, headerData, itemRows, {
    id: crypto.randomUUID(),
    salesInvoiceId: reqParent.targetId,
    version: 1,
    action: "UPDATE",
    snapshotData: contextRecord.generalMemo,
    changedById: approverEmployeeNumber,
    changedAt: now,
    comment: "承認により内容を反映しました",
  });
}

async function applyRemanded({ db, reqParent, now }: ApplyApprovedParams): Promise<void> {
  const repo = SalesInvoiceRepository.fromDb(db);
  const revertStatus = reqParent.requestType === "DELETE" ? "APPROVED" : "DRAFT";

  await repo.updateInvoice(reqParent.targetId, {
    status: revertStatus,
    updatedAt: now,
  });
}

async function buildPreviewFromLive(
  repo: SalesInvoiceRepository,
  targetId: string,
): Promise<{ targetName: string; data: unknown } | null> {
  const invoice = await repo.findInvoiceById(targetId);
  if (!invoice) return null;
  const items = await repo.findInvoiceItems(targetId);
  return {
    targetName: invoice.title || invoice.id,
    data: { header: invoice, items },
  };
}

async function getTaskPreview({ db, requestId, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
  const repo = SalesInvoiceRepository.fromDb(db);
  const savedContext = await WorkflowTasksRepository.getApprovalContext(db, requestId);

  if (savedContext && savedContext.generalMemo) {
    try {
      const snapshot = JSON.parse(savedContext.generalMemo);
      const header = snapshot.header || snapshot;
      return { targetName: header.title || targetId, previewData: snapshot };
    } catch (_) {
      // フォールスルーして現在のDB内容を使う
    }
  }

  const live = await buildPreviewFromLive(repo, targetId);
  if (live) return { targetName: live.targetName, previewData: live.data };
  return { targetName: "不明な売上", previewData: null };
}

async function getHistoryPreview({
  db,
  requestId,
  targetId,
  requestType,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = SalesInvoiceRepository.fromDb(db);
  const savedContext = await WorkflowTasksRepository.getApprovalContext(db, requestId);

  let targetName = "不明な売上";
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
      if (targetName === "不明な売上") targetName = live.targetName;
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

export const salesInvoicesAdapter: TargetAdapter = {
  resolveAmount,
  applyApproved,
  applyRemanded,
  getTaskPreview,
  getHistoryPreview,
};
