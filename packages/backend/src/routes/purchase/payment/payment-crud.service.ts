import { Context } from "hono";
import { PaymentRepository } from "./payment.repository";
import { RESOURCE_KEY } from "./payment-constants";
import { CreatePaymentPayload } from "./payment.schema";
import { PurchaseRecognitionRepository } from "../recognitions/purchase-recognition.repository";
import { ReceiptsRepository } from "../../inventory/receipts/receipts.repository";
import { computeDocumentTotals } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { SearchPaymentQuery } from "./payment.schema";
import { SortQuery } from "../../../platform/http/sort";
import { signedAmount } from "../../../platform/documents/red-slip";
import type { TaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";
import { getTaxRoundingMode } from "../../../platform/tax/get-tax-rounding-mode";

// Item10 Phase5: 既にAPPROVED確定済みのpurchase_recognitionsを束ねて支払(payment_headers)を
// 確定する。billing-crud.service.tsと対称。承認ワークフローは持たない(束ねる対象自体が承認済みのため)
export class PaymentCrudService {
  private repo: PaymentRepository;

  constructor(repo: PaymentRepository) {
    this.repo = repo;
  }

  // K-5-1: item_receipt_items(発注紐付き、unitPrice/taxCategoryCode込み)から税込金額・税額を
  // 算出する共通処理。resolveItemReceiptLines/listCandidateItemReceipts両方から使う
  private computeReceiptAmount(
    items: { unitPrice: number | null; receivedQuantity: number; taxCategoryCode: string | null }[],
    taxCategoryRates: Map<string, number>,
    roundingMode: TaxRoundingMode,
  ) {
    const breakdownItems = items.map((i) => ({
      amount: (i.unitPrice ?? 0) * i.receivedQuantity,
      taxCategoryCode: i.taxCategoryCode,
    }));
    const { totalAmount: amount, taxAmount } = computeDocumentTotals(breakdownItems, taxCategoryRates, roundingMode);
    return { amount, taxAmount };
  }

  async searchHeaders(c: Context, query: SearchPaymentQuery, sort?: SortQuery) {
    const result = await this.repo.findHeaders(query, sort);
    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_PAYMENT_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
      }),
    );
    return result;
  }

  async searchHeadersPage(
    c: Context,
    query: SearchPaymentQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [result, total] = await Promise.all([
      this.repo.findHeadersPage(query, params, sort),
      this.repo.countHeaders(query),
    ]);
    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_PAYMENT_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
      }),
    );
    return buildListResponse(result, buildPaginationMeta(params, total));
  }

  async getPaymentDetail(c: Context, id: string) {
    const header = await this.repo.findHeaderById(id);
    if (!header) return null;

    const itemRows = await this.repo.findItemsWithReferenceDetail(id);
    const disbursements = await this.repo.findDisbursementsByHeaderId(id);

    return {
      ...header,
      // K-5-2: purchaseRecognitionに紐づく発注の前払実績(isPaid/paidAt/totalAmount)を
      // advanceOrderとして添える(purchaseRecognitionId経由以外の行、または前払でない発注はnull)
      items: itemRows.map((row) => ({
        ...row.paymentHeaderItem,
        purchaseRecognition: row.purchaseRecognition,
        itemReceipt: row.itemReceipt,
        advanceOrder: row.advanceOrder?.isPaid ? row.advanceOrder : null,
      })),
      disbursements,
    };
  }

  private validateCreatePayload(
    body: CreatePaymentPayload,
    itemReceipts: NonNullable<CreatePaymentPayload["itemReceipts"]>,
    manualItems: NonNullable<CreatePaymentPayload["manualItems"]>,
  ) {
    const totalLineCount = body.purchaseRecognitionIds.length + itemReceipts.length + manualItems.length;
    if (totalLineCount === 0) {
      throw new BadRequestError("対象の仕入・検収記録、または明細を1件以上指定してください");
    }
    if (body.mode === "PER_TRANSACTION" && totalLineCount !== 1) {
      throw new BadRequestError(
        "都度支払(PER_TRANSACTION)では対象を合計1件のみ選択してください",
      );
    }
    if (body.mode === "PERIODIC") {
      if (!body.periodStart || !body.periodEnd) {
        throw new BadRequestError("締め支払(PERIODIC)では対象期間(periodStart/periodEnd)の指定が必要です");
      }
    }
  }

  // K-5-1: 検収記録(item_receipt_headers)の対象検証+金額算出。発注紐付き(item_receipt_items全件が
  // order_items経由で単価を持つ)の場合のみ自動計算し、発注非依存の検収は呼び出し元が指定した
  // amount/taxAmountをそのまま使う(ユーザー確認済み方針)
  private async resolveItemReceiptLines(
    c: Context,
    partnerId: string,
    selections: NonNullable<CreatePaymentPayload["itemReceipts"]>,
  ) {
    if (selections.length === 0) return [];

    const receiptsRepo = new ReceiptsRepository(c.env.DB);
    const ids = selections.map((s) => s.id);
    const targetReceipts = await receiptsRepo.findReceiptHeadersByIds(ids);
    if (targetReceipts.length !== ids.length) {
      throw new NotFoundError("指定された検収記録の一部が見つかりません");
    }
    const alreadyUsedIds = await this.repo.findUsedItemReceiptIds(ids);
    const taxCategoryRates = await receiptsRepo.findTaxCategoryRates();
    const roundingMode = await getTaxRoundingMode(c.env.COMPANY_SETTINGS);

    const lines: { id: string; amount: number; taxAmount: number }[] = [];
    for (const receipt of targetReceipts) {
      if (receipt.status !== "APPROVED") {
        throw new BadRequestError(`検収記録[${receipt.id}]は承認済みではないため支払対象にできません`);
      }
      if (!receipt.partnerId) {
        throw new BadRequestError(`検収記録[${receipt.id}]には取引先が設定されていないため支払対象にできません`);
      }
      if (receipt.partnerId !== partnerId) {
        throw new BadRequestError(`検収記録[${receipt.id}]の取引先が指定の支払先と一致しません`);
      }
      if (alreadyUsedIds.has(receipt.id)) {
        throw new BadRequestError(`検収記録[${receipt.id}]は既に他の支払対象として選択済みです`);
      }

      const items = await receiptsRepo.findItemsWithPricingByHeaderId(receipt.id);
      const allPriced = items.length > 0 && items.every((i) => i.unitPrice != null);

      if (allPriced) {
        const { amount, taxAmount } = this.computeReceiptAmount(items, taxCategoryRates, roundingMode);
        lines.push({ id: receipt.id, amount, taxAmount });
      } else {
        const selection = selections.find((s) => s.id === receipt.id)!;
        if (selection.amount == null || selection.taxAmount == null) {
          throw new BadRequestError(
            `検収記録[${receipt.id}]は発注に基づく単価情報を持たないため、amount/taxAmountを直接指定してください`,
          );
        }
        lines.push({ id: receipt.id, amount: selection.amount, taxAmount: selection.taxAmount });
      }
    }
    return lines;
  }

  async createPayment(c: Context, body: CreatePaymentPayload) {
    const itemReceiptSelections = body.itemReceipts ?? [];
    const manualItems = body.manualItems ?? [];
    this.validateCreatePayload(body, itemReceiptSelections, manualItems);

    const purchaseRecognitionRepo = new PurchaseRecognitionRepository(c.env.DB);
    const targetRecognitions = await this.repo.findPurchaseRecognitionsByIds(
      body.purchaseRecognitionIds,
    );

    if (targetRecognitions.length !== body.purchaseRecognitionIds.length) {
      throw new NotFoundError("指定された仕入の一部が見つかりません");
    }
    for (const rec of targetRecognitions) {
      if (rec.status !== "APPROVED") {
        throw new BadRequestError(`仕入[${rec.id}]は承認済みではないため支払対象にできません`);
      }
      if (rec.paymentStatus === "PAID") {
        throw new BadRequestError(`仕入[${rec.id}]は既に支払済み(PAID)です`);
      }
      if (rec.partnerId !== body.partnerId) {
        throw new BadRequestError(`仕入[${rec.id}]の取引先が指定の支払先と一致しません`);
      }
    }

    // K-5-2: 紐づく発注が前払済み(isPaid=true)の仕入計上は、前渡金で相殺済みとして金額¥0の
    // 支払明細を作成する(実際の現金移動は発注の前払時点で完了済みのため)。仕訳側の簡易対応
    // (仕入の仕訳作成 buildJournalInput、全額前渡金充当とみなす)と整合させる方針
    const advanceOrderIds = targetRecognitions
      .map((rec) => rec.orderId)
      .filter((id): id is string => !!id);
    const prepaidOrders = await this.repo.findOrdersByIds(advanceOrderIds);
    const prepaidOrderIds = new Set(prepaidOrders.filter((o) => o.isPaid).map((o) => o.id));
    const recognitionLines = targetRecognitions.map((rec) => {
      const isAdvancePrepaid = !!rec.orderId && prepaidOrderIds.has(rec.orderId);
      return {
        id: rec.id,
        // 追加要望L-2-a: 赤伝(返品/値引/赤伝(訂正))は支払額から減算する(伝票自体は正の金額で保存)
        amount: isAdvancePrepaid ? 0 : signedAmount(rec.documentType, rec.totalAmount),
        taxAmount: isAdvancePrepaid ? 0 : signedAmount(rec.documentType, rec.taxAmount),
      };
    });

    const itemReceiptLines = await this.resolveItemReceiptLines(c, body.partnerId, itemReceiptSelections);

    // K-5-3: 完全手動入力行。amountは税込金額として直接使う(billing_itemsと異なり数量×単価の
    // 内訳計算は行わない)
    const manualLines = manualItems.map((item) => ({
      itemName: item.itemName,
      amount: item.amount,
      taxAmount: item.taxAmount ?? 0,
    }));

    const opId = await this.repo.getFallbackOperatorId(c);
    const paymentId = await resolveConfiguredDocumentId(
      c,
      "payment",
      (id) => this.repo.existsHeader(id),
      null,
    );

    const totalAmount =
      recognitionLines.reduce((s, line) => s + line.amount, 0) +
      itemReceiptLines.reduce((s, line) => s + line.amount, 0) +
      manualLines.reduce((s, line) => s + line.amount, 0);
    const taxAmount =
      recognitionLines.reduce((s, line) => s + line.taxAmount, 0) +
      itemReceiptLines.reduce((s, line) => s + line.taxAmount, 0) +
      manualLines.reduce((s, line) => s + line.taxAmount, 0);

    await this.repo.insertHeader({
      id: paymentId,
      partnerId: body.partnerId,
      title: body.title || null,
      paymentDate: new Date(body.paymentDate),
      mode: body.mode,
      periodStart: body.periodStart ? new Date(body.periodStart) : null,
      periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
      status: "DRAFT",
      totalAmount,
      taxAmount,
      reconciledAmount: 0,
      reconciliationStatus: "UNRECONCILED",
      memo: body.memo || null,
      createdBy: opId,
      updatedBy: opId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let sortOrder = 0;
    for (const line of recognitionLines) {
      await this.repo.insertItem({
        id: crypto.randomUUID(),
        paymentHeaderId: paymentId,
        purchaseRecognitionId: line.id,
        itemReceiptId: null,
        itemName: null,
        amount: line.amount,
        taxAmount: line.taxAmount,
        sortOrder: sortOrder++,
      });
    }
    for (const line of itemReceiptLines) {
      await this.repo.insertItem({
        id: crypto.randomUUID(),
        paymentHeaderId: paymentId,
        purchaseRecognitionId: null,
        itemReceiptId: line.id,
        itemName: null,
        amount: line.amount,
        taxAmount: line.taxAmount,
        sortOrder: sortOrder++,
      });
    }
    for (const line of manualLines) {
      await this.repo.insertItem({
        id: crypto.randomUUID(),
        paymentHeaderId: paymentId,
        purchaseRecognitionId: null,
        itemReceiptId: null,
        itemName: line.itemName,
        amount: line.amount,
        taxAmount: line.taxAmount,
        sortOrder: sortOrder++,
      });
    }

    await purchaseRecognitionRepo.markRecognitionsAsPaid(body.purchaseRecognitionIds);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_PAYMENT", RESOURCE_KEY, paymentId, null, {
        id: paymentId,
        partnerId: body.partnerId,
        mode: body.mode,
        purchaseRecognitionIds: body.purchaseRecognitionIds,
        itemReceiptIds: itemReceiptLines.map((l) => l.id),
        manualItemCount: manualLines.length,
        totalAmount,
      }),
    );

    return { success: true, message: "支払情報を新規登録しました", id: paymentId };
  }

  // K-5-1: 支払作成モーダルの「検収から選択」タブ用候補一覧。承認済み・対象取引先・未使用
  // (他の支払からまだ参照されていない)の検収記録を返し、発注紐付きで金額が自動計算できるものは
  // computedAmount/computedTaxAmountを添えて返す(発注非依存の検収はrequiresManualAmount=trueとし、
  // フロント側で金額入力欄を表示する)
  async listCandidateItemReceipts(c: Context, partnerId: string) {
    if (!partnerId) return [];

    const receiptsRepo = new ReceiptsRepository(c.env.DB);
    const candidates = await receiptsRepo.findApprovedReceiptsByPartnerId(partnerId);
    if (candidates.length === 0) return [];

    const usedIds = await this.repo.findUsedItemReceiptIds(candidates.map((r) => r.id));
    const unused = candidates.filter((r) => !usedIds.has(r.id));
    if (unused.length === 0) return [];

    const taxCategoryRates = await receiptsRepo.findTaxCategoryRates();

    const roundingMode = await getTaxRoundingMode(c.env.COMPANY_SETTINGS);

    // L-1-b: 同じ納品の仕入計上(purchase_recognition_receipts)が既に支払済みなら警告用に添える
    // (選択自体は可能。二重支払の意図的でない起票に気づけるようにするための表示のみ)
    const links = await this.repo.findLinkedRecognitionsByReceiptIds(unused.map((r) => r.id));
    const linksByReceiptId = new Map<string, typeof links>();
    for (const link of links) {
      const list = linksByReceiptId.get(link.itemReceiptId) ?? [];
      list.push(link);
      linksByReceiptId.set(link.itemReceiptId, list);
    }

    return await Promise.all(
      unused.map(async (receipt) => {
        const items = await receiptsRepo.findItemsWithPricingByHeaderId(receipt.id);
        const allPriced = items.length > 0 && items.every((i) => i.unitPrice != null);
        const linked = linksByReceiptId.get(receipt.id) ?? [];
        const linkedInfo = {
          linkedRecognitionIds: linked.map((l) => l.recognitionId),
          linkedRecognitionPaid: linked.some((l) => l.paymentStatus === "PAID"),
        };

        if (!allPriced) {
          return {
            id: receipt.id,
            partnerId: receipt.partnerId,
            receivedDate: receipt.receivedDate,
            supplierInvoiceNumber: receipt.supplierInvoiceNumber,
            computedAmount: null,
            computedTaxAmount: null,
            requiresManualAmount: true,
            ...linkedInfo,
          };
        }

        const { amount: computedAmount, taxAmount: computedTaxAmount } = this.computeReceiptAmount(
          items,
          taxCategoryRates,
          roundingMode,
        );

        return {
          id: receipt.id,
          partnerId: receipt.partnerId,
          receivedDate: receipt.receivedDate,
          supplierInvoiceNumber: receipt.supplierInvoiceNumber,
          computedAmount,
          computedTaxAmount,
          requiresManualAmount: false,
          ...linkedInfo,
        };
      }),
    );
  }

  // K-5-2: 支払作成モーダルの「仕入から選択」タブ用候補一覧。未払・承認済みの仕入計上を返し、
  // 紐づく発注が前払済み(isPaid=true)の場合はisAdvancePrepaid=trueを添える(この場合、実際に
  // 支払対象へ選択すると金額¥0の明細が作成される。createPaymentのrecognitionLines算出と同じ判定)
  async listCandidateRecognitions(c: Context, partnerId: string) {
    if (!partnerId) return [];

    const candidates = await this.repo.findUnpaidApprovedRecognitionsByPartnerId(partnerId);
    if (candidates.length === 0) return [];

    const orderIds = candidates.map((r) => r.orderId).filter((id): id is string => !!id);
    const orders = await this.repo.findOrdersByIds(orderIds);
    const prepaidOrdersById = new Map(orders.filter((o) => o.isPaid).map((o) => [o.id, o]));

    // L-1-b: 紐づく検収記録が既に支払対象になっていれば警告用に添える(選択自体は可能)
    const links = await this.repo.findLinkedReceiptIdsByRecognitionIds(candidates.map((r) => r.id));
    const usedReceiptIds = await this.repo.findUsedItemReceiptIds(links.map((l) => l.itemReceiptId));
    const receiptIdsByRecognition = new Map<string, string[]>();
    for (const link of links) {
      const list = receiptIdsByRecognition.get(link.recognitionId) ?? [];
      list.push(link.itemReceiptId);
      receiptIdsByRecognition.set(link.recognitionId, list);
    }

    return candidates.map((rec) => {
      const advanceOrder = rec.orderId ? prepaidOrdersById.get(rec.orderId) : undefined;
      const linkedReceiptIds = receiptIdsByRecognition.get(rec.id) ?? [];
      return {
        linkedReceiptIds,
        linkedReceiptPaid: linkedReceiptIds.some((id) => usedReceiptIds.has(id)),
        id: rec.id,
        title: rec.title,
        partnerId: rec.partnerId,
        recognitionDate: rec.recognitionDate,
        // BUG-057: 赤伝(返品・値引・訂正)は支払額から差し引くため、画面で区別できるよう伝票区分を返す
        documentType: rec.documentType,
        totalAmount: rec.totalAmount,
        taxAmount: rec.taxAmount,
        isAdvancePrepaid: !!advanceOrder,
        advanceOrderId: advanceOrder?.id ?? null,
        advancePaidAt: advanceOrder?.paidAt ?? null,
      };
    });
  }
}
