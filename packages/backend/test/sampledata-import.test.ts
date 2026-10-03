import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../src/db/schema";
import { SCREEN_MASTER } from "../src/constants/screens";
import { IMPORT_ENDPOINTS, getApi, postCsv, sampleCsv, sampleFileNames } from "./support/csv-import";

// リポジトリ直下の sampledata/ にある取込用サンプルCSVを、本番と同じAPI・推奨する取込順で
// 順番に取り込み、全て成功することを確認する(サンプルが仕様変更で古くなっていないことの検知)。
// sampledata/ に新しいCSVを追加したら、下の STEPS にも取込手順を追加すること(未登録のCSVがあると失敗する)。
const csvOf = sampleCsv;
const dataRows = (name: string) => csvOf(name).split(/\r?\n/).filter((l) => l.trim() !== "").length - 1;
const importCsv = postCsv;

const db = drizzle(env.DB, { schema });
const now = new Date("2026-09-01T00:00:00Z");
const count = async (table: Parameters<typeof db.select>[0] extends never ? never : any) => (await db.select().from(table)).length;

interface Step {
  file: string;
  /** 取込後の確認(登録件数がCSVの行数と一致するか等) */
  verify?: () => Promise<void>;
}

// 依存関係の順(マスタ → 在庫 → 販売 → 購買 → 商談・進捗)。画面上の推奨取込順と同じ
const STEPS: Step[] = [
  { file: "units_import_sample.csv", verify: async () => expect(await count(schema.units)).toBe(dataRows("units_import_sample.csv")) },
  { file: "accounts_import_sample.csv", verify: async () => expect(await count(schema.accounts)).toBe(dataRows("accounts_import_sample.csv")) },
  { file: "departments_import.csv", verify: async () => expect(await count(schema.departments)).toBe(dataRows("departments_import.csv")) },
  { file: "roles_import.csv", verify: async () => expect(await count(schema.roles)).toBe(dataRows("roles_import.csv")) },
  { file: "role_permissions_import_sample.csv", verify: async () => expect(await count(schema.rolePermissions)).toBe(dataRows("role_permissions_import_sample.csv")) },
  { file: "users_import.csv" },
  { file: "warehouses_import_sample.csv", verify: async () => expect(await count(schema.warehouses)).toBe(dataRows("warehouses_import_sample.csv")) },
  { file: "locations_import_sample.csv", verify: async () => expect(await count(schema.locations)).toBe(dataRows("locations_import_sample.csv")) },
  { file: "partners_import_sample.csv", verify: async () => expect(await count(schema.partners)).toBe(dataRows("partners_import_sample.csv")) },
  { file: "partner_contacts_import_sample.csv", verify: async () => expect(await count(schema.partnerContacts)).toBe(dataRows("partner_contacts_import_sample.csv")) },
  { file: "projects_import_sample.csv", verify: async () => expect(await count(schema.projects)).toBe(dataRows("projects_import_sample.csv")) },
  { file: "products_import_sample.csv", verify: async () => expect(await count(schema.items)).toBe(dataRows("products_import_sample.csv")) },
  { file: "product_prices_import_sample.csv", verify: async () => expect(await count(schema.itemPrices)).toBeGreaterThanOrEqual(dataRows("product_prices_import_sample.csv")) },
  { file: "products_bom_import_sample.csv", verify: async () => expect(await count(schema.itemStructures)).toBe(dataRows("products_bom_import_sample.csv")) },
  { file: "item_reorder_settings_import_sample.csv", verify: async () => expect(await count(schema.itemReorderSettings)).toBe(dataRows("item_reorder_settings_import_sample.csv")) },
  { file: "approval_flows_import_sample.csv" },
  { file: "stock_receipts_import_sample.csv" },
  { file: "stock_shipments_import_sample.csv" },
  { file: "stock_audits_import_sample.csv" },
  { file: "stock_disposals_import_sample.csv" },
  { file: "stock_returns_import_sample.csv" },
  { file: "quotes_import_sample.csv" },
  { file: "sales_orders_import_sample.csv" },
  { file: "sales_invoices_import_sample.csv" },
  { file: "billing_import_sample.csv" },
  { file: "billing_payment_receipts_import_sample.csv" },
  { file: "purchase_requisitions_import_sample.csv" },
  { file: "purchase_orders_import_sample.csv" },
  { file: "purchase_recognitions_import_sample.csv" },
  { file: "purchase_payments_import_sample.csv" },
  { file: "purchase_payment_disbursements_import_sample.csv" },
  { file: "sales_deals_import_sample.csv" },
  { file: "progress_stage_owners_import_sample.csv" },
];

