import { Context } from "hono";
import { PurchaseOrderRepository } from "./purchase-order.repository";
import { PurchaseOrderPayload, UpdateDeliveryDatesInput } from "./purchase-order.schema";
import {
  reflectAnsweredDeliveryDatesToSalesOrders,
  formatReflectionMessage,
} from "./purchase-order-delivery-date.service";
import { RESOURCE_KEY } from "./purchase-order-constants";
import {
  PurchaseOrderItemInput,
  buildPurchaseOrderItemInsertRow,
  buildPurchaseOrderItemsFromRequisition,
} from "./purchase-order-item-mapper";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { deleteOrphanedR2Attachments } from "../../../platform/r2/delete-orphaned-attachments";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { NotFoundError, BadRequestError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { getDocumentNumberFormatConfig } from "../../../platform/id/resolve-document-id";
import { generateFormattedCode } from "../../../platform/id/generate-short-code";
import { WorkflowEngine } from "../../../workflow-engine/engine";
import { notifyApprovalRequestSubmitted } from "../../../workflow-engine/notifier";
import { isPurchaseOrderWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { getSession } from "../../../platform/auth/get-session";
import { createDb } from "../../../platform/db/create-db";
import { SearchOrdersQuery } from "./purchase-order.schema";
import { computeDocumentTotals } from "../../../platform/report-templates/compute-quote-amount-breakdown";
import { SortQuery } from "../../../platform/http/sort";
import { DEFAULT_TAX_ROUNDING_MODE, type TaxRoundingMode } from "../../../platform/tax/compute-tax-amounts";
import { getTaxRoundingMode } from "../../../platform/tax/get-tax-rounding-mode";
import { recordWritesForBatch } from "../../../platform/repository/record-writes-for-batch";
import { assertPartnerNotSuspended } from "../../../platform/partners/suspended-partner";

// purchase-requisition-crud.service.tsと同じ方針(検索・詳細取得・CRUD・承認申請/削除申請の状態遷移)。
// ファイル構成はsales-order-crud.service.tsをテンプレートにしつつ、発注に存在しない概念
// (与信確認・倉庫単位在庫引当・バックオーダー)は移植しない
async function calcAmounts(
  repo: PurchaseOrderRepository,
  items: PurchaseOrderPayload["items"],
  fallbackTotal?: number | null,
  fallbackTax?: number | null,
  roundingMode: TaxRoundingMode = DEFAULT_TAX_ROUNDING_MODE,
): Promise<{ totalAmount: number; taxAmount: number }> {
  if (!items || items.length === 0) {
    return { totalAmount: fallbackTotal || 0, taxAmount: fallbackTax || 0 };
  }
  const taxCategoryRates = await repo.findTaxCategoryRates();
  const breakdownItems = items.map((item) => ({
    amount: Number(item.quantity) * Number(item.unitPrice),
    taxCategoryCode: item.taxCategoryCode || null,
  }));
  return computeDocumentTotals(breakdownItems, taxCategoryRates, roundingMode);
}

export class PurchaseOrderCrudService {
  private repo: PurchaseOrderRepository;

  constructor(repo: PurchaseOrderRepository) {
    this.repo = repo;
  }

  async searchOrders(c: Context, query: SearchOrdersQuery, sort?: SortQuery) {
    const result = await this.repo.findOrders(query, sort);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SEARCH_PURCHASE_ORDERS_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
      }),
    );

    return await this.attachFilesToOrders(result);
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
      logAuditEvent(c, "SEARCH_PURCHASE_ORDERS_LIST", RESOURCE_KEY, "SEARCH_OPERATION", null, {
        searchConditions: { ...query },
        viewedRecordCount: result.length,
      }),
    );

    const data = await this.attachFilesToOrders(result);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  private async attachFilesToOrders(
    orders: Awaited<ReturnType<PurchaseOrderRepository["findOrders"]>>,
  ) {
    const ids = orders.map((o) => o.id);
    if (ids.length === 0) return [];

    const allAttachments = await this.repo.findAttachmentsByOrderIds(ids);
    return orders.map((o) => ({
      ...o,
      attachments: allAttachments.filter((att) => att.orderId === o.id),
    }));
  }

  async getOrderDetail(c: Context, id: string) {
    const header = await this.repo.findOrderById(id);
    if (!header) return null;

    const items = await this.repo.findOrderItems(id);
    const rawAttachments = await this.repo.findOrderAttachments(id);

    const baseUrl = new URL(c.req.url).origin;
    const attachments = rawAttachments.map((att) => ({
      ...att,
      downloadUrl:
        att.externalUrl ||
        (att.storageType === "R2" && att.attachmentR2Path
          ? `${baseUrl}/api/purchase-orders/download/${id}/${att.id}`
          : null),
    }));

    return { ...header, items, attachments };
  }

  // Item9 Phase5: 購買申請から発注を作成する場合、body.itemsが未指定ならbody.requestIdの
  // 購買申請明細から組み立てる(requisitionItemSelections未指定=購買申請全体コピー、
  // 指定=選択行+数量のみコピー)。body.itemsが指定されていればそちらを優先する
  // (フロント側で組み立て済みのケース、白紙作成を含む)
  private async resolveItemsForCreate(body: PurchaseOrderPayload) {
    if (body.items && Array.isArray(body.items)) return body.items;
    if (!body.requestId) return [];

    const requisitionItems = await this.repo.findRequisitionItemsForOrderCreation(
      body.requestId,
    );
    const selections = (body as any).requisitionItemSelections as
      | Array<{ requisitionItemId: string; quantity?: number }>
      | undefined;
    return buildPurchaseOrderItemsFromRequisition(requisitionItems as any, selections ?? null);
  }

  // Item9設計確定: 承認機能ON時は「発注は購買申請を経由しないと作成できない」。
  // requestIdが指定されている場合は常に参照先がAPPROVED状態であることを検証する
  // (承認OFF時のrequestIdなし直接起票は許可、requestId指定時はON/OFF問わず参照整合性を保つ)
  private async validateRequestReference(c: Context, body: PurchaseOrderPayload) {
    const wfEnabled = await isPurchaseOrderWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!body.requestId) {
      if (wfEnabled) {
        throw new BadRequestError(
          "承認機能が有効な場合、発注は承認済みの購買申請を選択して作成する必要があります",
        );
      }
      return;
    }

    const requisition = await this.repo.findRequisitionForOrderCreation(body.requestId);
    if (!requisition) {
      throw new BadRequestError("参照先の購買申請が見つかりません");
    }
    if (requisition.status !== "APPROVED") {
      throw new BadRequestError(
        "参照先の購買申請が承認済みではないため、発注を作成できません",
      );
    }
  }

  async createOrder(c: Context, formData: FormData, body: PurchaseOrderPayload) {
    await assertPartnerNotSuspended(c.env.DB, body.partnerId);
    const opId = await this.repo.getFallbackOperatorId(c);

    await this.validateRequestReference(c, body);

    let orderId = body.id;
    if (!orderId) {
      const config = await getDocumentNumberFormatConfig(c, "purchase_order");
      orderId = generateFormattedCode(config);
    }
    if (await this.repo.existsOrder(orderId)) {
      throw new BadRequestError("同一IDの発注が既に存在します");
    }

    const { totalAmount, taxAmount } = await calcAmounts(
      this.repo,
      body.items,
      body.totalAmount,
      body.taxAmount,
      await getTaxRoundingMode(c.env.COMPANY_SETTINGS),
    );

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.insertOrder({
      id: orderId,
      requestId: body.requestId || null,
      title: body.title || null,
      partnerId: body.partnerId || null,
      orderDate: new Date(body.orderDate),
      status: "DRAFT",
      projectId: body.projectId || null,
      totalAmount,
      taxAmount,
      memo: body.memo || null,
      companyName: body.companyName || null,
      companyDepartment: body.companyDepartment || null,
      companyAddress: body.companyAddress || null,
      companyTel: body.companyTel || null,
      companyFax: body.companyFax || null,
      deliveryDate: body.deliveryDate || null,
      deliveryPlace: body.deliveryPlace || null,
      deliveryLocationId: body.deliveryLocationId || null,
      deliveryWarehouseId: body.deliveryWarehouseId || null,
      paymentTerms: body.paymentTerms || null,
      purchasePersonEmployeeNumber: body.purchasePersonEmployeeNumber || opId,
      inputPersonEmployeeNumber: body.inputPersonEmployeeNumber || opId,
      isPaid: body.isPaid || false,
      paidAt: body.paidAt ? new Date(body.paidAt) : null,
      createdBy: opId,
      updatedBy: opId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const items = await this.resolveItemsForCreate(body);
    for (const [index, item] of items.entries()) {
      await tx.repo.insertOrderItem(
        buildPurchaseOrderItemInsertRow(item as any, orderId, index),
      );
    }

    if (body.attachments && Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        let r2Path: string | null = null;
        let extUrl: string | null = null;

        if (att.storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (!fileObj) continue;
          r2Path = generateAttachmentKey(`purchase-orders/${orderId}`, fileObj.name);
          await c.env.PURCHASE_ORDERS_BUCKET.put(r2Path, fileObj.stream(), {
            httpMetadata: { contentType: fileObj.type },
          });
        } else {
          extUrl = att.externalUrl || null;
        }

        await tx.repo.insertOrderAttachment({
          id: crypto.randomUUID(),
          orderId,
          orderItemId: null,
          fileName: att.fileName,
          storageType: att.storageType || "R2",
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
      logAuditEvent(c, "CREATE_PURCHASE_ORDER", RESOURCE_KEY, orderId, null, {
        id: orderId,
        partnerId: body.partnerId,
        requestId: body.requestId,
        totalAmount,
      }),
    );

    const reflectionMessage = formatReflectionMessage(
      await reflectAnsweredDeliveryDatesToSalesOrders(
        createDb(c.env.DB),
        orderId,
        body.deliveryDateReflection,
        opId,
      ),
    );

    return {
      success: true,
      message: ["発注情報を新規保存しました", reflectionMessage].filter(Boolean).join(" / "),
      id: orderId,
    };
  }

  async updateOrder(c: Context, id: string, formData: FormData, body: PurchaseOrderPayload) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const oldSnapshot = await this.repo.findOrderById(id);
    if (!oldSnapshot) throw new NotFoundError("対象の発注が見つかりません");

    const wfEnabled = await isPurchaseOrderWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);
    if (wfEnabled) {
      if (oldSnapshot.status === "PENDING_APPROVAL" || oldSnapshot.status === "PENDING_DELETION") {
        throw new BadRequestError("承認処理中の発注は編集できません");
      }
      if (oldSnapshot.status === "APPROVED") {
        throw new BadRequestError(
          "承認済みの発注を編集するには変更申請(/api/approvals/request-update)が必要です",
        );
      }
    }

    const { totalAmount, taxAmount } = await calcAmounts(
      this.repo,
      body.items,
      body.totalAmount,
      body.taxAmount,
      await getTaxRoundingMode(c.env.COMPANY_SETTINGS),
    );

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.updateOrder(id, {
      requestId: body.requestId || oldSnapshot.requestId || null,
      title: body.title || null,
      partnerId: body.partnerId || null,
      orderDate: new Date(body.orderDate),
      status: oldSnapshot.status,
      projectId: body.projectId || null,
      totalAmount,
      taxAmount,
      memo: body.memo || null,
      companyName: body.companyName || null,
      companyDepartment: body.companyDepartment || null,
      companyAddress: body.companyAddress || null,
      companyTel: body.companyTel || null,
      companyFax: body.companyFax || null,
      deliveryDate: body.deliveryDate || null,
      deliveryPlace: body.deliveryPlace || null,
      deliveryLocationId: body.deliveryLocationId || null,
      deliveryWarehouseId: body.deliveryWarehouseId || null,
      paymentTerms: body.paymentTerms || null,
      purchasePersonEmployeeNumber:
        body.purchasePersonEmployeeNumber || oldSnapshot.purchasePersonEmployeeNumber || opId,
      inputPersonEmployeeNumber:
        body.inputPersonEmployeeNumber || oldSnapshot.inputPersonEmployeeNumber || opId,
      isPaid: body.isPaid ?? oldSnapshot.isPaid,
      paidAt: body.paidAt ? new Date(body.paidAt) : oldSnapshot.paidAt,
      updatedBy: opId,
      updatedAt: new Date(),
    });

    // 2026-10-18: 明細IDを保ったまま、保存内容に合わせて明細を更新・追加・削除する(以前は全件削除して入れ直して
    // いたため、入庫・仕入から参照されている発注を保存するとFK制約違反になっていた)。参照されている明細を
    // 削除しようとした場合は400で、commit() しないので何も書き込まれない
    const syncedRows = await this.repo.buildSyncedItemRows(
      id,
      Array.isArray(body.items) ? (body.items as Array<PurchaseOrderItemInput & { id?: string | null }>) : [],
    );
    for (const write of await tx.repo.buildItemSyncWrites(id, syncedRows)) {
      await write;
    }

    const existingAttachments = await this.repo.findOrderAttachments(id);

    // 2026-10-18: 添付も既存の行を保ったまま保存する。以前は全件削除して入れ直していたため、保存のたびに
    // 添付IDが変わり(取引先へメールしたダウンロードリンクが無効になる)、画面が種類を送らないため発注書PDFの
    // 種類(PDF)が「その他」に変わり、登録者・登録日時・明細とのつながり(orderItemId)も失われていた。
    // 保存内容の添付は id → R2のパス → 共有リンク/ファイル名 の順で既存の行と対応付け、対応した行はIDなどを
    // 保ったまま名前・リンク(新しいファイルを選んだ場合はファイル)だけ更新、対応しない行は追加、
    // 保存内容に無い既存の行は削除する。attachments が送られない場合は添付を変えない
    // 保存後に残る添付のR2パス(下の不要ファイル削除の判定に使う)
    const keptR2Paths: Array<string | null> = [];
    if (body.attachments && Array.isArray(body.attachments)) {
      const unmatched = new Map(existingAttachments.map((ea) => [ea.id, ea]));
      const takeMatch = (predicate: (ea: (typeof existingAttachments)[number]) => boolean) => {
        for (const ea of unmatched.values()) {
          if (predicate(ea)) {
            unmatched.delete(ea.id);
            return ea;
          }
        }
        return null;
      };

      for (const att of body.attachments as Array<(typeof body.attachments)[number] & { id?: string | null }>) {
        const storageType = att.storageType || "R2";
        const existing =
          (att.id ? takeMatch((ea) => ea.id === att.id) : null) ??
          (storageType === "R2" && att.attachmentR2Path
            ? takeMatch((ea) => ea.storageType === "R2" && ea.attachmentR2Path === att.attachmentR2Path)
            : null) ??
          (storageType !== "R2"
            ? takeMatch(
                (ea) =>
                  ea.storageType === storageType &&
                  ea.externalUrl === (att.externalUrl || null) &&
                  ea.fileName === att.fileName,
              )
            : null) ??
          (storageType === "R2" && !att.attachmentR2Path
            ? takeMatch((ea) => ea.storageType === "R2" && ea.fileName === att.fileName)
            : null);

        let r2Path = existing?.attachmentR2Path ?? att.attachmentR2Path ?? null;
        let extUrl: string | null = null;
        let isNewUpload = false;

        if (storageType === "R2") {
          const fileObj = formData.get(`files[${att.fileName}]`) as File;
          if (fileObj) {
            r2Path = generateAttachmentKey(`purchase-orders/${id}`, fileObj.name);
            await c.env.PURCHASE_ORDERS_BUCKET.put(r2Path, fileObj.stream(), {
              httpMetadata: { contentType: fileObj.type },
            });
            isNewUpload = true;
          }
        } else {
          extUrl = att.externalUrl || null;
        }

        if (storageType === "R2" && (existing || r2Path)) keptR2Paths.push(r2Path);
        if (existing) {
          await tx.repo.updateOrderAttachment(existing.id, {
            fileName: att.fileName,
            attachmentR2Path: storageType === "R2" ? r2Path : null,
            externalUrl: extUrl,
            fileType: att.fileType || existing.fileType,
            ...(isNewUpload ? { uploadedById: opId, uploadedAt: new Date() } : {}),
          });
        } else if (r2Path || extUrl) {
          await tx.repo.insertOrderAttachment({
            id: crypto.randomUUID(),
            orderId: id,
            orderItemId: null,
            fileName: att.fileName,
            storageType,
            attachmentR2Path: r2Path,
            externalUrl: extUrl,
            fileType: att.fileType || "OTHER",
            uploadedById: opId,
            uploadedAt: new Date(),
          });
        }
      }

      if (unmatched.size > 0) {
        await tx.repo.deleteOrderAttachmentsByIds([...unmatched.keys()]);
      }
    }
    await tx.commit();

    if (body.attachments && Array.isArray(body.attachments)) {
      await deleteOrphanedR2Attachments(c.env.PURCHASE_ORDERS_BUCKET, existingAttachments, keptR2Paths);
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_PURCHASE_ORDER", RESOURCE_KEY, id, oldSnapshot, {
        id,
        partnerId: body.partnerId,
        totalAmount,
      }),
    );

    const reflectionMessage = formatReflectionMessage(
      await reflectAnsweredDeliveryDatesToSalesOrders(
        createDb(c.env.DB),
        id,
        body.deliveryDateReflection,
        opId,
      ),
    );

    return {
      success: true,
      message: ["発注情報を更新しました", reflectionMessage].filter(Boolean).join(" / "),
    };
  }

  // 新規要望(2026-10-18): 明細の希望納期・回答納期のみを更新する。納期は仕入先からの回答で
  // 承認後に変わるのが通常のため、承認済みでも変更申請なしで更新できる(ユーザー確認済み)。
  // 金額・数量等は対象外(従来どおり変更申請が必要)。承認処理中は、承認確定時に申請内容の明細で
  // 置き換わり今回の更新が失われるため受け付けない
  async updateDeliveryDates(c: Context, id: string, body: UpdateDeliveryDatesInput) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const order = await this.repo.findOrderById(id);
    if (!order) throw new NotFoundError("対象の発注が見つかりません");
    if (order.status === "PENDING_APPROVAL" || order.status === "PENDING_DELETION") {
      throw new BadRequestError("承認処理中の発注は納期を更新できません");
    }

    const currentItems = await this.repo.findOrderItems(id);
    const currentById = new Map(currentItems.map((it) => [it.id, it]));
    const changes: Array<{
      id: string;
      before: { requestedDeliveryDate: string | null; answeredDeliveryDate: string | null };
      after: { requestedDeliveryDate: string | null; answeredDeliveryDate: string | null };
    }> = [];
    for (const input of body.items) {
      const current = currentById.get(input.id);
      if (!current) {
        throw new BadRequestError(`この発注に存在しない明細が指定されました(${input.id})`);
      }
      const next = {
        requestedDeliveryDate: input.requestedDeliveryDate || null,
        answeredDeliveryDate: input.answeredDeliveryDate || null,
      };
      if (
        next.requestedDeliveryDate === current.requestedDeliveryDate &&
        next.answeredDeliveryDate === current.answeredDeliveryDate
      ) {
        continue;
      }
      changes.push({
        id: input.id,
        before: {
          requestedDeliveryDate: current.requestedDeliveryDate,
          answeredDeliveryDate: current.answeredDeliveryDate,
        },
        after: next,
      });
    }

    if (changes.length > 0) {
      await this.repo.updateOrderItemDeliveryDates(
        changes.map((ch) => ({ id: ch.id, ...ch.after })),
      );
      c.executionCtx.waitUntil(
        logAuditEvent(c, "UPDATE_PURCHASE_ORDER_DELIVERY_DATES", RESOURCE_KEY, id, null, {
          changes,
        }),
      );
    }

    // 回答納期に変更が無くても、反映指定があれば受注側へ反映する(以前反映し忘れた場合のやり直し用)
    const reflectionMessage = formatReflectionMessage(
      await reflectAnsweredDeliveryDatesToSalesOrders(
        createDb(c.env.DB),
        id,
        body.deliveryDateReflection,
        opId,
      ),
    );

    return {
      success: true,
      message: [
        changes.length > 0 ? `明細${changes.length}行の納期を更新しました` : "納期に変更はありませんでした",
        reflectionMessage,
      ]
        .filter(Boolean)
        .join(" / "),
    };
  }

  // 発注の削除(直接削除。下書き(DRAFT)のみ許可。それ以外はrequestOrderDeletion経由の削除申請が必要)
  async deleteOrder(c: Context, id: string) {
    const oldSnapshot = await this.repo.findOrderById(id);
    if (oldSnapshot && oldSnapshot.status !== "DRAFT") {
      throw new BadRequestError("下書き以外の発注を削除するには削除申請が必要です");
    }
    return this.performOrderDeletion(c, id, oldSnapshot);
  }

  // 発注の物理削除本体(R2添付削除込み)。ステータスによるガードは行わない。
  // deleteOrder(直接削除)・requestOrderDeletion(承認不要時)・
  // purchase-orders.adapter.ts(DELETE承認確定時)から呼ばれる
  async performOrderDeletion(c: Context, id: string, knownSnapshot?: any) {
    const oldSnapshot = knownSnapshot ?? (await this.repo.findOrderById(id));
    const associatedAttachments = await this.repo.findOrderAttachments(id);

    for (const att of associatedAttachments) {
      if (att.attachmentR2Path) {
        try {
          await c.env.PURCHASE_ORDERS_BUCKET.delete(att.attachmentR2Path);
        } catch (r2Err) {
          console.error("R2 delete error during purchase order removal:", r2Err);
        }
      }
    }

    // BUG-049: ここから commit() までの DB への書き込みは記録だけして、1回の batch で書き込む(途中で失敗した時に半端に残らないように)
    const tx = recordWritesForBatch(this.repo);
    await tx.repo.deleteOrderItems(id);
    await tx.repo.deleteOrderAttachments(id);
    await tx.repo.deleteOrder(id);
    await tx.commit();
    // 差戻しで下書きに戻った伝票の場合、残っている差戻しの申請を閉じる(BUG-015)。
    // 直接削除・削除申請(下書きは直接削除)・承認不要時・削除の承認確定の、どの経路で消しても閉じる
    await WorkflowEngine.closeRemandedRequestsOfDeletedTarget(createDb(c.env.DB), "purchase_orders", id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_PURCHASE_ORDER", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return {
      success: true,
      message: "発注データおよび紐づくR2添付ファイルを完全に削除しました",
    };
  }

  // 発注の承認申請提出(DRAFT→PENDING_APPROVAL、承認機能OFFなら直接APPROVED)
  async submitForApproval(c: Context, id: string, applicantDepartmentSurrogateId?: string | null) {
    const order = await this.repo.findOrderById(id);
    if (!order) throw new NotFoundError("対象の発注が見つかりません");
    if (order.status !== "DRAFT") {
      throw new BadRequestError("下書き状態の発注のみ承認申請できます");
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isPurchaseOrderWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      await this.repo.updateOrder(id, {
        status: "APPROVED",
        updatedBy: employeeNumber,
        updatedAt: new Date(),
      });
      c.executionCtx.waitUntil(
        logAuditEvent(c, "APPROVE_PURCHASE_ORDER_DIRECT", RESOURCE_KEY, id, order, {
          status: "APPROVED",
        }),
      );
      return { success: true, message: "承認機能が無効のため、発注を確定しました" };
    }

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
    const wfResult = await WorkflowEngine.startWorkflow(
      db,
      {
        targetType: "purchase_orders",
        targetId: id,
        applicantId: applicantUserId,
        requestType: "REGISTER",
        amount: order.totalAmount || 0,
        comment: `発注[${id}]の承認申請`,
        applicantDepartmentSurrogateId,
      },
      c,
    );

    if (!wfResult.success) {
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
      comment: `発注[${id}]の承認申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_PURCHASE_ORDER_FOR_APPROVAL", RESOURCE_KEY, id, order, {
        status: "PENDING_APPROVAL",
      }),
    );

    return { success: true, message: "発注の承認を申請しました" };
  }

  // 発注の削除申請(DRAFTかつ未申請なら承認不要で直接削除、APPROVEDなら削除承認申請)
  async requestOrderDeletion(c: Context, id: string) {
    const order = await this.repo.findOrderById(id);
    if (!order) throw new NotFoundError("対象の発注が見つかりません");

    if (order.status === "DRAFT") {
      return this.performOrderDeletion(c, id, order);
    }

    const employeeNumber = await this.repo.getFallbackOperatorId(c);
    const wfEnabled = await isPurchaseOrderWorkflowGloballyEnabled(c.env.COMPANY_SETTINGS);

    if (!wfEnabled) {
      return this.performOrderDeletion(c, id, order);
    }

    if (order.status !== "APPROVED") {
      throw new BadRequestError(
        "承認処理中の発注は削除申請できません。処理完了後に再度お試しください。",
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
    const wfResult = await WorkflowEngine.startWorkflow(
      db,
      {
        targetType: "purchase_orders",
        targetId: id,
        applicantId: applicantUserId,
        requestType: "DELETE",
        amount: order.totalAmount || 0,
        comment: `発注[${id}]の削除申請`,
      },
      c,
    );

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
      comment: `発注[${id}]の削除申請`,
      performedById: applicantUserId,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUBMIT_PURCHASE_ORDER_DELETION", RESOURCE_KEY, id, order, {
        status: "PENDING_DELETION",
      }),
    );

    return { success: true, message: "発注の削除を申請しました" };
  }
}
