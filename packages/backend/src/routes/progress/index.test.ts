import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { progressRouter } from "./index";
import { computeNextStages } from "./progress-next-step";

const db = drizzle(env.DB, { schema });
const now = new Date("2026-09-01T00:00:00Z");
const later = new Date("2026-09-10T00:00:00Z");

const audit = { createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now };

// 伝票の画面(document-completion API)で設定される「完了/進行中」の手動設定。進捗確認は読み取りのみ
async function forceDocument(stageKey: string, documentId: string, forcedState: "COMPLETED" | "IN_PROGRESS") {
  await db.insert(schema.documentCompletionOverrides).values({
    id: `${stageKey}-${documentId}`,
    stageKey,
    documentId,
    forcedState,
    ...audit,
  });
}

beforeEach(async () => {
  await db.delete(schema.documentCompletionOverrides);
  await db.delete(schema.progressCaseStageOverrides);
  await db.delete(schema.progressCaseAssignments);
  await db.delete(schema.progressStageOwners);
  await db.delete(schema.workflowLogs);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.approvalFlowSteps);
  await db.delete(schema.approvalFlows);
  await db.delete(schema.purchaseRecognitions);
  await db.delete(schema.orders);
  await db.delete(schema.purchaseRequestItems);
  await db.delete(schema.purchaseRequests);
  await db.delete(schema.salesOrderItems);
  await db.delete(schema.salesOrders);
  await db.delete(schema.quotes);
  await db.delete(schema.departments);
  await db.delete(schema.userRoles);
  await db.delete(schema.roles);
  await db.delete(schema.users);
  await db.delete(schema.partners);

  await db.insert(schema.partners).values({ id: "P-1", name: "テスト商事", type: "CUSTOMER", ...audit });
  await db.insert(schema.users).values({
    id: "user-001",
    employeeNumber: "EMP001",
    email: "emp001@example.com",
    name: "営業太郎",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.departments).values({
    surrogateId: "dept-a",
    id: "DEPT-A",
    name: "営業部",
    validFrom: now,
    ...audit,
  });
});

