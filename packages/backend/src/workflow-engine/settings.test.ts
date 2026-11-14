import { describe, it, expect } from "vitest";
import * as settings from "./settings";

// PERF-04: is〜WorkflowGloballyEnabled(kv) の中身を readWorkflowFlags に寄せても、
// 各関数が読む会社設定のキーと判定(true / "true" だけが ON、それ以外・失敗は OFF)が変わらないこと
const CASES: Array<[keyof typeof settings, string]> = [
  ["isPartnerWorkflowGloballyEnabled", "is_partner_approval_enabled"],
  ["isQuoteWorkflowGloballyEnabled", "is_quote_approval_enabled"],
  ["isPartnerContactWorkflowGloballyEnabled", "is_partner_contact_approval_enabled"],
  ["isUnitWorkflowGloballyEnabled", "is_unit_approval_enabled"],
  ["isLocationWorkflowGloballyEnabled", "is_location_approval_enabled"],
  ["isProductPriceWorkflowGloballyEnabled", "is_product_price_approval_enabled"],
  ["isProductWorkflowGloballyEnabled", "is_product_approval_enabled"],
  ["isAccountWorkflowGloballyEnabled", "is_account_approval_enabled"],
  ["isWarehouseWorkflowGloballyEnabled", "is_warehouse_approval_enabled"],
  ["isBusinessLocationWorkflowGloballyEnabled", "is_business_location_approval_enabled"],
  ["isItemStructureWorkflowGloballyEnabled", "is_item_structure_approval_enabled"],
  ["isReceivingWorkflowGloballyEnabled", "is_receiving_approval_enabled"],
  ["isShippingWorkflowGloballyEnabled", "is_shipping_approval_enabled"],
  ["isInventoryAdjustmentWorkflowGloballyEnabled", "is_inventory_approval_enabled"],
  ["isDamageWorkflowGloballyEnabled", "is_damage_approval_enabled"],
  ["isDisposalWorkflowGloballyEnabled", "is_disposal_approval_enabled"],
  ["isReturnWorkflowGloballyEnabled", "is_return_approval_enabled"],
  ["isShippingInstructionWorkflowGloballyEnabled", "is_shipping_instruction_approval_enabled"],
  ["isShippingResultWorkflowGloballyEnabled", "is_shipping_result_approval_enabled"],
  ["isReceivingInstructionWorkflowGloballyEnabled", "is_receiving_instruction_approval_enabled"],
  ["isReceivingResultWorkflowGloballyEnabled", "is_receiving_result_approval_enabled"],
  ["isSalesOrderWorkflowGloballyEnabled", "is_sales_order_approval_enabled"],
  ["isPurchaseRequisitionWorkflowGloballyEnabled", "is_purchase_requisition_approval_enabled"],
  ["isPurchaseOrderWorkflowGloballyEnabled", "is_purchase_order_approval_enabled"],
  ["isSalesInvoiceWorkflowGloballyEnabled", "is_sales_approval_enabled"],
  ["isPurchaseRecognitionWorkflowGloballyEnabled", "is_purchase_approval_enabled"],
];

function fakeKv(value: string | null | Error) {
  return {
    get: async () => {
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

describe("is〜WorkflowGloballyEnabled(kv)", () => {
  for (const [fnName, configKey] of CASES) {
    const fn = settings[fnName] as (kv: unknown) => Promise<boolean>;

    it(`${fnName} は ${configKey} だけを見る`, async () => {
      expect(await fn(fakeKv(JSON.stringify({ [configKey]: true })))).toBe(true);
      expect(await fn(fakeKv(JSON.stringify({ [configKey]: "true" })))).toBe(true);
      expect(await fn(fakeKv(JSON.stringify({ [configKey]: false })))).toBe(false);
      expect(await fn(fakeKv(JSON.stringify({ [configKey]: "false" })))).toBe(false);
      expect(await fn(fakeKv(JSON.stringify({ [configKey]: 1 })))).toBe(false);
      // 他のスイッチが ON でも影響しない
      const others = Object.fromEntries(CASES.filter(([, k]) => k !== configKey).map(([, k]) => [k, true]));
      expect(await fn(fakeKv(JSON.stringify(others)))).toBe(false);
    });

    it(`${fnName} は設定が無い・壊れている・読めない時に false`, async () => {
      expect(await fn(undefined)).toBe(false);
      expect(await fn(fakeKv(null))).toBe(false);
      expect(await fn(fakeKv(""))).toBe(false);
      expect(await fn(fakeKv("   "))).toBe(false);
      expect(await fn(fakeKv("{broken"))).toBe(false);
      expect(await fn(fakeKv("null"))).toBe(false);
      expect(await fn(fakeKv("5"))).toBe(false);
      expect(await fn(fakeKv(new Error("KV error")))).toBe(false);
    });
  }
});

describe("readWorkflowFlags(config)", () => {
  it("解釈済みの会社設定から、26個のスイッチをまとめて返す", () => {
    const flags = (settings as Record<string, unknown>).readWorkflowFlags as
      | ((config: unknown) => Record<string, boolean>)
      | undefined;
    expect(typeof flags).toBe("function");
    const all = flags!(Object.fromEntries(CASES.map(([, k]) => [k, true])));
    expect(Object.keys(all)).toHaveLength(26);
    expect(Object.values(all).every((v) => v === true)).toBe(true);
    const none = flags!(null);
    expect(Object.keys(none)).toHaveLength(26);
    expect(Object.values(none).every((v) => v === false)).toBe(true);
  });
});