beforeAll(async () => {
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({}));
  // 前提: システム管理者・標準権限枠(画面マスタ×5操作)は初期セットアップ/画面で作成済み(税区分マスタはmigrationで初期投入済み)とする
  await db.insert(schema.users).values({ id: "user-admin", employeeNumber: "admin", email: "admin@example.com", name: "システム管理者", createdAt: now, updatedAt: now });
  const actions = [["menu", "メニュー表示"], ["read", "閲覧 (R)"], ["create", "登録 (C)"], ["update", "編集 (U)"], ["delete", "削除 (D)"]];
  const permissionRows = SCREEN_MASTER.flatMap((s) =>
    actions.map(([action, label]) => ({ id: `${s.resource}:${action}`, resource: s.resource, action, name: `${s.name} [${label}]`, description: null })),
  );
  // D1は1文100変数まで(1行5変数)のため、15行ずつ入れる
  for (let i = 0; i < permissionRows.length; i += 15) {
    await db.insert(schema.permissions).values(permissionRows.slice(i, i + 15));
  }
});

describe("sampledata/ のサンプルCSVは、推奨する取込順で全て取り込める", () => {
  it("sampledata/ の全CSVに取込手順(STEPS)が定義されている", () => {
    const defined = new Set(STEPS.map((s) => s.file));
    const actual = sampleFileNames();
    expect(actual.filter((f) => !defined.has(f))).toEqual([]);
    expect([...defined].filter((f) => !actual.includes(f))).toEqual([]);
  });

  for (const step of STEPS) {
    const ep = IMPORT_ENDPOINTS[step.file];
    it(`${step.file} → ${ep?.url}`, async () => {
      expect(ep, `${step.file} の取込先が IMPORT_ENDPOINTS にありません`).toBeDefined();
      const { status, body } = await importCsv(ep.url, csvOf(step.file), !!ep.json);
      expect(status, JSON.stringify(body)).toBe(200);
      // 参照先が見つからず一部の行が黙って読み飛ばされていないこと(スキップ通知が無いこと)
      expect(JSON.stringify(body), "一部の行がスキップされています").not.toMatch(/スキップ|skipped/i);
      if (step.verify) await step.verify();
    });
  }
});

