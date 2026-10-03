import { describe, it, expect } from "vitest";
import { buildDocumentHref } from "./document-href";
import { PROGRESS_STAGE_KEYS } from "../_types";

describe("buildDocumentHref", () => {
  it("12工程すべての伝票が、それぞれの元の画面のURLに解決される", () => {
    expect(buildDocumentHref("quote", "Q-1")).toBe("/sales/quotes?editId=Q-1");
    expect(buildDocumentHref("sales_order", "SO-1")).toBe("/sales/orders?editId=SO-1");
    expect(buildDocumentHref("sales_invoice", "SI-1")).toBe("/sales/invoices?editId=SI-1");
    expect(buildDocumentHref("billing", "B-1")).toBe("/sales/billing?openId=B-1");
    expect(buildDocumentHref("purchase_request", "PR-1")).toBe("/purchase/requisitions?editId=PR-1");
    expect(buildDocumentHref("purchase_order", "PO-1")).toBe("/purchase/orders?editId=PO-1");
    expect(buildDocumentHref("purchase_recognition", "PC-1")).toBe("/purchase/receipts?editId=PC-1");
    expect(buildDocumentHref("payment", "PAY-1")).toBe("/purchase/payment?openId=PAY-1");
    expect(buildDocumentHref("receipt_instruction", "RI-1")).toBe("/inventory/receiving?openId=RI-1&openKind=instruction");
    expect(buildDocumentHref("item_receipt", "RC-1")).toBe("/inventory/receiving?openId=RC-1&openKind=receipt");
    expect(buildDocumentHref("shipment_instruction", "SHI-1")).toBe("/inventory/shipping?openId=SHI-1&openKind=instruction");
    expect(buildDocumentHref("item_shipment", "SH-1")).toBe("/inventory/shipping?openId=SH-1&openKind=shipment");
  });

  it("全工程キーに対応するURLがある", () => {
    for (const key of PROGRESS_STAGE_KEYS) {
      expect(buildDocumentHref(key, "X")).toMatch(/^\/(sales|purchase|inventory)\/[a-z-]+\?(editId|openId)=X/);
    }
  });

  it("伝票番号は URL エンコードされる", () => {
    expect(buildDocumentHref("quote", "A B/1")).toBe("/sales/quotes?editId=A%20B%2F1");
  });
});
