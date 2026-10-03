import { Context } from "hono";
import { Env } from "../../../types/env";
import { CashReceiptsRepository } from "./cash-receipts.repository";
import { LinkCashReceiptPayload, RegisterCashReceiptPayload, SearchCashReceiptsQuery } from "./cash-receipts.schema";
import { BillingRepository } from "../billing/billing.repository";
import { BillingReconciliationService } from "../billing/billing-reconciliation.service";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

export const RESOURCE_KEY = "sales_cash_receipts";

// 追加要望L-1-a: 単体入金。請求を介さずに入金(取引先+入金日+金額+方法+摘要)を登録し、
// 後から請求へ紐づけて消込する。支払の単体入力(K-5-3)と対称の運用。
// 請求への紐づけは既存の入金消込ロジック(BillingReconciliationService)をそのまま使う。
// 仕訳は既存の入金消込・支払と同じく自動起票しない
export class CashReceiptsService {
  private repo: CashReceiptsRepository;

  constructor(repo: CashReceiptsRepository) {
    this.repo = repo;
  }

  list(query: SearchCashReceiptsQuery) {
    return this.repo.findMany(query);
  }

  async getById(id: string) {
    const receipt = await this.repo.findById(id);
    if (!receipt) throw new NotFoundError("対象の入金が見つかりません");
    return receipt;
  }

  async register(c: Context<{ Bindings: Env }>, body: RegisterCashReceiptPayload) {
    if (!(await this.repo.partnerExists(body.partnerId))) {
      throw new BadRequestError(`取引先[${body.partnerId}]が見つかりません`);
    }
    const receiptDate = new Date(body.receiptDate);
    if (Number.isNaN(receiptDate.getTime())) throw new BadRequestError("入金日が不正です");

    const operator = await this.repo.getFallbackOperatorId(c);
    const id = await resolveConfiguredDocumentId(c, "cash_receipt", (candidate) => this.repo.existsId(candidate), null);
    const now = new Date();
    await this.repo.insert({
      id,
      partnerId: body.partnerId,
      receiptDate,
      amount: body.amount,
      method: body.method ?? "BANK_TRANSFER",
      memo: body.memo || null,
      status: "UNLINKED",
      billingHeaderId: null,
      linkedAt: null,
      createdBy: operator,
      createdAt: now,
      updatedBy: operator,
      updatedAt: now,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_CASH_RECEIPT", RESOURCE_KEY, id, null, { ...body, id }),
    );
    return { success: true, id, message: "入金を登録しました" };
  }

  // 請求へ紐づけて消込する。①未紐づけの場合のみ紐づけ済みにする(二重紐づけ防止)→②既存の入金消込を実行。
  // ②に失敗した場合は紐づけを元に戻す
  async link(c: Context<{ Bindings: Env }>, id: string, body: LinkCashReceiptPayload) {
    const receipt = await this.getById(id);
    if (receipt.status === "LINKED") throw new BadRequestError("この入金は既に請求へ紐づけ済みです");

    const billingRepo = new BillingRepository(c.env.DB);
    const billing = await billingRepo.findHeaderById(body.billingHeaderId);
    if (!billing) throw new NotFoundError("紐づけ先の請求が見つかりません");
    if (billing.partnerId !== receipt.partnerId) {
      throw new BadRequestError("入金の取引先と請求の取引先が一致しません");
    }

    const operator = await this.repo.getFallbackOperatorId(c);
    if (!(await this.repo.markLinked(id, body.billingHeaderId, operator))) {
      throw new BadRequestError("この入金は既に請求へ紐づけ済みです");
    }

    try {
      const result = await new BillingReconciliationService(billingRepo).recordPaymentReceipt(c, body.billingHeaderId, {
        receivedDate: receipt.receiptDate.toISOString(),
        amount: receipt.amount,
        method: receipt.method as "BANK_TRANSFER" | "CASH" | "OTHER",
        memo: `単体入金[${id}]${receipt.memo ? ` ${receipt.memo}` : ""}`,
      }, id);
      c.executionCtx.waitUntil(
        logAuditEvent(c, "LINK_CASH_RECEIPT", RESOURCE_KEY, id, receipt, {
          billingHeaderId: body.billingHeaderId,
          reconciliationStatus: result.reconciliationStatus,
        }),
      );
      return { ...result, message: "入金を請求へ紐づけて消込しました" };
    } catch (err) {
      await this.repo.revertLinked(id, operator);
      throw err;
    }
  }

  // 未紐づけの入金のみ削除できる(紐づけ済みは請求の消込に反映済みのため削除不可)
  async remove(c: Context<{ Bindings: Env }>, id: string) {
    const receipt = await this.getById(id);
    if (receipt.status === "LINKED") {
      throw new BadRequestError("請求へ紐づけ済みの入金は削除できません");
    }
    await this.repo.delete(id);
    c.executionCtx.waitUntil(logAuditEvent(c, "DELETE_CASH_RECEIPT", RESOURCE_KEY, id, receipt, null));
    return { success: true, message: "入金を削除しました" };
  }

  async exportCsv(c: Context<{ Bindings: Env }>, query: SearchCashReceiptsQuery) {
    const rows = await this.repo.findMany(query);
    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_CASH_RECEIPTS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, { recordCount: rows.length }),
    );
    const headers = ["id", "partnerId", "receiptDate", "amount", "method", "status", "billingHeaderId", "memo"];
    const lines = rows.map((r) =>
      [
        csvField(r.id),
        csvField(r.partnerId),
        csvField(r.receiptDate.toISOString().slice(0, 10)),
        r.amount,
        csvField(r.method),
        csvField(r.status),
        csvField(r.billingHeaderId ?? ""),
        csvField(r.memo ?? ""),
      ].join(","),
    );
    return withBom(buildCsvContent(headers, lines));
  }
}
