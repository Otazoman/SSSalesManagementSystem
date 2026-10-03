import { Context } from "hono";
import { SalesOrderRepository } from "./sales-order.repository";
import { SalesOrderPayload } from "./sales-order.schema";
import { RESOURCE_KEY } from "./sales-order-constants";
import {
  buildSalesOrderItemInsertRow,
  buildSalesOrderItemsFromQuote,
} from "./sales-order-item-mapper";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { deleteOrphanedR2Attachments } from "../../../platform/r2/delete-orphaned-attachments";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { isSalesOrderWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { WorkflowTasksRepository } from "../../workflow/workflow-tasks/workflow-tasks.repository";
import { SearchOrdersQuery } from "./sales-order.schema";
import { SortQuery } from "../../../platform/http/sort";
import {
  StockReservationRepository,
  releaseOrderItems,
} from "../../../platform/inventory/stock-reservation.repository";
import {
  WarehouseStockReservationRepository,
  reserveOrderItemsWarehouseAware,
  releaseOrderItemsWarehouseAware,
  retryBackorderedItems,
  previewStockShortage,
  adjustReservationForUpdateSubmission,
  revertPendingUpdateReservationOutcome,
  PendingUpdateReservationOutcome,
} from "../../../platform/inventory/warehouse-stock-reservation.repository";
import { deleteFromPair } from "../../../platform/r2/bucket-with-fallback";
import { recalculateDocumentTotals } from "../../../platform/tax/recalculate-document-totals";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";
import { assertPartnerNotSuspended } from "../../../platform/partners/suspended-partner";

// Item7: quote-crud.service.tsと同じ分割方針(検索・詳細取得・CRUD・承認申請/削除申請の状態遷移)。
// 受注固有の差分は「見積からの明細組み立て」(createOrder)と「与信確認」(下書き保存・確定の両方)の2点
export class SalesOrderCrudService {
  private repo: SalesOrderRepository;

  // Item7: 与信確認は警告のみ(保存・確定自体はブロックしない)。承認ワークフローのON/OFFに
  // 関わらず常に実施する(ユーザー確認済み: 下書き保存時点で早期に知らせ、その後の対応
  // (承認申請する/内容を見直す等)は利用者の判断に委ねる)
  private async buildCreditWarning(
    partnerId: string | null | undefined,
    totalAmount: number,
    excludeOrderId?: string,
  ): Promise<string | undefined> {
    if (!partnerId) return undefined;
    const partner = await this.repo.findPartnerById(partnerId);
    if (!partner || !(partner.creditLimit > 0)) return undefined;

    // Item7時点の近似値: 承認済み受注の合計を「受注残」とみなす。
    // Item8(売上)実装後は「未回収売上分の加算」「請求済み分の控除」への拡張が必要
    const approvedSum = await this.repo.findApprovedOrderTotalByPartner(partnerId, excludeOrderId);
    const projectedTotal = approvedSum + (totalAmount || 0);
    if (projectedTotal > partner.creditLimit) {
      return `与信限度額を超過しています(限度額: ${partner.creditLimit}円 / 承認済み受注残+今回: ${projectedTotal}円)`;
    }
    return undefined;
  }

  // Item7残課題2-5: 倉庫単位引当の結果、不足(バックオーダー)が発生した明細があれば
  // 与信警告と同じ非ブロッキングのamber警告メッセージを組み立てる
  private buildBackorderWarning(
    results: Map<string, { backorderedQuantity: number }>,
  ): string | undefined {
    const backorderedCount = [...results.values()].filter((r) => r.backorderedQuantity > 0).length;
    if (backorderedCount === 0) return undefined;
    return `在庫不足のため引当できなかった明細が${backorderedCount}件あります(バックオーダー)。在庫確保後、在庫一覧または受注画面から再引当を行ってください`;
  }

  // Item7残課題2-5: 与信警告と同じ非ブロッキングの事前チェック。実際の引当は行わず、
  // 「まず全体(全倉庫合算)で足りるか」→「倉庫内訳を指定している場合はその倉庫単体でも足りるか」を
  // 保存(新規作成/更新)・承認申請提出のいずれの時点でも、承認フラグのON/OFFに関わらず表示する
  private async buildStockPreviewWarning(c: Context, items: any[]): Promise<string | undefined> {
    const warehouseReservationRepo = new WarehouseStockReservationRepository(c.env.DB);
    const shortages = await previewStockShortage(warehouseReservationRepo, items);
    if (shortages.length === 0) return undefined;

    const parts = shortages.map((s) => {
      if (s.totalAvailable < s.requestedQuantity) {
        return `${s.itemId}(必要 ${s.requestedQuantity} / 全倉庫合計在庫 ${s.totalAvailable})`;
      }
      const detail = s.warehouseShortfalls
        .map((w) => `${w.warehouseId}: 必要 ${w.requested} / 在庫 ${w.available}`)
        .join(", ");
      return `${s.itemId}(指定倉庫の在庫が不足: ${detail})`;
    });
    return `在庫が不足している可能性がある明細があります: ${parts.join(" / ")}`;
  }

  constructor(repo: SalesOrderRepository) {
    this.repo = repo;
  }

  async searchOrders(c: Context, query: SearchOrdersQuery, sort?: SortQuery) {
    const result = await this.repo.findOrders(query, sort);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_SALES_ORDERS_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
        matchedOrderIds: result.map((o) => o.id),
      }),
    );

    return await this.attachFilesToOrders(result);
  }

  // Item9 Phase6: 欠品自動提案①(受注紐付け方式)。承認済み受注を横断した欠品明細のフラット一覧
  async getBackorderedItems(c: Context) {
    const result = await this.repo.findBackorderedItemsAcrossOrders();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_SALES_ORDERS_BACKORDERED_ITEMS", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        viewedRecordCount: result.length,
      }),
    );

    return result;
  }

  async searchOrdersPage(
    c: Context,
    query: SearchOrdersQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [result, total] = await Promise.all([
      this.repo.findOrdersPage(query, params, sort),
      this.repo.countOrders(query),
    ]);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_SALES_ORDERS_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
        matchedOrderIds: result.map((o) => o.id),
      }),
    );

    const data = await this.attachFilesToOrders(result);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  private async attachFilesToOrders(
    orders: Awaited<ReturnType<SalesOrderRepository["findOrders"]>>,
  ) {
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) return [];

    const allAttachments = await this.repo.findAttachmentsByOrderIds(orderIds);
    return orders.map((o) => ({
      ...o,
      attachments: allAttachments.filter((att) => att.salesOrderId === o.id),
    }));
  }

  async getOrderDetail(c: Context, id: string) {
    const header = await this.repo.findOrderById(id);
    if (!header) return null;

    const items = await this.repo.findOrderItems(id);
    const rawAttachments = await this.repo.findOrderAttachments(id);

    const baseUrl = new URL(c.req.url).origin;
    const attachments = rawAttachments.map((att) => {
      let downloadUrl = att.externalUrl || null;
      if (att.storageType === "R2" && att.attachmentR2Path) {
        downloadUrl = `${baseUrl}/api/sales-orders/download/${id}/${att.id}`;
      }
      return { ...att, downloadUrl };
    });

    return { ...header, items, attachments };
  }

  // Item7: 見積から作成する場合、body.itemsが未指定ならbody.sourceQuoteIdの見積明細から
  // 組み立てる(quoteItemSelections未指定=見積全体コピー、指定=選択行+数量のみコピー)。
  // body.itemsが指定されていればそちらを優先する(フロント側で組み立て済みのケース、白紙作成を含む)
  private async resolveItemsForCreate(body: SalesOrderPayload) {
    if (body.items && Array.isArray(body.items)) return body.items;
    if (!body.sourceQuoteId) return [];

    const quoteItems = await this.repo.findQuoteItemsForOrderCreation(body.sourceQuoteId);
    const selections = (body as any).quoteItemSelections as
      | Array<{ quoteItemId: string; quantity?: number }>
      | undefined;
    return buildSalesOrderItemsFromQuote(quoteItems, selections ?? null);
  }

  async createOrder(c: Context, formData: FormData, body: SalesOrderPayload) {
    await assertPartnerNotSuspended(c.env.DB, body.partnerId);
    // BUG-042: 保存する合計・消費税は、明細から計算し直す(会社設定の端数処理。画面の計算は表示用)
    body = await recalculateDocumentTotals(c.env.COMPANY_SETTINGS, body, await this.repo.findTaxCategoryRates());
    const opId = await this.repo.getFallbackOperatorId(c);
    let orderId = body.id;

    if (orderId) {
      const exists = await this.repo.existsOrder(orderId);
      if (exists) {
        let isUnique = false;
        let revNumber = 1;
        let baseId = orderId;
        const lastHyphenIndex = orderId.lastIndexOf("-");
        if (lastHyphenIndex !== -1) {
          const trailingPart = orderId.substring(lastHyphenIndex + 1);
          if (/^\d+$/.test(trailingPart)) {
            baseId = orderId.substring(0, lastHyphenIndex);
          }
        }
        while (!isUnique) {
          const checkId = `${baseId}-${revNumber}`;
          const dupCheck = await this.repo.existsOrder(checkId);
          if (!dupCheck) {
            orderId = checkId;
            isUnique = true;
          } else {
            revNumber++;
          }
        }
      }
    } else {
      orderId = await resolveConfiguredDocumentId(
        c,
        "sales_order",
        (id) => this.repo.existsOrder(id),
        null,
      );
    }

    const fallbackId = await this.repo.getFallbackOperatorId(c);

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.insertOrder({
      id: orderId,
      title: body.title || null,
      partnerId: body.partnerId || null,
      sourceQuoteId: body.sourceQuoteId || null,
      orderDate: new Date(body.orderDate),
      status: "DRAFT",
      totalAmount: body.totalAmount || 0,
      taxAmount: body.taxAmount || 0,
      memo: body.memo || null,
      terms: body.terms || null,
      salesPersonEmployeeNumber: body.salesPersonEmployeeNumber || null,
      // Item7残課題: 未指定時はログイン操作者(fallbackId)を入力担当者の既定値とする
      inputPersonEmployeeNumber: body.inputPersonEmployeeNumber || fallbackId,
      companyName: body.companyName || null,
      companyDepartment: body.companyDepartment || null,
      companyAddress: body.companyAddress || null,
      companyTel: body.companyTel || null,
      companyFax: body.companyFax || null,
      deliveryDate: body.deliveryDate || null,
      deliveryPlace: body.deliveryPlace || null,
      deliveryDestinationId: body.deliveryDestinationId || null,
      paymentTerms: body.paymentTerms || null,
      projectId: body.projectId || null,
      isPrepaid: body.isPrepaid || false,
      prepaidAt: body.prepaidAt ? new Date(body.prepaidAt) : null,
      createdBy: fallbackId,
      updatedBy: fallbackId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const items = await this.resolveItemsForCreate(body);
    for (const [index, item] of items.entries()) {
      await tx.repo.insertOrderItem(
        buildSalesOrderItemInsertRow(item as any, orderId, index),
      );
    }

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path = null;
        let extUrl = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (fileObj) {
            r2Path = generateAttachmentKey(`orders/${orderId}`, fileObj.name);
            await c.env.SALES_ORDERS_BUCKET.put(r2Path, fileObj.stream(), {
              httpMetadata: { contentType: fileObj.type },
            });
          }
        } else {
          extUrl = att.externalUrl || null;
        }

        await tx.repo.insertOrderAttachment({
          id: crypto.randomUUID(),
          salesOrderId: orderId,
          fileName: att.fileName,
          storageType: att.storageType,
          attachmentR2Path: r2Path,
          externalUrl: extUrl,
          fileType: att.fileType || "OTHER",
          uploadedById: opId,
          uploadedAt: new Date(),
        });
      }
    }
    await tx.commit();

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_SALES_ORDER", RESOURCE_KEY, orderId, null, {
        id: orderId,
        partnerId: body.partnerId,
        sourceQuoteId: body.sourceQuoteId,
        totalAmount: body.totalAmount,
      }),
    );

    const creditWarning = await this.buildCreditWarning(body.partnerId, body.totalAmount || 0);
    const stockWarning = await this.buildStockPreviewWarning(c, items);

    return {
      success: true,
      message: "受注情報を新規保存しました",
      id: orderId,
      warning: [creditWarning, stockWarning].filter(Boolean).join(" / ") || undefined,
    };
  }

  async updateOrder(
    c: Context,
    id: string,
    formData: FormData,
    body: SalesOrderPayload,
  ) {
    // BUG-042: 保存する合計・消費税は、明細から計算し直す(会社設定の端数処理。画面の計算は表示用)
    body = await recalculateDocumentTotals(c.env.COMPANY_SETTINGS, body, await this.repo.findTaxCategoryRates());
    const opId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findOrderById(id);

    if (oldSnapshot) {
      const wfEnabled = await isSalesOrderWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);
      if (wfEnabled) {
        if (
          oldSnapshot.status === "PENDING_APPROVAL" ||
          oldSnapshot.status === "PENDING_DELETION"
        ) {
          throw new BadRequestError("承認処理中の受注は編集できません");
        }
        if (oldSnapshot.status === "APPROVED") {
          throw new BadRequestError(
            "承認済みの受注を編集するには変更申請(/api/approvals/request-update)が必要です",
          );
        }
      }
    }

    const fallbackId = await this.repo.getFallbackOperatorId(c);
    // Item7残課題2-5フォローアップ2: 承認機能OFF時はAPPROVED済み受注もこのメソッドで直接編集できてしまう
    // (上のガードはwfEnabled時のみ)。その場合、明細を差し替えても在庫引当が再計算されないまま
    // 放置される不整合があったため、更新後の状態がAPPROVEDになる場合は引当を再実行する
    const resolvedStatus = body.status || oldSnapshot?.status || "DRAFT";

    // BUG-049: ここから commit() までの DB への書き込み(明細の削除に伴う引当の解放を含む)は記録だけして、1回の batch で書き込む
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.updateOrder(id, {
      title: body.title || null,
      partnerId: body.partnerId || null,
      sourceQuoteId: body.sourceQuoteId || oldSnapshot?.sourceQuoteId || null,
      orderDate: new Date(body.orderDate),
      status: resolvedStatus,
      totalAmount: body.totalAmount || 0,
      taxAmount: body.taxAmount || 0,
      memo: body.memo || null,
      terms: body.terms || null,
      salesPersonEmployeeNumber: body.salesPersonEmployeeNumber || null,
      inputPersonEmployeeNumber:
        body.inputPersonEmployeeNumber || oldSnapshot?.inputPersonEmployeeNumber || fallbackId,
      companyName: body.companyName || null,
      companyDepartment: body.companyDepartment || null,
      companyAddress: body.companyAddress || null,
      companyTel: body.companyTel || null,
      companyFax: body.companyFax || null,
      deliveryDate: body.deliveryDate || null,
      deliveryPlace: body.deliveryPlace || null,
      deliveryDestinationId: body.deliveryDestinationId || null,
      paymentTerms: body.paymentTerms || null,
      projectId: body.projectId ?? oldSnapshot?.projectId ?? null,
      isPrepaid: body.isPrepaid ?? oldSnapshot?.isPrepaid ?? false,
      prepaidAt: body.prepaidAt ? new Date(body.prepaidAt) : oldSnapshot?.prepaidAt || null,
      updatedBy: fallbackId,
      updatedAt: new Date(),
    });

    await tx.repo.deleteOrderItems(id);
    if (body.items && Array.isArray(body.items)) {
      for (const [index, item] of body.items.entries()) {
        await tx.repo.insertOrderItem(
          buildSalesOrderItemInsertRow(item as any, id, index),
        );
      }
    }

    const existingAttachments = await this.repo.findOrderAttachments(id);
    await tx.repo.deleteOrderAttachments(id);

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path = att.attachmentR2Path || null;
        let extUrl = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (fileObj) {
            r2Path = generateAttachmentKey(`orders/${id}`, fileObj.name);
            await c.env.SALES_ORDERS_BUCKET.put(r2Path, fileObj.stream(), {
              httpMetadata: { contentType: fileObj.type },
            });
          } else if (!r2Path) {
            const match = existingAttachments.find(
              (ea) => ea.fileName === att.fileName && ea.storageType === "R2",
            );
            if (match) r2Path = match.attachmentR2Path;
          }
        } else {
          extUrl = att.externalUrl || null;
        }

        if (r2Path || extUrl) {
          await tx.repo.insertOrderAttachment({
            id: crypto.randomUUID(),
            salesOrderId: id,
            fileName: att.fileName,
            storageType: att.storageType,
            attachmentR2Path: r2Path,
            externalUrl: extUrl,
            fileType: att.fileType || "OTHER",
            uploadedById: opId,
            uploadedAt: new Date(),
          });
        }
      }
    }

    await tx.repo.insertHistoryLog({
      id: crypto.randomUUID(),
      salesOrderId: id,
      version: 1,
      action: "UPDATE",
      snapshotData: JSON.stringify({
        header: {
          ...oldSnapshot,
          orderDate: oldSnapshot?.orderDate
            ? new Date(oldSnapshot.orderDate).toISOString()
            : null,
        },
        items: body.items,
      }),
      changedById: opId,
      changedAt: new Date(),
      comment: body.historyComment || "画面編集による更新",
    });
    await tx.commit();

    if (body.attachments && Array.isArray(body.attachments)) {
      await deleteOrphanedR2Attachments(
        c.env.SALES_ORDERS_BUCKET,
        existingAttachments,
        body.attachments.map((att: any) => att.attachmentR2Path),
        c.env.QUATES_BUCKET,
      );
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_SALES_ORDER", RESOURCE_KEY, id, oldSnapshot, {
        id,
        partnerId: body.partnerId,
        totalAmount: body.totalAmount,
      }),
    );

    const creditWarning = await this.buildCreditWarning(body.partnerId, body.totalAmount || 0, id);

    // Item7残課題2-5フォローアップ2: 更新後もAPPROVEDのままの場合(承認機能OFF時の直接編集)は
    // 明細差し替え後の実際の数量で在庫を再引当する(既存の引当はdeleteOrderItems内で解放済み)。
    // それ以外(DRAFT等、まだ実引当を行わない状態)は与信警告と同じ非破壊のプレビューに留める
    let stockWarning: string | undefined;
    if (resolvedStatus === "APPROVED") {
      const orderItems = await this.repo.findOrderItems(id);
      const warehouseReservationRepo = new WarehouseStockReservationRepository(c.env.DB);
      const reservationResults = await reserveOrderItemsWarehouseAware(
        warehouseReservationRepo,
        orderItems,
        new Date(),
      );
      for (const [orderItemId, result] of reservationResults) {
        await this.repo.updateOrderItemBackorder(orderItemId, result.backorderedQuantity);
      }
      stockWarning = this.buildBackorderWarning(reservationResults);
    } else {
      stockWarning = await this.buildStockPreviewWarning(c, (body.items as any[]) || []);
    }

    return {
      success: true,
      message: "受注情報を更新しました",
      warning: [creditWarning, stockWarning].filter(Boolean).join(" / ") || undefined,
    };
  }

  async deleteOrder(c: Context, id: string) {
    const oldSnapshot = await this.repo.findOrderById(id);
    if (oldSnapshot && oldSnapshot.status !== "DRAFT") {
      throw new BadRequestError("下書き以外の受注を削除するには削除申請が必要です");
    }
    return this.performOrderDeletion(c, id, oldSnapshot);
  }

  async performOrderDeletion(c: Context, id: string, knownSnapshot?: any) {
    const oldSnapshot = knownSnapshot ?? (await this.repo.findOrderById(id));
    const associatedAttachments = await this.repo.findOrderAttachments(id);

    // Item7残課題6: 出荷指示・出庫・売上計上の実績がこの受注の明細を参照している場合、
    // 削除するとDB側のFK制約(salesOrderItemId/sourceOrderItemId、onDelete指定なし)違反で
    // 例外になってしまうため、明細を消す前に検知して分かりやすいエラーで止める
    // (すでに出荷または売上計上が動いた受注は削除させない)
    const existingItems = await this.repo.findOrderItems(id);
    const hasDownstreamReferences = await this.repo.hasDownstreamItemReferences(
      existingItems.map((i: any) => i.id),
    );
    if (hasDownstreamReferences) {
      throw new BadRequestError(
        "この受注はすでに出荷指示・出庫の実績、または売上計上と紐づいているため削除できません",
      );
    }

    // Item7: 確定済み(APPROVED/PENDING_DELETION、=引当済み)の受注が削除される場合、
    // 保持していた在庫引当を解放する。DRAFT削除は引当自体が発生していないため対象外。
    // Item7残課題2-5: 倉庫単位引当のledger(sales_order_item_reservations)が存在すれば
    // この機能リリース後に新方式で引き当てられた受注と判定し、そちらを解放する。ledgerが
    // 無ければリリース前に承認済みだったレガシー受注と判定し、従来の品目単位カウンタを解放する
    // (この機能ではデータ移行を行わないため、受注ごとにどちらの方式かをledgerの有無で判別する)
    // BUG-049: 引当の解放と、明細・添付・受注の削除は1回の batch で書き込む(削除に失敗した時に、引当だけが解放されたままにならないように)
    const tx = recordWritesForBatch(this.repo);
    if (oldSnapshot && (oldSnapshot.status === "APPROVED" || oldSnapshot.status === "PENDING_DELETION")) {
      const warehouseReservationRepo = tx.include(new WarehouseStockReservationRepository(c.env.DB));
      const warehouseReservations = await warehouseReservationRepo.findReservationsByOrderItemIds(
        existingItems.map((i: any) => i.id),
      );
      if (warehouseReservations.length > 0) {
        await releaseOrderItemsWarehouseAware(warehouseReservationRepo, existingItems, new Date());
      } else {
        const stockReservationRepo = tx.include(new StockReservationRepository(c.env.DB));
        await releaseOrderItems(stockReservationRepo, existingItems, new Date());
      }
    }

    // 引当は上で(倉庫単位・品目単位のどちらかで)解放済みのため、明細の削除では解放しない。
    // 以前は明細の削除でも倉庫単位の引当をもう一度解放しており、他の受注の引当まで減っていた(BUG-049)
    await tx.repo.deleteOrderItems(id, { skipReservationRelease: true });
    await tx.repo.deleteOrderAttachments(id);
    await tx.repo.deleteOrder(id);
    await tx.commit();

    for (const att of associatedAttachments) {
      if (att.storageType === "R2" && att.attachmentR2Path) {
        try {
          await deleteFromPair({ primary: c.env.SALES_ORDERS_BUCKET, legacy: c.env.QUATES_BUCKET }, att.attachmentR2Path);
        } catch (r2Err) {
          console.error("R2 delete error during sales order removal:", r2Err);
        }
      }
    }
    // 差戻しで下書きに戻った伝票の場合、残っている差戻しの申請を閉じる(BUG-015)。
    // 直接削除・削除申請(下書きは直接削除)・承認不要時・削除の承認確定の、どの経路で消しても閉じる
    await WorkflowEngine.closeRemandedRequestsOfDeletedTarget(createDb(c.env.DB), "sales_orders", id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_SALES_ORDER", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return {
      success: true,
      message: "受注データおよび紐づくR2添付ファイルを完全に削除しました",
    };
  }

  // Item7: 受注の承認申請提出(DRAFT→PENDING_APPROVAL、承認機能OFFなら直接APPROVED)。
  // 与信確認は警告のみ(保存・確定自体はブロックしない)。承認ワークフローのON/OFFに
  // 関わらず常に実施する(ユーザー確認済み)
  async submitForApproval(
    c: Context,
    id: string,
    applicantDepartmentSurrogateId?: string | null,
  ) {
    const order = await this.repo.findOrderById(id);
    if (!order) throw new NotFoundError("対象の受注が見つかりません");
    if (order.status !== "DRAFT") {
      throw new BadRequestError("下書き状態の受注のみ承認申請できます");
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isSalesOrderWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);
    const creditWarning = await this.buildCreditWarning(order.partnerId, order.totalAmount || 0, id);

    if (!wfEnabled) {
      // Item7残課題2-5: 受注確定(APPROVED)時に倉庫単位で在庫を引き当てる。与信警告と同じ
      // 非ブロッキング方針に変更(以前は在庫不足時に400エラーで確定自体をブロックしていたが、
      // 一部倉庫・全倉庫で不足しても承認は通し、不足分をbackorderedQuantityとして記録する)
      const orderItems = await this.repo.findOrderItems(id);
      const warehouseReservationRepo = new WarehouseStockReservationRepository(c.env.DB);
      const reservationResults = await reserveOrderItemsWarehouseAware(
        warehouseReservationRepo,
        orderItems,
        new Date(),
      );
      for (const [orderItemId, result] of reservationResults) {
        await this.repo.updateOrderItemBackorder(orderItemId, result.backorderedQuantity);
      }
      const backorderWarning = this.buildBackorderWarning(reservationResults);

      await this.repo.updateOrder(id, {
        status: "APPROVED",
        updatedBy: employeeNumber,
        updatedAt: new Date(),
      });
      c.executionCtx.waitUntil(
        logAuditEvent(c, "APPROVE_SALES_ORDER_DIRECT", RESOURCE_KEY, id, order, {
          status: "APPROVED",
        }),
      );
      return {
        success: true,
        message: "承認機能が無効のため、受注を確定しました",
        warning: [creditWarning, backorderWarning].filter(Boolean).join(" / ") || undefined,
      };
    }

    // Item7残課題2-5フォローアップ6: 承認フローON時も、在庫は「早い者勝ち」で他の受注に
    // 先に消費されうる資源のため、与信確認(承認確定時でよい)とは異なり申請提出時点で確保する
    // (ユーザー確認済み)。明細行は既にDRAFTとしてDB上に実在するため、通常の引当処理と同じ関数を
    // そのまま使える(承認確定時には再度引当を行わない、二重引当になるため)
    const orderItems = await this.repo.findOrderItems(id);
    const warehouseReservationRepo = new WarehouseStockReservationRepository(c.env.DB);
    const reservationResults = await reserveOrderItemsWarehouseAware(
      warehouseReservationRepo,
      orderItems,
      new Date(),
    );
    for (const [orderItemId, result] of reservationResults) {
      await this.repo.updateOrderItemBackorder(orderItemId, result.backorderedQuantity);
    }
    const backorderWarning = this.buildBackorderWarning(reservationResults);

    await this.repo.updateOrder(id, {
      status: "PENDING_APPROVAL",
      updatedBy: employeeNumber,
      updatedAt: new Date(),
    });

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const db = createDb(c.env.DB);
    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: "sales_orders",
      targetId: id,
      applicantId: applicantUserId,
      requestType: "REGISTER",
      amount: order.totalAmount || 0,
      comment: `受注[${id}]の承認申請`,
      applicantDepartmentSurrogateId,
    }, c);

    if (!wfResult.success) {
      // 承認フロー開始に失敗した場合、直前に確保した引当を解放してからDRAFTへ戻す
      await releaseOrderItemsWarehouseAware(warehouseReservationRepo, orderItems, new Date());
      await this.repo.updateOrder(id, {
        status: "DRAFT",
        updatedBy: employeeNumber,
        updatedAt: new Date(),
      });
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `受注[${id}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_SALES_ORDER_FOR_APPROVAL", RESOURCE_KEY, id, order, {
        status: "PENDING_APPROVAL",
      }),
    );

    return {
      success: true,
      message: "受注の承認を申請しました",
      warning: [creditWarning, backorderWarning].filter(Boolean).join(" / ") || undefined,
    };
  }

  // Item7残課題2-5フォローアップ6: 承認済み受注への変更申請の提出(申請時点で在庫を確保する)。
  // 従来は汎用エンドポイント(/api/approvals/request-update)をフロントから直接呼んでいたが、
  // 在庫は早い者勝ちで他の受注に先に消費されうるため、submitForApprovalと同様このsales_orders
  // 固有のエンドポイントで在庫確保を行ってからWorkflowEngineへ渡す方式に変更した
  async submitUpdateForApproval(
    c: Context,
    id: string,
    body: {
      header: Record<string, any>;
      items: any[];
      comment?: string;
      applicantDepartmentSurrogateId?: string | null;
    },
  ) {
    const order = await this.repo.findOrderById(id);
    if (!order) throw new NotFoundError("対象の受注が見つかりません");
    if (order.status !== "APPROVED") {
      throw new BadRequestError("確定済みの受注のみ変更申請できます");
    }

    const db = createDb(c.env.DB);
    const activeRequest = await WorkflowTasksRepository.getActiveMasterApprovalRequest(
      db,
      id,
      "sales_orders",
    );
    if (activeRequest) {
      throw new BadRequestError(
        "既に申請済みの変更申請(または削除申請)があります。完了後に再度お試しください。",
      );
    }

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const oldItems = await this.repo.findOrderItems(id);
    const warehouseReservationRepo = new WarehouseStockReservationRepository(c.env.DB);
    const now = new Date();
    const newItems = Array.isArray(body.items) ? body.items : [];
    const reservationOutcome: PendingUpdateReservationOutcome = await adjustReservationForUpdateSubmission(
      warehouseReservationRepo,
      oldItems,
      newItems,
      now,
    );

    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: "sales_orders",
      targetId: id,
      applicantId: applicantUserId,
      requestType: "UPDATE",
      amount: Number(body.header?.totalAmount) || 0,
      comment: body.comment || `受注[${id}]の変更申請`,
      applicantDepartmentSurrogateId: body.applicantDepartmentSurrogateId,
      contextData: {
        generalMemo: JSON.stringify({ header: body.header, items: newItems, reservationOutcome }),
      },
    }, c);

    if (!wfResult.success) {
      // 承認フロー開始に失敗した場合、直前に確保した引当調整を元に戻す
      await revertPendingUpdateReservationOutcome(warehouseReservationRepo, reservationOutcome, oldItems, now);
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: body.comment || `受注[${id}]の変更申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "REQUEST_UPDATE_SALES_ORDER", RESOURCE_KEY, id, order, {
        requestId: wfResult.requestId,
      }),
    );

    const backorderedCount = reservationOutcome.items.filter((i) => i.backorderedQuantity > 0).length;
    const backorderWarning =
      backorderedCount > 0
        ? `在庫不足のため引当できなかった明細が${backorderedCount}件あります(バックオーダー)。在庫確保後、在庫一覧または受注画面から再引当を行ってください`
        : undefined;

    return {
      success: true,
      message: "受注の変更を申請しました",
      warning: backorderWarning,
    };
  }

  // Item7残課題2-5: バックオーダー(引当できなかった残数量)の手動再引当。
  // 入庫等で在庫が増えた後、在庫一覧/受注画面から呼ぶ。常に自動FIFO割当のみ行う
  async retryBackorder(c: Context, id: string) {
    const order = await this.repo.findOrderById(id);
    if (!order) throw new NotFoundError("対象の受注が見つかりません");
    if (order.status !== "APPROVED") {
      throw new BadRequestError("確定済みの受注のみ再引当を試みることができます");
    }

    const orderItems = await this.repo.findOrderItems(id);
    const backorderedItems = orderItems.filter((item: any) => (item.backorderedQuantity || 0) > 0);
    if (backorderedItems.length === 0) {
      return { success: true, message: "対象のバックオーダー(引当不足)はありません", resolvedCount: 0 };
    }

    const warehouseReservationRepo = new WarehouseStockReservationRepository(c.env.DB);
    const results = await retryBackorderedItems(warehouseReservationRepo, backorderedItems, new Date());

    let resolvedCount = 0;
    let stillBackorderedCount = 0;
    for (const item of backorderedItems) {
      const result = results.get(item.id);
      const reservedNow = result ? result.reservations.reduce((sum, r) => sum + r.quantity, 0) : 0;
      const newBackorder = Math.max((item.backorderedQuantity || 0) - reservedNow, 0);
      await this.repo.updateOrderItemBackorder(item.id, newBackorder);
      if (newBackorder <= 0) resolvedCount++;
      else stillBackorderedCount++;
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "RETRY_BACKORDER_SALES_ORDER", RESOURCE_KEY, id, null, {
        resolvedCount,
        stillBackorderedCount,
      }),
    );

    return {
      success: true,
      message:
        stillBackorderedCount === 0
          ? `バックオーダーをすべて解消しました(${resolvedCount}件)`
          : `一部のバックオーダーを解消しました(解消: ${resolvedCount}件 / 未解消: ${stillBackorderedCount}件)`,
      resolvedCount,
      stillBackorderedCount,
    };
  }

  // Item7残課題2-5(#4): 在庫一覧画面から、品目の引当元受注をトレースする
  async getOrderReservationsForItem(itemId: string) {
    return this.repo.findOrderReservationsByItemId(itemId);
  }

  // BUG-059: 見積から受注を作成する画面用。見積明細ごとの受注済み数量・残数量を返す
  // (分割受注は認めるため、残数量を超える受注も妨げない。画面で二重受注に気づけるようにするための表示用)
  async getQuoteOrderProgress(quoteId: string) {
    const quote = await this.repo.findQuoteForOrderCreation(quoteId);
    if (!quote) throw new NotFoundError("対象の見積が見つかりません");
    const quoteItems = await this.repo.findQuoteItemsForOrderCreation(quoteId);
    const ordered = await this.repo.getOrderedQuantitiesByQuoteItemIds(quoteItems.map((i) => i.id));
    return quoteItems.map((item) => {
      const orderedQuantity = ordered.get(item.id) ?? 0;
      return {
        quoteItemId: item.id,
        quantity: item.quantity,
        orderedQuantity,
        remainingQuantity: Math.max(item.quantity - orderedQuantity, 0),
      };
    });
  }

  async requestOrderDeletion(c: Context, id: string) {
    const order = await this.repo.findOrderById(id);
    if (!order) throw new NotFoundError("対象の受注が見つかりません");

    if (order.status === "DRAFT") {
      return this.performOrderDeletion(c, id, order);
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isSalesOrderWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      return this.performOrderDeletion(c, id, order);
    }

    if (order.status !== "APPROVED") {
      throw new BadRequestError(
        "承認処理中の受注は削除申請できません。処理完了後に再度お試しください。",
      );
    }

    await this.repo.updateOrder(id, {
      status: "PENDING_DELETION",
      updatedBy: employeeNumber,
      updatedAt: new Date(),
    });

    const session = await getSession(c);
    const applicantUserId = session?.userId;
    if (!applicantUserId) {
      throw new BadRequestError("認証情報が確認できません");
    }

    const db = createDb(c.env.DB);
    const wfResult = await WorkflowEngine.startWorkflow(db, {
      targetType: "sales_orders",
      targetId: id,
      applicantId: applicantUserId,
      requestType: "DELETE",
      amount: order.totalAmount || 0,
      comment: `受注[${id}]の削除申請`,
    }, c);

    if (!wfResult.success) {
      await this.repo.updateOrder(id, {
        status: "APPROVED",
        updatedBy: employeeNumber,
        updatedAt: new Date(),
      });
      throw new BadRequestError(wfResult.message);
    }

    await notifyApprovalRequestSubmitted({
      c,
      requestId: wfResult.requestId!,
      approverEmails: wfResult.approverEmails || [],
      comment: `受注[${id}]の削除申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_SALES_ORDER_DELETION", RESOURCE_KEY, id, order, {
        status: "PENDING_DELETION",
      }),
    );

    return { success: true, message: "受注の削除を申請しました" };
  }
}