// 既定(state省略)は進行中のみになったため、従来の検索・件数の検証はstate=allで行う。
// 進行中/完了の絞り込みは「追加要望M-2」のテストでstateを明示する
async function callProgress(query = "") {
  if (!query.includes("state=")) query += (query.includes("?") ? "&" : "?") + "state=all";
  const ctx = createExecutionContext();
  const res = await progressRouter.request(`/${query}`, {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function seedSalesOrderWithPurchase() {
  await db.insert(schema.quotes).values({
    id: "Q-1",
    partnerId: "P-1",
    quoteDate: now,
    status: "APPROVED",
    totalAmount: 0,
    taxAmount: 0,
    salesPersonEmployeeNumber: "EMP001",
    ...audit,
  } as never);
  await db.insert(schema.salesOrders).values({
    id: "SO-1",
    partnerId: "P-1",
    sourceQuoteId: "Q-1",
    orderDate: later,
    status: "PENDING",
    totalAmount: 0,
    taxAmount: 0,
    salesPersonEmployeeNumber: "EMP001",
    ...audit,
  });
  await db.insert(schema.salesOrderItems).values({
    id: "SOI-1",
    salesOrderId: "SO-1",
    itemId: "ITEM1",
    inputType: "MASTER",
    quantity: 1,
    unitPrice: 100,
    amount: 100,
    sortOrder: 0,
  });
  await db.insert(schema.purchaseRequests).values({
    id: "PR-1",
    title: "受注紐付け購買申請",
    departmentSurrogateId: "dept-a",
    applicantId: "EMP001",
    requestType: "ONE_TIME",
    status: "APPROVED",
    totalAmount: 1000,
    ...audit,
  });
  await db.insert(schema.purchaseRequestItems).values({
    id: "PRI-1",
    requestId: "PR-1",
    itemId: "ITEM1",
    quantity: 1,
    estimatedUnitPrice: 1000,
    inputType: "MASTER",
    sortOrder: 0,
    salesOrderItemId: "SOI-1",
  });
  await db.insert(schema.orders).values({
    id: "PO-1",
    title: "発注",
    requestId: "PR-1",
    partnerId: "P-1",
    orderDate: later,
    status: "APPROVED",
    totalAmount: 1000,
    taxAmount: 0,
    purchasePersonEmployeeNumber: "EMP001",
    ...audit,
  });
}

describe("GET / (進捗一覧)", () => {
  it("データが無ければ空配列を返す", async () => {
    const res = await callProgress();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0, page: 1, pageSize: 30, nextOffset: null });
  });

  it("受注を軸に、見積・受注紐付けの購買申請・発注を1行(一気通貫)にまとめる", async () => {
    await seedSalesOrderWithPurchase();
    const body = (await (await callProgress()).json()) as any;

    expect(body.total).toBe(1); // 見積(受注化済み)・購買申請(受注紐付け)・発注(購買申請あり)は別行にならない
    const row = body.items[0];
    expect(row.rootKind).toBe("sales_order");
    expect(row.rootId).toBe("SO-1");
    expect(row.partnerName).toBe("テスト商事");
    expect(row.stages.quote.map((d: any) => d.id)).toEqual(["Q-1"]);
    expect(row.stages.sales_order[0]).toMatchObject({ id: "SO-1", assigneeName: "営業太郎" });
    expect(row.stages.purchase_request.map((d: any) => d.id)).toEqual(["PR-1"]);
    expect(row.stages.purchase_order[0]).toMatchObject({ id: "PO-1", assigneeName: "営業太郎" });
    expect(row.stages.sales_invoice).toEqual([]);
  });

  it("受注化されていない見積・受注に紐づかない購買申請・購買申請なしの発注は単独行になる", async () => {
    await db.insert(schema.quotes).values({
      id: "Q-ALONE",
      partnerId: "P-1",
      quoteDate: now,
      status: "DRAFT",
      totalAmount: 0,
      taxAmount: 0,
      ...audit,
    } as never);
    await db.insert(schema.purchaseRequests).values({
      id: "PR-ALONE",
      title: "単独申請",
      departmentSurrogateId: "dept-a",
      applicantId: "EMP001",
      requestType: "ONE_TIME",
      status: "DRAFT",
      totalAmount: 1,
      ...audit,
    });
    await db.insert(schema.orders).values({
      id: "PO-ALONE",
      title: "単独発注",
      orderDate: later,
      status: "DRAFT",
      totalAmount: 1,
      taxAmount: 0,
      ...audit,
    });

    const body = (await (await callProgress()).json()) as any;
    expect(body.total).toBe(3);
    expect(body.items.map((r: any) => `${r.rootKind}:${r.rootId}`).sort()).toEqual([
      "purchase_order:PO-ALONE",
      "purchase_request:PR-ALONE",
      "quote:Q-ALONE",
    ]);

    const filtered = (await (await callProgress("?rootKind=quote")).json()) as any;
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].rootId).toBe("Q-ALONE");
  });

  it("承認申請があれば承認ステップの進捗(完了数/全体数・承認待ちロール)を返す", async () => {
    await seedSalesOrderWithPurchase();
    await db.insert(schema.roles).values([
      { id: "role-1", name: "課長", createdAt: now },
      { id: "role-2", name: "部長", createdAt: now },
    ]);
    await db.insert(schema.approvalFlows).values({
      id: "FLOW-1",
      name: "受注承認",
      requestType: "SALES_ORDER",
      minAmount: 0,
      maxAmount: 999999999,
    });
    await db.insert(schema.approvalFlowSteps).values([
      { id: "S1", flowId: "FLOW-1", stepOrder: 1, approverRoleId: "role-1" },
      { id: "S2", flowId: "FLOW-1", stepOrder: 2, approverRoleId: "role-2" },
    ]);
    await db.insert(schema.masterApprovalRequests).values({
      id: "REQ-1",
      targetType: "sales_orders",
      targetId: "SO-1",
      requestType: "SALES_ORDER",
      status: "PENDING",
      flowId: "FLOW-1",
      applicantId: "user-001",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.workflowLogs).values([
      {
        id: "L1",
        targetType: "sales_orders",
        targetId: "SO-1",
        approverId: "user-001",
        approverRoleId: "role-1",
        layer: 1,
        status: "APPROVED",
        performedAt: now,
        requestId: "REQ-1",
      },
      {
        id: "L2",
        targetType: "sales_orders",
        targetId: "SO-1",
        approverId: null,
        approverRoleId: "role-2",
        layer: 2,
        status: "PENDING",
        performedAt: null,
        requestId: "REQ-1",
      },
    ]);

    const body = (await (await callProgress()).json()) as any;
    const so = body.items[0].stages.sales_order[0];
    expect(so.approval).toEqual({
      requestStatus: "PENDING",
      approvedLayers: 1,
      totalLayers: 2,
      pendingRoleName: "部長",
    });
    expect(body.items[0].stages.purchase_order[0].approval).toBeNull(); // 承認申請の無い伝票はnull
  });

  it("ページングと不正なクエリ", async () => {
    await seedSalesOrderWithPurchase();
    const body = (await (await callProgress("?page=2&pageSize=1")).json()) as any;
    expect(body).toMatchObject({ items: [], total: 1, page: 2, pageSize: 1 });

    const bad = await callProgress("?rootKind=unknown");
    expect(bad.status).toBe(400);
  });
});

