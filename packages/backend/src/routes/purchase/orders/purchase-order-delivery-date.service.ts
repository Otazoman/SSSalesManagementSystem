// 新規要望(2026-10-18): 発注明細の回答納期を、紐づく受注明細の納期(sales_order_items.delivery_date)へ
// 反映する共通ロジック。発注の新規作成・直接編集・変更申請の承認確定・納期のみ更新APIの4箇所から呼ぶ。
// - 受注明細との紐付けは order_items.sales_order_item_id、無ければ購買申請明細
//   (purchase_request_items.sales_order_item_id)経由で辿る
// - 1つの受注明細に複数の発注明細が紐づく(分納等)場合は、その全ての回答納期のうち最も遅い日付を使う
// - 受注のステータス(承認済みを含む)に関わらず、受注明細の納期列のみを直接更新し履歴ログへ記録する
//   (受注の変更申請・在庫の再引当は発生させない。ユーザー確認済み)
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import * as schema from "../../../db/schema";
import type { AppDb } from "../../../platform/db/create-db";
import type { DeliveryDateReflection } from "./purchase-order.schema";

export interface DeliveryDateReflectionResult {
  updatedItemCount: number;
  salesOrderIds: string[];
}

// YYYY-MM-DD に暦日でdays日を加算する(タイムゾーンの影響を受けないようUTCで計算する)
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

// 反映方法に従って、回答納期から受注明細へ書き込む納期を求める
export function computeReflectedDeliveryDate(
  answeredDate: string,
  reflection: DeliveryDateReflection,
): string {
  if (reflection.mode === "ADD_DAYS") {
    return addDaysToIsoDate(answeredDate, reflection.addDays ?? 0);
  }
  return answeredDate;
}

function isReflectionEnabled(
  reflection: DeliveryDateReflection | null | undefined,
): reflection is DeliveryDateReflection {
  return !!reflection && (reflection.mode === "SAME" || reflection.mode === "ADD_DAYS");
}

