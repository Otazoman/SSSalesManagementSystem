import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import * as routers from "../../src/routes";
import type { Env } from "../../src/types/env";

/**
 * リポジトリ直下の sampledata/ の取込用CSVを、本番と同じ取込API(実ルーター)で投入するテスト用ヘルパー。
 * マスタ系など、画面の「CSV取込」と同じ形式のデータをテストの前提データにしたい時に使う:
 *   await importSampleCsv("partners_import_sample.csv");
 * 取込対象のCSVは `sampledata/`(業務担当者が編集する取込CSVと同じ形式)。推奨する取込順・前提は sampledata/README.md を参照。
 * CSVごとの取込先は IMPORT_ENDPOINTS(E2Eで同じCSVを取り込む時の対応表としても使える)。
 */

export interface ImportEndpoint {
  url: string;
  /** JSON {csvData} で送るAPI(既定はmultipartのfile)。倉庫・在庫系の取込は画面がCSVを読み込んで送る */
  json?: boolean;
}

export const IMPORT_ENDPOINTS: Record<string, ImportEndpoint> = {
  "units_import_sample.csv": { url: "/api/units/bulk-register" },
  "accounts_import_sample.csv": { url: "/api/accounts/bulk-register" },
  "departments_import.csv": { url: "/api/departments/bulk-register" },
  "roles_import.csv": { url: "/api/roles/bulk-register" },
  "role_permissions_import_sample.csv": { url: "/api/permissions/bulk-register" },
  "users_import.csv": { url: "/api/users/bulk-register" },
  "warehouses_import_sample.csv": { url: "/api/warehouses/bulk-register", json: true },
  "locations_import_sample.csv": { url: "/api/locations/bulk-register" },
  "partners_import_sample.csv": { url: "/api/partners/bulk-register" },
  "partner_contacts_import_sample.csv": { url: "/api/partner-contacts/bulk-register" },
  "projects_import_sample.csv": { url: "/api/projects/bulk-register" },
  "products_import_sample.csv": { url: "/api/products/bulk-register" },
  "product_prices_import_sample.csv": { url: "/api/product-prices/bulk-register" },
  "products_bom_import_sample.csv": { url: "/api/item-structures/bulk-register" },
  "item_reorder_settings_import_sample.csv": { url: "/api/item-reorder-settings/bulk-register" },
  "approval_flows_import_sample.csv": { url: "/api/approval-flows/bulk-register" },
  "stock_receipts_import_sample.csv": { url: "/api/stock-receipts/bulk-register", json: true },
  "stock_shipments_import_sample.csv": { url: "/api/stock-shipments/bulk-register", json: true },
  "stock_audits_import_sample.csv": { url: "/api/stock-audits/bulk-register", json: true },
  "stock_disposals_import_sample.csv": { url: "/api/stock-disposals/bulk-register", json: true },
  "stock_returns_import_sample.csv": { url: "/api/stock-returns/bulk-register", json: true },
  "quotes_import_sample.csv": { url: "/api/quotes/bulk-register" },
  "sales_orders_import_sample.csv": { url: "/api/sales-orders/bulk-register" },
  "sales_invoices_import_sample.csv": { url: "/api/sales-invoices/bulk-register" },
  "billing_import_sample.csv": { url: "/api/sales-billing/bulk-register" },
  "billing_payment_receipts_import_sample.csv": { url: "/api/sales-billing/payment-receipts/bulk-register" },
  "purchase_requisitions_import_sample.csv": { url: "/api/purchase-requisitions/bulk-register" },
  "purchase_orders_import_sample.csv": { url: "/api/purchase-orders/bulk-register" },
  "purchase_recognitions_import_sample.csv": { url: "/api/purchase-recognitions/bulk-register" },
  "purchase_payments_import_sample.csv": { url: "/api/purchase-payments/bulk-register" },
  "purchase_payment_disbursements_import_sample.csv": { url: "/api/purchase-payments/disbursements/bulk-register" },
  "sales_deals_import_sample.csv": { url: "/api/sales-deals/bulk-register" },
  "progress_stage_owners_import_sample.csv": { url: "/api/progress/stage-owners/bulk-register" },
};

const sampleFiles = import.meta.glob("../../../../sampledata/*.csv", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** sampledata/ のファイル名 → 内容 */
export function sampleFileNames(): string[] {
  return Object.keys(sampleFiles).map((p) => p.split("/").pop()!);
}

export function sampleCsv(fileName: string): string {
  const hit = Object.entries(sampleFiles).find(([path]) => path.endsWith(`/${fileName}`));
  if (!hit) throw new Error(`sampledata/${fileName} が見つかりません`);
  return hit[1];
}

let app: Hono<{ Bindings: Env }> | undefined;
function getApp() {
  if (!app) {
    const a = new Hono<{ Bindings: Env }>();
    Object.entries(routers).forEach(([key, router]) => {
      a.route(`/api/${key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`, router as never);
    });
    app = a;
  }
  return app;
}

/** CSV本文を、指定URLの取込APIへ送る(ステータスと応答を返す。失敗しても例外にしない) */
export async function postCsv(url: string, csv: string, asJson: boolean) {
  const ctx = createExecutionContext();
  let init: RequestInit;
  if (asJson) {
    init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csvData: csv }) };
  } else {
    const form = new FormData();
    form.append("file", new File([csv], "sample.csv", { type: "text/csv" }));
    init = { method: "POST", body: form };
  }
  const res = await getApp().request(url, init, env, ctx);
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* JSONでない応答はそのまま扱う */
  }
  return { status: res.status, body };
}

/** 取込後の確認用に、GETのAPIを呼ぶ(ステータスと応答の本文を返す。JSONでなければ文字列のまま) */
export async function getApi(url: string) {
  const ctx = createExecutionContext();
  const res = await getApp().request(url, {}, env, ctx);
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* JSONでない応答(CSVなど)はそのまま扱う */
  }
  return { status: res.status, body };
}

/**
 * sampledata/ のCSVを取り込む。取込に失敗した(200以外)場合や、一部の行が黙って読み飛ばされた場合は例外にする
 * (前提データの取込失敗に気付かないまま後続のテストが進むのを防ぐ)。
 */
export async function importSampleCsv(fileName: string) {
  const ep = IMPORT_ENDPOINTS[fileName];
  if (!ep) throw new Error(`${fileName} の取込先が IMPORT_ENDPOINTS にありません`);
  const result = await postCsv(ep.url, sampleCsv(fileName), !!ep.json);
  if (result.status !== 200) throw new Error(`${fileName} の取込に失敗しました(${result.status}): ${JSON.stringify(result.body)}`);
  if (/スキップ|skipped/i.test(JSON.stringify(result.body))) {
    throw new Error(`${fileName}: 一部の行がスキップされました: ${JSON.stringify(result.body)}`);
  }
  return result;
}