describe("GET / (検索条件)", () => {
  it("取引先名・担当者・期間で絞り込める", async () => {
    await seedSalesOrderWithPurchase(); // SO-1: 取引先「テスト商事」、営業担当EMP001(営業太郎)、受注日2026-09-10

    const byPartner = (await (await callProgress("?partnerName=テスト")).json()) as any;
    expect(byPartner.total).toBe(1);
    expect(((await (await callProgress("?partnerName=存在しない")).json()) as any).total).toBe(0);

    expect(((await (await callProgress("?person=営業太郎")).json()) as any).total).toBe(1);
    expect(((await (await callProgress("?person=EMP001")).json()) as any).total).toBe(1);
    expect(((await (await callProgress("?person=別人")).json()) as any).total).toBe(0);

    expect(((await (await callProgress("?startDate=2026-09-10&endDate=2026-09-10")).json()) as any).total).toBe(1);
    expect(((await (await callProgress("?startDate=2026-09-11")).json()) as any).total).toBe(0);
    expect(((await (await callProgress("?endDate=2026-09-09")).json()) as any).total).toBe(0);
  });
});

describe("担当者の従業員番号完全一致(ダッシュボード用)", () => {
  it("personEmployeeNumberは完全一致で絞り込む", async () => {
    await seedSalesOrderWithPurchase();
    expect(((await (await callProgress("?personEmployeeNumber=EMP001")).json()) as any).total).toBe(1);
    expect(((await (await callProgress("?personEmployeeNumber=EMP00")).json()) as any).total).toBe(0);
  });
});