export async function reflectAnsweredDeliveryDatesToSalesOrders(
  db: AppDb,
  orderId: string,
  reflection: DeliveryDateReflection | null | undefined,
  operatorEmployeeNumber: string,
): Promise<DeliveryDateReflectionResult> {
  const empty: DeliveryDateReflectionResult = { updatedItemCount: 0, salesOrderIds: [] };
  if (!isReflectionEnabled(reflection)) return empty;

  // 1. この発注の明細から、紐づく受注明細IDを求める
  const poItems = await db
    .select({
      salesOrderItemId: schema.orderItems.salesOrderItemId,
      purchaseRequestItemId: schema.orderItems.purchaseRequestItemId,
    })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId));

  const requestItemIds = poItems
    .filter((it) => !it.salesOrderItemId && it.purchaseRequestItemId)
    .map((it) => it.purchaseRequestItemId as string);
  const requestItemLinks =
    requestItemIds.length > 0
      ? await db
          .select({
            id: schema.purchaseRequestItems.id,
            salesOrderItemId: schema.purchaseRequestItems.salesOrderItemId,
          })
          .from(schema.purchaseRequestItems)
          .where(inArray(schema.purchaseRequestItems.id, requestItemIds))
      : [];
  const soItemIdByRequestItemId = new Map(requestItemLinks.map((r) => [r.id, r.salesOrderItemId]));

  const targetSoItemIds = new Set<string>();
  for (const it of poItems) {
    const soItemId =
      it.salesOrderItemId ||
      (it.purchaseRequestItemId ? soItemIdByRequestItemId.get(it.purchaseRequestItemId) : null);
    if (soItemId) targetSoItemIds.add(soItemId);
  }
  if (targetSoItemIds.size === 0) return empty;
  const targetIds = [...targetSoItemIds];

  // 2. 対象の受注明細に紐づく全ての発注明細(他の発注を含む)の回答納期を集め、受注明細ごとに最も遅い日付を求める
  const directLinked = await db
    .select({
      salesOrderItemId: schema.orderItems.salesOrderItemId,
      answeredDeliveryDate: schema.orderItems.answeredDeliveryDate,
    })
    .from(schema.orderItems)
    .where(
      and(
        inArray(schema.orderItems.salesOrderItemId, targetIds),
        isNotNull(schema.orderItems.answeredDeliveryDate),
      ),
    );
  const viaRequisition = await db
    .select({
      salesOrderItemId: schema.purchaseRequestItems.salesOrderItemId,
      orderItemSalesOrderItemId: schema.orderItems.salesOrderItemId,
      answeredDeliveryDate: schema.orderItems.answeredDeliveryDate,
    })
    .from(schema.orderItems)
    .innerJoin(
      schema.purchaseRequestItems,
      eq(schema.orderItems.purchaseRequestItemId, schema.purchaseRequestItems.id),
    )
    .where(
      and(
        inArray(schema.purchaseRequestItems.salesOrderItemId, targetIds),
        isNotNull(schema.orderItems.answeredDeliveryDate),
      ),
    );

  const latestBySoItemId = new Map<string, string>();
  const consider = (soItemId: string | null, date: string | null) => {
    if (!soItemId || !date) return;
    const current = latestBySoItemId.get(soItemId);
    if (!current || date > current) latestBySoItemId.set(soItemId, date);
  };
  directLinked.forEach((r) => consider(r.salesOrderItemId, r.answeredDeliveryDate));
  // 発注明細側に直接の紐付けがある場合はそちらを正とする(上で集計済み)
  viaRequisition
    .filter((r) => !r.orderItemSalesOrderItemId)
    .forEach((r) => consider(r.salesOrderItemId, r.answeredDeliveryDate));
  if (latestBySoItemId.size === 0) return empty;

  // 3. 受注明細の現在値と比較し、変わるものだけ更新する
  const soItems = await db
    .select({
      id: schema.salesOrderItems.id,
      salesOrderId: schema.salesOrderItems.salesOrderId,
      itemName: schema.salesOrderItems.itemName,
      deliveryDate: schema.salesOrderItems.deliveryDate,
    })
    .from(schema.salesOrderItems)
    .where(inArray(schema.salesOrderItems.id, [...latestBySoItemId.keys()]));

  const changesBySalesOrderId = new Map<
    string,
    Array<{ salesOrderItemId: string; itemName: string | null; before: string | null; after: string }>
  >();
  for (const so of soItems) {
    const answered = latestBySoItemId.get(so.id);
    if (!answered) continue;
    const next = computeReflectedDeliveryDate(answered, reflection);
    if (so.deliveryDate === next) continue;
    const list = changesBySalesOrderId.get(so.salesOrderId) ?? [];
    list.push({ salesOrderItemId: so.id, itemName: so.itemName, before: so.deliveryDate, after: next });
    changesBySalesOrderId.set(so.salesOrderId, list);
  }
  if (changesBySalesOrderId.size === 0) return empty;

  const now = new Date();
  const statements: any[] = [];
  let updatedItemCount = 0;
  for (const [salesOrderId, changes] of changesBySalesOrderId) {
    for (const ch of changes) {
      statements.push(
        db
          .update(schema.salesOrderItems)
          .set({ deliveryDate: ch.after })
          .where(eq(schema.salesOrderItems.id, ch.salesOrderItemId)),
      );
      updatedItemCount++;
    }
    statements.push(
      db.insert(schema.salesOrderHistoryLogs).values({
        id: crypto.randomUUID(),
        salesOrderId,
        version: 1,
        action: "UPDATE",
        snapshotData: JSON.stringify({ deliveryDateChanges: changes, sourcePurchaseOrderId: orderId, reflection }),
        changedById: operatorEmployeeNumber,
        changedAt: now,
        comment: `発注(${orderId})の回答納期から明細の納期を反映`,
      }),
    );
  }
  await db.batch(statements as [any, ...any[]]);

  return { updatedItemCount, salesOrderIds: [...changesBySalesOrderId.keys()] };
}

// 反映結果を画面表示用のメッセージへ変換する(反映対象が無ければ空文字)
export function formatReflectionMessage(result: DeliveryDateReflectionResult): string {
  if (result.updatedItemCount === 0) return "";
  return `受注${result.salesOrderIds.length}件(明細${result.updatedItemCount}行)の納期へ回答納期を反映しました`;
}