// 取込が「成功した」だけでなく、サンプルが意図した業務の流れ(在庫の増減・伝票の紐づき・請求と入金の消込など)を
// 実際に再現できていることを確認する。上の全CSV取込が終わった後の状態を検査する
describe("取込後のデータが、サンプルの想定どおりになっている", () => {
  const stockQty = async (itemId: string, locationId: string) =>
    (await db.select().from(schema.stocks))
      .filter((s) => s.itemId === itemId && s.locationId === locationId)
      .reduce((sum, s) => sum + s.quantity, 0);

  it("在庫: 入庫 − 出庫 ± 棚卸差異・廃棄・返品の結果が想定の数量になる", async () => {
    expect({
      原材料A: await stockQty("ITEM-1001", "LOC-C-01"), // 入庫400、棚卸400(差異なし)
      原材料B: await stockQty("ITEM-1002", "LOC-C-02"), // 入庫150
      制御基板: await stockQty("ITEM-1003", "LOC-A-01"), // 入庫300 → 棚卸298 → 仕入先へ返品5
      梱包箱: await stockQty("ITEM-1004", "LOC-C-03"), // 入庫600 − 廃棄5
      商品P: await stockQty("ITEM-3001", "LOC-A-02"), // 入庫100 − 出庫20(棚卸80で差異なし)
      商品Q: await stockQty("ITEM-3002", "LOC-A-03"), // 入庫60 − 廃棄3
      製品X: await stockQty("ITEM-2001", "LOC-B-01"), // 入庫120 − 出庫30
      製品Y: await stockQty("ITEM-2002", "LOC-B-01"), // 入庫60 − 出庫10
      製品Z: await stockQty("ITEM-2003", "LOC-A-03"), // 入庫80 + 得意先からの返品受入2
      オプション: await stockQty("ITEM-2004", "LOC-A-03"), // 入庫40 − 出庫10
    }).toEqual({ 原材料A: 400, 原材料B: 150, 制御基板: 293, 梱包箱: 595, 商品P: 80, 商品Q: 57, 製品X: 90, 製品Y: 50, 製品Z: 82, オプション: 30 });
  });

  it("マスタ: 取引先・担当者・品目・所属が揃い、兼務の社員は2つの所属を持つ", async () => {
    expect(await count(schema.partners)).toBe(13);
    expect((await db.select().from(schema.userRoles)).length).toBe(13); // 12人 + 兼務の1件
    const users = await db.select().from(schema.users);
    expect(users.filter((u) => u.employeeNumber.startsWith("EMP")).length).toBe(12);
  });

  it("販売: 見積5・受注4・売上5。売上の請求済み/未請求と、請求・入金の消込状況が想定どおり", async () => {
    expect(await count(schema.quotes)).toBe(5);
    expect(await count(schema.salesOrders)).toBe(4);
    const invoices = await db.select().from(schema.salesInvoices);
    expect(invoices.length).toBe(5);
    const billed = invoices.filter((i) => i.billingStatus === "BILLED").map((i) => i.id).sort();
    expect(billed).toEqual(["SI-2026-0001", "SI-2026-0002"]);
    const billing = await db.select().from(schema.billingHeaders);
    const byId = Object.fromEntries(billing.map((b) => [b.id, b]));
    expect(byId["BL-2026-0001"].reconciliationStatus).toBe("RECONCILED");
    expect(byId["BL-2026-0001"].reconciledAmount).toBe(byId["BL-2026-0001"].totalAmount);
    expect(byId["BL-2026-0002"].reconciliationStatus).toBe("PARTIALLY_RECONCILED");
    expect(byId["BL-2026-0002"].reconciledAmount).toBe(100000);
  });

  it("購買: 購買申請3・発注4・仕入4。支払と消込が想定どおり", async () => {
    expect(await count(schema.purchaseRequests)).toBe(3);
    expect(await count(schema.orders)).toBe(4);
    expect(await count(schema.purchaseRecognitions)).toBe(4);
    const payments = await db.select().from(schema.paymentHeaders);
    expect(payments.length).toBe(1);
    expect(payments[0].reconciliationStatus).toBe("RECONCILED");
    expect(payments[0].reconciledAmount).toBe(payments[0].totalAmount);
  });

  it("承認フロー・進捗の担当設定が登録されている。部門+ロールは部署コード(0041)で指定でき、内部IDに変換されて保存される", async () => {
    expect(await count(schema.approvalFlows)).toBe(16);
    const owners = await db.select().from(schema.progressStageOwners);
    expect(owners.length).toBe(12);
    const deptRole = owners.find((o) => o.stageKey === "shipment_instruction")!;
    expect(deptRole.assigneeType).toBe("DEPT_ROLE");
    const [surrogate, roleId] = deptRole.assigneeRef.split(":");
    const dept = (await db.select().from(schema.departments)).find((d) => d.surrogateId === surrogate);
    expect(dept?.id).toBe("0041");
    expect(roleId).toBe("manager");
  });

  it("入金消込・支払消込のCSVを同じファイルで再度取り込むとエラーになり、記録は増えない(二重インポートの防止)", async () => {
    const receiptsBefore = await count(schema.paymentReceipts);
    const disbursementsBefore = await count(schema.paymentDisbursements);

    const receipts = await importCsv("/api/sales-billing/payment-receipts/bulk-register", csvOf("billing_payment_receipts_import_sample.csv"), false);
    const disbursements = await importCsv("/api/purchase-payments/disbursements/bulk-register", csvOf("purchase_payment_disbursements_import_sample.csv"), false);

    expect(receipts.status).toBe(400);
    expect(receipts.body.message).toContain("二重にインポートしている可能性があります");
    expect(disbursements.status).toBe(400);
    expect(disbursements.body.message).toContain("二重にインポートしている可能性があります");
    expect(await count(schema.paymentReceipts)).toBe(receiptsBefore);
    expect(await count(schema.paymentDisbursements)).toBe(disbursementsBefore);
  });

  it("商談: 4件が登録され、面談者・タスク・見積が紐づく。複数行のメモも保たれる", async () => {
    const dealsDb = drizzle(env.DB_DEALS, { schema: await import("../src/db/deals-schema") });
    const dealsSchema = await import("../src/db/deals-schema");
    const deals = await dealsDb.select().from(dealsSchema.deals);
    expect(deals.length).toBe(4);
    expect((await dealsDb.select().from(dealsSchema.dealTasks)).length).toBe(7);
    expect((await dealsDb.select().from(dealsSchema.dealAttendees)).length).toBe(9);
    expect((await dealsDb.select().from(dealsSchema.dealQuotes)).map((q) => q.quoteId)).toEqual(["QT-2026-0004-1"]);
    expect(deals.find((d) => d.title === "初回ヒアリング")?.memo).toContain("\n");
  });

  // 見積・受注・発注のCSVは明細ID(lineId)を持ち、受注(sourceQuoteItemId)・売上と仕入(sourceOrderItemId)は
  // 元の伝票の明細をそのIDで指す。これが無いと、残数量(売上・仕入の「受注/発注から選択」、見積からの受注作成)が
  // サンプルでは正しく計算されない
  it("明細のつながり: 受注明細は見積明細を、売上・仕入の明細は受注・発注の明細を明細IDで指す", async () => {
    const sourceOf = async <T extends { itemId: string | null }>(rows: T[], key: keyof T) =>
      Object.fromEntries(rows.map((r) => [r.itemId, r[key]]));
    const orderItems = await db.select().from(schema.salesOrderItems);
    const invoiceItems = await db.select().from(schema.salesInvoiceItems);
    const recognitionItems = await db.select().from(schema.purchaseRecognitionItems);
    const by = <T extends Record<string, any>>(rows: T[], parentKey: string, parentId: string) => rows.filter((r) => r[parentKey] === parentId);

    expect((await db.select().from(schema.quoteItems)).map((i) => i.id)).toContain("QT-2026-0001-1-L1");
    expect(await sourceOf(by(orderItems, "salesOrderId", "SO-2026-0001"), "sourceQuoteItemId")).toEqual({
      "ITEM-2001": "QT-2026-0001-1-L1",
      "ITEM-2004": "QT-2026-0001-1-L2",
      "ITEM-9001": "QT-2026-0001-1-L3",
    });
    expect(await sourceOf(by(orderItems, "salesOrderId", "SO-2026-0003"), "sourceQuoteItemId")).toEqual({ "ITEM-3001": "QT-2026-0005-1-L1" });
    expect(await sourceOf(by(orderItems, "salesOrderId", "SO-2026-0004"), "sourceQuoteItemId")).toEqual({ "ITEM-2003": null });
    expect(await sourceOf(by(invoiceItems, "salesInvoiceId", "SI-2026-0003"), "sourceOrderItemId")).toEqual({ "ITEM-3001": "SO-2026-0003-L1" });
    expect(await sourceOf(by(invoiceItems, "salesInvoiceId", "SI-2026-0004"), "sourceOrderItemId")).toEqual({ "ITEM-9001": null });
    expect(await sourceOf(by(recognitionItems, "purchaseRecognitionId", "PC-2026-0004"), "sourceOrderItemId")).toEqual({
      "ITEM-3001": "PO-2026-0003-L1",
      "ITEM-3002": "PO-2026-0003-L2",
    });
    expect(await sourceOf(by(recognitionItems, "purchaseRecognitionId", "PC-2026-0003"), "sourceOrderItemId")).toEqual({ "ITEM-1003": null });
  });

  it("残数量: 見積の受注済み数量・受注の売上済み数量・発注の仕入済み数量が、サンプルの分納・一部受注を反映する", async () => {
    const quote = await getApi("/api/sales-orders/quote-progress/QT-2026-0005-1");
    expect(quote.body).toEqual([
      { quoteItemId: "QT-2026-0005-1-L1", quantity: 20, orderedQuantity: 20, remainingQuantity: 0 },
      { quoteItemId: "QT-2026-0005-1-L2", quantity: 5, orderedQuantity: 0, remainingQuantity: 5 },
    ]);
    const order = await getApi("/api/sales-invoices/order-progress/SO-2026-0003");
    expect(order.body.map((p: any) => [p.salesOrderItemId, p.invoicedQuantity, p.remainingQuantity])).toEqual([["SO-2026-0003-L1", 12, 8]]);
    const po = await getApi("/api/purchase-recognitions/order-progress/PO-2026-0001");
    expect(po.body.map((p: any) => [p.sourceOrderItemId, p.recognizedQuantity, p.remainingQuantity])).toEqual([["PO-2026-0001-L1", 300, 0]]);
  });

  it("出力したCSVには明細ID(lineId)が含まれる(出力 → 取り込み直しでも明細IDが変わらない)", async () => {
    for (const [url, lineId] of [
      ["/api/quotes/csv-download", "QT-2026-0001-1-L1"],
      ["/api/sales-orders/csv-download", "SO-2026-0001-L1"],
      ["/api/purchase-orders/csv-download", "PO-2026-0001-L1"],
    ]) {
      const { status, body } = await getApi(url);
      expect(status, url).toBe(200);
      expect(String(body).split(/\r?\n/)[0], url).toContain("lineId");
      expect(String(body), url).toContain(lineId);
    }
  });

  it("見積・受注・発注のCSVを取り込み直しても、後続の伝票から参照されている明細はそのまま残り、エラーにならない", async () => {
    for (const file of ["quotes_import_sample.csv", "sales_orders_import_sample.csv", "purchase_orders_import_sample.csv"]) {
      const { status, body } = await importCsv(IMPORT_ENDPOINTS[file].url, csvOf(file), false);
      expect(status, `${file}: ${JSON.stringify(body)}`).toBe(200);
    }
    const linked = (await db.select().from(schema.salesOrderItems)).filter((i) => i.sourceQuoteItemId).length;
    expect(linked).toBe(6);
    expect((await db.select().from(schema.quoteItems)).map((i) => i.id)).toContain("QT-2026-0001-1-L1");
  });

  it("明細IDがCSV内で重複している・別の伝票の明細IDを使っている場合はエラーにし、1件も取り込まない", async () => {
    const header = "id,title,partnerId,quoteDate,status,totalAmount,taxAmount,lineId,itemId,itemName,inputType,quantity,unitPrice,unitCode,taxCategoryCode";
    const row = (id: string, lineId: string) =>
      `${id},明細IDの確認,CUST-0001,2026-09-01,DRAFT,1100,100,${lineId},ITEM-9001,設置作業,MASTER,1,1000,H,TAX_10`;
    const before = await count(schema.quotes);

    const duplicated = await importCsv("/api/quotes/bulk-register", [header, row("QT-LINE-1", "QT-LINE-1-L1"), row("QT-LINE-2", "QT-LINE-1-L1")].join("\n"), false);
    expect(duplicated.status).toBe(400);
    expect(JSON.stringify(duplicated.body)).toContain("QT-LINE-1-L1");

    const otherDocument = await importCsv("/api/quotes/bulk-register", [header, row("QT-LINE-3", "QT-2026-0001-1-L1")].join("\n"), false);
    expect(otherDocument.status).toBe(400);
    expect(JSON.stringify(otherDocument.body)).toContain("QT-2026-0001-1-L1");

    expect(await count(schema.quotes)).toBe(before);
  });

  // sampledata/README.md の注意書き(在庫系CSVは取り込むたびに新しい入庫として登録される)が事実であることの確認。
  // この挙動を変えた場合(二重取込をエラーにするなど)は、READMEも更新すること。他の検査の後に実行する
  it("在庫系のCSV(入庫)は、同じファイルを再度取り込むとエラーにならず、在庫が重複して増える", async () => {
    const before = await stockQty("ITEM-1001", "LOC-C-01");

    const { status } = await importCsv("/api/stock-receipts/bulk-register", csvOf("stock_receipts_import_sample.csv"), true);

    expect(status).toBe(200);
    expect(await stockQty("ITEM-1001", "LOC-C-01")).toBe(before + 400);
  });
});
