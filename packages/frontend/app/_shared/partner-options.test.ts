import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPartnersOfTypes, selectablePartners } from "./partner-options";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("selectablePartners: BUG-066 取引停止の取引先は選択肢に出さない", () => {
  const partners = [
    { id: "SUPP-1", name: "仕入先A", status: "active" },
    { id: "SUPP-5", name: "仕入先E(取引停止)", status: "suspended" },
    { id: "SUPP-6", name: "状態不明" },
  ];

  it("取引停止を除く(状態が無いものは残す)", () => {
    expect(selectablePartners(partners, "").map((p) => p.id)).toEqual(["SUPP-1", "SUPP-6"]);
  });

  it("既に選ばれている取引停止の取引先は残す(既存の伝票の表示用)", () => {
    expect(selectablePartners(partners, "SUPP-5").map((p) => p.id)).toEqual(["SUPP-1", "SUPP-5", "SUPP-6"]);
  });
});

describe("fetchPartnersOfTypes: BUG-067 複数の区分の取引先をまとめて取得する", () => {
  it("区分ごとに問い合わせ、指定した順にまとめる", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      const type = new URL(url.toString(), "http://localhost").searchParams.get("type");
      const body = type === "CUSTOMER" ? [{ id: "CUST-1", type }] : type === "BOTH" ? [{ id: "BOTH-1", type }] : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const list = await fetchPartnersOfTypes<{ id: string }>(["CUSTOMER", "BOTH"]);

    expect(list.map((p) => p.id)).toEqual(["CUST-1", "BOTH-1"]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// 伝票の取引先の選択肢が、兼用(BOTH)を含めて取得し、取引停止を除いていることを、画面のコードで確かめる
// (伝票を増やす・取引先の選択欄を変える時に、同じ書き方に揃える)
describe("BUG-066・BUG-067: 伝票の取引先の選択肢の書き方", () => {
  const APP_DIR = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(APP_DIR, p), "utf8");

  it.each([
    "sales/quotes/_hooks/useQuotes.ts",
    "sales/orders/_hooks/useOrders.ts",
    "sales/invoices/_hooks/useSalesInvoices.ts",
    "sales/billing/_hooks/useBilling.ts",
    "purchase/requisitions/_hooks/usePurchaseRequisitionOperations.ts",
    "purchase/orders/_hooks/usePurchaseOrderOperations.ts",
    "purchase/receipts/_hooks/usePurchaseRecognitions.ts",
    "purchase/payment/_hooks/usePayment.ts",
  ])("%s は取引先を区分1つだけで取得せず、兼用(BOTH)を含める", (file) => {
    const text = read(file);
    expect(text).not.toMatch(/\/api\/partners\?type=(CUSTOMER|SUPPLIER)"/);
    expect(text).toMatch(/fetchPartnersOfTypes[^\n]*"BOTH"/);
  });

  it.each([
    "sales/quotes/_components/QuoteBasicFields.tsx",
    "sales/orders/_components/OrderBasicFields.tsx",
    "sales/invoices/_components/SalesInvoiceBasicFields.tsx",
    "sales/billing/_components/CreateBillingModal.tsx",
    "sales/billing/_components/CashReceiptsPanel.tsx",
    "purchase/requisitions/_components/PurchaseRequisitionForm.tsx",
    "purchase/orders/_components/PurchaseOrderForm.tsx",
    "purchase/receipts/_components/PurchaseRecognitionBasicFields.tsx",
    "purchase/payment/_components/CreatePaymentModal.tsx",
  ])("%s の取引先の選択肢は、取引停止を除いている(selectablePartners)", (file) => {
    expect(read(file)).toContain("selectablePartners(");
  });
});