async function send(path: string, method: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await progressRouter.request(
    path,
    { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("Item12-4: 次工程の自動判定", () => {
  const has = (...keys: string[]) => (k: string) => keys.includes(k);

  it("販売起点: 最後に伝票がある工程の次が次工程(飛んだ工程があっても最後の次)", () => {
    expect(computeNextStages("quote", has("quote"))).toEqual([{ chain: "sales", stageKey: "sales_order" }]);
    expect(computeNextStages("sales_order", has("quote", "sales_order"))).toEqual([
      { chain: "sales", stageKey: "shipment_instruction" },
    ]);
    // 出荷指示を経ずに出庫まで進んでいる場合は売上が次
    expect(computeNextStages("sales_order", has("quote", "sales_order", "item_shipment"))).toEqual([
      { chain: "sales", stageKey: "sales_invoice" },
    ]);
  });

  it("最終工程まで到達済みなら次工程なし。購買側の伝票がある販売起点は購買系の次工程も返す", () => {
    expect(computeNextStages("sales_order", has("sales_order", "billing"))).toEqual([]);
    expect(computeNextStages("sales_order", has("sales_order", "purchase_request"))).toEqual([
      { chain: "sales", stageKey: "shipment_instruction" },
      { chain: "purchase", stageKey: "purchase_order" },
    ]);
  });

  it("購買起点は購買系のみ", () => {
    expect(computeNextStages("purchase_request", has("purchase_request"))).toEqual([
      { chain: "purchase", stageKey: "purchase_order" },
    ]);
    expect(computeNextStages("purchase_order", has("purchase_order", "item_receipt", "purchase_recognition"))).toEqual([
      { chain: "purchase", stageKey: "payment" },
    ]);
  });
});

describe("Item12-2/12-4: 担当設定", () => {
  it("工程の既定担当(個人・ロール)を保存・取得でき、次工程の担当に反映される", async () => {
    await seedSalesOrderWithPurchase();
    await db.insert(schema.roles).values({ id: "role-ship", name: "出荷担当", createdAt: now });

    const bad = await send("/stage-owners", "PUT", { owners: [{ stageKey: "sales_order", assigneeType: "USER", assigneeRef: "NOPE" }] });
    expect(bad.status).toBe(400);

    const ok = await send("/stage-owners", "PUT", {
      owners: [
        { stageKey: "shipment_instruction", assigneeType: "ROLE", assigneeRef: "role-ship" },
        { stageKey: "purchase_recognition", assigneeType: "USER", assigneeRef: "EMP001" },
      ],
    });
    expect(ok.status).toBe(200);

    const owners = (await (await callProgress("stage-owners")).json()) as any[];
    expect(owners).toHaveLength(2);
    expect(owners.find((o) => o.stageKey === "purchase_recognition").assigneeName).toBe("営業太郎");

    const row = ((await (await callProgress()).json()) as any).items[0];
    const salesNext = row.nextSteps.find((n: any) => n.chain === "sales");
    expect(salesNext).toMatchObject({ stageKey: "shipment_instruction", assigneeName: "ロール: 出荷担当", source: "stage" });
    const purchaseNext = row.nextSteps.find((n: any) => n.chain === "purchase");
    expect(purchaseNext.stageKey).toBe("receipt_instruction"); // 発注の次は入荷(指示)
  });

  it("同じ工程の重複指定は400。再保存すると指定の無い工程は未設定になる", async () => {
    const dup = await send("/stage-owners", "PUT", {
      owners: [
        { stageKey: "billing", assigneeType: "USER", assigneeRef: "EMP001" },
        { stageKey: "billing", assigneeType: "USER", assigneeRef: "EMP001" },
      ],
    });
    expect(dup.status).toBe(400);

    await send("/stage-owners", "PUT", { owners: [{ stageKey: "billing", assigneeType: "USER", assigneeRef: "EMP001" }] });
    await send("/stage-owners", "PUT", { owners: [] });
    expect(((await (await callProgress("stage-owners")).json()) as any[]).length).toBe(0);
  });

  it("案件×工程の個別割当は既定担当を上書きし、担当列の無い工程の表示にも反映され、解除できる", async () => {
    await seedSalesOrderWithPurchase();
    await send("/stage-owners", "PUT", { owners: [{ stageKey: "shipment_instruction", assigneeType: "USER", assigneeRef: "EMP001" }] });
    await db.insert(schema.users).values({
      id: "user-002",
      employeeNumber: "EMP002",
      email: "emp002@example.com",
      name: "出荷花子",
      createdAt: now,
      updatedAt: now,
    });

    const nope = await send("/case-assignment", "PUT", { rootKind: "sales_order", rootId: "SO-1", stageKey: "shipment_instruction", employeeNumber: "NOPE" });
    expect(nope.status).toBe(400);

    const set = await send("/case-assignment", "PUT", { rootKind: "sales_order", rootId: "SO-1", stageKey: "shipment_instruction", employeeNumber: "EMP002" });
    expect(set.status).toBe(200);
    let row = ((await (await callProgress()).json()) as any).items[0];
    expect(row.nextSteps.find((n: any) => n.chain === "sales")).toMatchObject({ assigneeName: "出荷花子", source: "case" });
    expect(row.assignments.shipment_instruction).toEqual({ employeeNumber: "EMP002", name: "出荷花子" });

    // 上書き(更新)しても1件のまま
    await send("/case-assignment", "PUT", { rootKind: "sales_order", rootId: "SO-1", stageKey: "shipment_instruction", employeeNumber: "EMP001" });
    expect((await db.select().from(schema.progressCaseAssignments)).length).toBe(1);

    await send("/case-assignment", "PUT", { rootKind: "sales_order", rootId: "SO-1", stageKey: "shipment_instruction", employeeNumber: null });
    row = ((await (await callProgress()).json()) as any).items[0];
    expect(row.nextSteps.find((n: any) => n.chain === "sales")).toMatchObject({ assigneeName: "営業太郎", source: "stage" });
    expect(row.assignments.shipment_instruction).toBeUndefined();
  });
});

// ==========================================
// 追加要望M-2: 完了/進行中・複合検索・CSV・部門+ロール
// ==========================================
describe("追加要望M-2: 完了/進行中の判定と既定表示", () => {
  afterEach(async () => {
    await db.delete(schema.salesInvoiceItems);
    await db.delete(schema.salesInvoices);
    await db.delete(schema.documentCompletionOverrides);
  });

  async function seedInvoice(id: string, quantity: number, billingStatus = "BILLED") {
    await db.insert(schema.salesInvoices).values({
      id,
      partnerId: "P-1",
      salesOrderId: "SO-1",
      invoiceDate: later,
      status: "APPROVED",
      billingStatus,
      totalAmount: 0,
      taxAmount: 0,
      ...audit,
    });
    await db.insert(schema.salesInvoiceItems).values({
      id: `${id}-1`,
      salesInvoiceId: id,
      sourceOrderItemId: "SOI-1",
      quantity,
      unitPrice: 100,
      amount: 100,
    });
  }

  it("既定は進行中のみ。見積は受注化済み・購買申請は発注化済みで完了、承認前の受注・注残のある発注は進行中", async () => {
    await seedSalesOrderWithPurchase();
    const body = (await (await callProgress("?state=in_progress")).json()) as any;
    expect(body.total).toBeNull();
    expect(body.nextOffset).toBeNull();
    const row = body.items[0];
    expect(row.rootId).toBe("SO-1");
    expect(row.caseState).toBe("IN_PROGRESS");
    expect(row.stageStatuses.quote).toEqual({ state: "COMPLETED", manual: false });
    expect(row.stageStatuses.sales_order).toEqual({ state: "IN_PROGRESS", manual: false });
    expect(row.stageStatuses.purchase_request).toEqual({ state: "COMPLETED", manual: false });
    expect(row.stageStatuses.purchase_order).toEqual({ state: "IN_PROGRESS", manual: false });
    expect(row.stageStatuses.billing).toEqual({ state: "NONE", manual: false });
    expect(row.stages.sales_order[0].completed).toBe(false);

    // state省略(既定)でも進行中のみ
    const ctx = createExecutionContext();
    const def = await progressRouter.request("/", {}, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(((await def.json()) as any).items).toHaveLength(1);
    expect(((await (await callProgress("?state=completed")).json()) as any).items).toHaveLength(0);
  });

  it("受注の完了は全明細の売上計上数量が受注数量以上(分納・複数売上計上に対応)", async () => {
    await seedSalesOrderWithPurchase();
    await db.update(schema.salesOrders).set({ status: "APPROVED" });
    await db.update(schema.salesOrderItems).set({ quantity: 10 });

    await seedInvoice("SI-1", 4);
    let row = ((await (await callProgress()).json()) as any).items[0];
    expect(row.stageStatuses.sales_order.state).toBe("IN_PROGRESS"); // 残注文あり
    expect(row.stageStatuses.sales_invoice.state).toBe("COMPLETED"); // 売上は請求済み

    await seedInvoice("SI-2", 6);
    row = ((await (await callProgress()).json()) as any).items[0];
    expect(row.stageStatuses.sales_order.state).toBe("COMPLETED"); // 2回に分けた売上計上で注残なし
  });

  it("売上は請求済み(BILLED)になるまで進行中", async () => {
    await seedSalesOrderWithPurchase();
    await seedInvoice("SI-1", 1, "UNBILLED");
    const row = ((await (await callProgress()).json()) as any).items[0];
    expect(row.stageStatuses.sales_invoice.state).toBe("IN_PROGRESS");
  });

  it("伝票の画面での手動設定(完了/進行中)を反映し、全工程完了の案件は完了として扱われる。設定を消すと自動判定に戻る", async () => {
    await seedSalesOrderWithPurchase();
    await forceDocument("sales_order", "SO-1", "COMPLETED");
    await forceDocument("purchase_order", "PO-1", "COMPLETED");

    const row = ((await (await callProgress("?state=all")).json()) as any).items[0];
    expect(row.stageStatuses.sales_order).toEqual({ state: "COMPLETED", manual: true });
    expect(row.stageStatuses.purchase_order).toEqual({ state: "COMPLETED", manual: true });
    expect(row.stages.sales_order[0]).toMatchObject({ id: "SO-1", completed: true, manual: true });
    expect(row.caseState).toBe("COMPLETED");
    expect(((await (await callProgress("?state=in_progress")).json()) as any).items).toHaveLength(0);
    expect(((await (await callProgress("?state=completed")).json()) as any).items).toHaveLength(1);

    // 進行中に設定し直すと、案件も進行中に戻る
    await db.update(schema.documentCompletionOverrides).set({ forcedState: "IN_PROGRESS" }).where(eq(schema.documentCompletionOverrides.documentId, "SO-1"));
    expect(((await (await callProgress("?state=in_progress")).json()) as any).items).toHaveLength(1);

    // 設定を消すと自動判定に戻る
    await db.delete(schema.documentCompletionOverrides).where(eq(schema.documentCompletionOverrides.documentId, "SO-1"));
    const cleared = ((await (await callProgress("?state=all")).json()) as any).items[0];
    expect(cleared.stageStatuses.sales_order).toEqual({ state: "IN_PROGRESS", manual: false });
  });

  it("進捗確認は閲覧専用: 完了/進行中を上書きするAPI(case-stage-override)は存在しない", async () => {
    await seedSalesOrderWithPurchase();

    const res = await send("/case-stage-override", "PUT", { rootKind: "sales_order", rootId: "SO-1", stageKey: "sales_order", forcedState: "COMPLETED" });

    expect(res.status).toBe(404);
    expect(await db.select().from(schema.documentCompletionOverrides)).toHaveLength(0);
  });

  it("進行中の走査はnextOffsetで続きを取得でき、完了案件は読み飛ばされる", async () => {
    for (const [i, id] of ["SO-A", "SO-B", "SO-C", "SO-D"].entries()) {
      await db.insert(schema.salesOrders).values({
        id,
        partnerId: "P-1",
        orderDate: new Date(later.getTime() - i * 86400000), // A→Dの順に新しい
        status: "PENDING",
        totalAmount: 0,
        taxAmount: 0,
        ...audit,
      });
    }
    await forceDocument("sales_order", "SO-B", "COMPLETED");

    const first = (await (await callProgress("?state=in_progress&pageSize=2")).json()) as any;
    expect(first.items.map((r: any) => r.rootId)).toEqual(["SO-A", "SO-C"]);
    expect(first.nextOffset).toBe(3); // SO-Cまで消費済み(SO-B は完了のため読み飛ばし)

    const second = (await (await callProgress(`?state=in_progress&pageSize=2&offset=${first.nextOffset}`)).json()) as any;
    expect(second.items.map((r: any) => r.rootId)).toEqual(["SO-D"]);
    expect(second.nextOffset).toBeNull();
  });
});

describe("追加要望M-2: 複合検索(件名・取引先・伝票番号・キーワード・見積起点)", () => {
  it("件名・取引先名・伝票番号(案件内のどの伝票でも)・横断キーワードをANDで絞り込める", async () => {
    await seedSalesOrderWithPurchase();
    await db.update(schema.salesOrders).set({ title: "太陽光パネル設置" });

    const count = async (query: string) => ((await (await callProgress(query)).json()) as any).items.length;
    expect(await count("?title=太陽光")).toBe(1);
    expect(await count("?title=蓄電池")).toBe(0);
    // 件名+取引先名はAND
    expect(await count("?title=太陽光&partnerName=テスト商事")).toBe(1);
    expect(await count("?title=太陽光&partnerName=存在しない")).toBe(0);
    // 案件内のどの伝票番号でもヒット(見積・購買申請・発注)
    expect(await count("?docNumber=Q-1")).toBe(1);
    expect(await count("?docNumber=PR-1")).toBe(1);
    expect(await count("?docNumber=PO-1")).toBe(1);
    expect(await count("?docNumber=XX-9")).toBe(0);
    // 横断キーワード(件名/取引先名/伝票番号のどれでも)
    expect(await count("?q=太陽光")).toBe(1);
    expect(await count("?q=テスト商事")).toBe(1);
    expect(await count("?q=PO-1")).toBe(1);
    expect(await count("?q=zzz")).toBe(0);
  });

  it("見積起点の案件(見積から始まる案件)に絞り込め、見積番号でも案件がヒットする", async () => {
    await seedSalesOrderWithPurchase(); // 見積Q-1→受注SO-1
    await db.insert(schema.salesOrders).values({
      id: "SO-NOQ",
      partnerId: "P-1",
      orderDate: later,
      status: "PENDING",
      totalAmount: 0,
      taxAmount: 0,
      ...audit,
    });
    await db.insert(schema.quotes).values({
      id: "Q-2",
      partnerId: "P-1",
      quoteDate: later,
      status: "APPROVED",
      totalAmount: 0,
      taxAmount: 0,
      ...audit,
    } as never);

    const ids = async (query: string) =>
      ((await (await callProgress(query)).json()) as any).items.map((r: any) => r.rootId).sort();
    expect(await ids("")).toEqual(["Q-2", "SO-1", "SO-NOQ"]);
    // 見積起点=見積が存在する案件(受注化済みの受注+受注化前の見積)。見積なしの受注は除外
    expect(await ids("?fromQuote=true")).toEqual(["Q-2", "SO-1"]);
    expect(await ids("?docNumber=Q-1")).toEqual(["SO-1"]);
  });
});

describe("追加要望M-2: CSVダウンロード", () => {
  it("検索条件を反映したCSVを出力できる(案件・工程ごとの伝票番号と状態)", async () => {
    await seedSalesOrderWithPurchase();
    const res = await callProgress("csv-download?state=in_progress");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const lines = (await res.text()).split("\n");
    expect(lines[0]).toContain("起点伝票番号");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"SO-1"');
    expect(lines[1]).toContain('"進行中"');
    expect(lines[1]).toContain('"PO-1"');

    const none = await callProgress("csv-download?state=completed");
    expect((await none.text()).split("\n")).toHaveLength(1);
  });
});

describe("追加要望M-2: 工程担当に部署+ロール", () => {
  it("部署+ロールを工程の既定担当に保存でき、次工程の担当表示に反映される。存在しない部署/ロールは400", async () => {
    await seedSalesOrderWithPurchase();
    await db.insert(schema.roles).values({ id: "role-ship", name: "出荷担当", createdAt: now });

    for (const assigneeRef of ["dept-a", "dept-a:NOPE", "nodept:role-ship"]) {
      const bad = await send("/stage-owners", "PUT", { owners: [{ stageKey: "shipment_instruction", assigneeType: "DEPT_ROLE", assigneeRef }] });
      expect(bad.status).toBe(400);
    }

    const ok = await send("/stage-owners", "PUT", {
      owners: [{ stageKey: "shipment_instruction", assigneeType: "DEPT_ROLE", assigneeRef: "dept-a:role-ship" }],
    });
    expect(ok.status).toBe(200);

    const owners = (await (await callProgress("stage-owners")).json()) as any[];
    expect(owners[0]).toMatchObject({ assigneeType: "DEPT_ROLE", assigneeName: "営業部 / 出荷担当" });

    const row = ((await (await callProgress()).json()) as any).items[0];
    expect(row.nextSteps.find((n: any) => n.chain === "sales")).toMatchObject({
      stageKey: "shipment_instruction",
      assigneeName: "部署/ロール: 営業部 / 出荷担当",
      source: "stage",
    });
  });
});
