import { describe, it, expect } from "vitest";
import { buildApprovalDocumentHref } from "./document-link";

// REQ-016: 承認のプレビューの「伝票を開く」のリンク先
describe("buildApprovalDocumentHref", () => {
  it.each([
    ["sales_quotes", "/sales/quotes", "Q-1", "/sales/quotes?editId=Q-1"],
    ["sales_orders", "/sales/orders", "SO-1", "/sales/orders?editId=SO-1"],
    ["sales_invoices", "/sales/invoices", "SI-1", "/sales/invoices?editId=SI-1"],
    ["purchase_requisitions", "/purchase/requisitions", "PR-1", "/purchase/requisitions?editId=PR-1"],
    ["purchase_orders", "/purchase/orders", "PO-1", "/purchase/orders?editId=PO-1"],
    ["purchase_recognitions", "/purchase/receipts", "RC-1", "/purchase/receipts?editId=RC-1"],
    ["master_units", "/master/units", "PCS", "/master/units?editId=PCS"],
    ["master_partners", "/master/partners/", "P 1", "/master/partners?editId=P%201"],
  ])("%s は editId で開く", (targetType, path, id, expected) => {
    expect(buildApprovalDocumentHref(targetType, path, id)).toBe(expected);
  });

  it.each([
    ["inventory_instructions", "/inventory/receiving", "/inventory/receiving?openId=X-1&openKind=instruction"],
    ["inventory_instructions", "/inventory/shipping", "/inventory/shipping?openId=X-1&openKind=instruction"],
    ["inventory_stock", "/inventory/receiving", "/inventory/receiving?openId=X-1&openKind=receipt"],
    ["inventory_stock", "/inventory/shipping", "/inventory/shipping?openId=X-1&openKind=shipment"],
  ])("%s(%s)は参照用のカード(openId)で開く", (targetType, path, expected) => {
    expect(buildApprovalDocumentHref(targetType, path, "X-1")).toBe(expected);
  });

  it("在庫・棚卸の画面は参照用のカード(openId)で開く。品質区分変更・廃棄・返品は種類を付けず、画面が探す", () => {
    expect(buildApprovalDocumentHref("inventory_audit", "/inventory/audit", "X-1")).toBe("/inventory/audit?openId=X-1&openKind=audit");
    expect(buildApprovalDocumentHref("inventory_stock", "/inventory/audit", "X-1")).toBe("/inventory/audit?openId=X-1");
  });

  it("請求は詳細のモーダル(openId)で開く(REQ-017)", () => {
    expect(buildApprovalDocumentHref("sales_billing", "/sales/billing", "BL-1")).toBe("/sales/billing?openId=BL-1");
  });

  it("入金・支払の消込は画面だけを開く(REQ-018)", () => {
    expect(buildApprovalDocumentHref("sales_payment_receipts", "/sales/billing", "uuid-1")).toBe("/sales/billing");
    expect(buildApprovalDocumentHref("purchase_payment_disbursements", "/purchase/payment", "uuid-2")).toBe("/purchase/payment");
  });

  it("一時保管は在庫・棚卸管理の一時保管タブで開く(REQ-011(2))", () => {
    expect(buildApprovalDocumentHref("inventory_temporary_holdings", "/inventory/audit", "M-1")).toBe(
      "/inventory/audit?openId=M-1&openKind=holding",
    );
  });

  it("画面のパスが解決できない時はリンクを出さない", () => {
    expect(buildApprovalDocumentHref("sales_quotes", null, "Q-1")).toBeNull();
  });
});
