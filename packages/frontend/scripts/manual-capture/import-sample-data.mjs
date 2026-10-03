#!/usr/bin/env node
// sampledata/ の架空のサンプルデータを、画面の CSV 取込と同じ API で、撮影先(既定は Staging)に取り込む。
// 取込順は sampledata/README.md のとおり。取込先の対応表は packages/backend/test/support/csv-import.ts の
// IMPORT_ENDPOINTS と同じ(テストでも同じ順で取り込めることを確認している)。
//
// 使い方(リポジトリのルートで):
//   node packages/frontend/scripts/manual-capture/import-sample-data.mjs            # 取り込む
//   node packages/frontend/scripts/manual-capture/import-sample-data.mjs --dry-run  # 対象の確認だけ
//
// 注意: 在庫・入金/支払の消込の CSV は、取り込むたびに新しい伝票として登録される(2回目はエラーになるものもある)。
// やり直す場合は、撮影先の DB を作り直してから取り込む。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BASE_URL, REPO_ROOT, loginForCookie } from "./lib/config.mjs";

const STEPS = [
  ["units_import_sample.csv", "/api/units/bulk-register"],
  ["accounts_import_sample.csv", "/api/accounts/bulk-register"],
  ["departments_import.csv", "/api/departments/bulk-register"],
  ["roles_import.csv", "/api/roles/bulk-register"],
  ["role_permissions_import_sample.csv", "/api/permissions/bulk-register"],
  ["users_import.csv", "/api/users/bulk-register"],
  ["warehouses_import_sample.csv", "/api/warehouses/bulk-register", "json"],
  ["locations_import_sample.csv", "/api/locations/bulk-register"],
  ["partners_import_sample.csv", "/api/partners/bulk-register"],
  ["partner_contacts_import_sample.csv", "/api/partner-contacts/bulk-register"],
  ["projects_import_sample.csv", "/api/projects/bulk-register"],
  ["products_import_sample.csv", "/api/products/bulk-register"],
  ["product_prices_import_sample.csv", "/api/product-prices/bulk-register"],
  ["products_bom_import_sample.csv", "/api/item-structures/bulk-register"],
  ["item_reorder_settings_import_sample.csv", "/api/item-reorder-settings/bulk-register"],
  ["approval_flows_import_sample.csv", "/api/approval-flows/bulk-register"],
  ["stock_receipts_import_sample.csv", "/api/stock-receipts/bulk-register", "json"],
  ["stock_shipments_import_sample.csv", "/api/stock-shipments/bulk-register", "json"],
  ["stock_audits_import_sample.csv", "/api/stock-audits/bulk-register", "json"],
  ["stock_disposals_import_sample.csv", "/api/stock-disposals/bulk-register", "json"],
  ["stock_returns_import_sample.csv", "/api/stock-returns/bulk-register", "json"],
  ["quotes_import_sample.csv", "/api/quotes/bulk-register"],
  ["sales_orders_import_sample.csv", "/api/sales-orders/bulk-register"],
  ["sales_invoices_import_sample.csv", "/api/sales-invoices/bulk-register"],
  ["billing_import_sample.csv", "/api/sales-billing/bulk-register"],
  ["billing_payment_receipts_import_sample.csv", "/api/sales-billing/payment-receipts/bulk-register"],
  ["purchase_requisitions_import_sample.csv", "/api/purchase-requisitions/bulk-register"],
  ["purchase_orders_import_sample.csv", "/api/purchase-orders/bulk-register"],
  ["purchase_recognitions_import_sample.csv", "/api/purchase-recognitions/bulk-register"],
  ["purchase_payments_import_sample.csv", "/api/purchase-payments/bulk-register"],
  ["purchase_payment_disbursements_import_sample.csv", "/api/purchase-payments/disbursements/bulk-register"],
  ["sales_deals_import_sample.csv", "/api/sales-deals/bulk-register"],
  ["progress_stage_owners_import_sample.csv", "/api/progress/stage-owners/bulk-register"],
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`取込先: ${BASE_URL}(${STEPS.length} ファイル)${dryRun ? " ※確認のみ" : ""}`);
  if (dryRun) {
    for (const [file, url] of STEPS) console.log(`  ${file} → ${url}`);
    return;
  }
  const token = await loginForCookie();
  const cookie = `session_token=${token}`;
  let failed = 0;
  for (const [file, url, mode] of STEPS) {
    const csv = readFileSync(resolve(REPO_ROOT, "sampledata", file), "utf8");
    const init =
      mode === "json"
        ? { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ csvData: csv }) }
        : (() => {
            const form = new FormData();
            form.append("file", new File([csv], file, { type: "text/csv" }));
            return { method: "POST", headers: { Cookie: cookie }, body: form };
          })();
    const res = await fetch(`${BASE_URL}${url}`, init);
    const text = await res.text();
    const ok = res.ok && !/スキップ|skipped/i.test(text);
    if (!ok) failed++;
    const message = (() => {
      try {
        const body = JSON.parse(text);
        return body.message || body.error || "";
      } catch {
        return text.slice(0, 120);
      }
    })();
    console.log(`${ok ? "OK " : "NG "} ${res.status} ${file}${message ? ` - ${String(message).slice(0, 160)}` : ""}`);
  }
  console.log(failed ? `\n${failed} 件の取込に問題がありました。` : "\nすべて取り込みました。");
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`エラー: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
