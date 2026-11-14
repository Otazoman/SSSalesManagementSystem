import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PreviewRenderer } from "./PreviewRenderer";
import { PREVIEW_SPECS } from "./preview-specs";

// BUG-089: 承認のプレビューを、全ての申請の種類で全ての項目で出す

const NAMES = {
  "partner:P-1": "テスト商事",
  "item:ITEM-1": "テスト品目",
  "employee:E001": "営業太郎",
  "unit:PCS": "個",
};

// 伝票の見本データ(ヘッダー + 明細)。DB の行の形({header, items})
function documentSample(targetType: string) {
  const spec = PREVIEW_SPECS[targetType];
  const header: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(spec.header)) {
    if (field.ref === "partner") header[key] = "P-1";
    else if (field.ref === "employee") header[key] = "E001";
    else if (field.format === "currency" || field.format === "number") header[key] = 1000;
    else if (field.format === "date") header[key] = "2026-11-14";
    else if (field.format === "boolean") header[key] = false;
    else if (!field.ref) header[key] = `値-${key}`;
  }
  const items = [{ id: "I-1", itemId: "ITEM-1", itemName: "テスト品目", quantity: 2, unitCode: "PCS", unitPrice: 500 }];
  return { header, items };
}

const DOCUMENT_TYPES = [
  "sales_quotes",
  "sales_orders",
  "sales_invoices",
  "purchase_requisitions",
  "purchase_orders",
  "purchase_recognitions",
];

describe("PreviewRenderer: 伝票(BUG-089)", () => {
  for (const targetType of DOCUMENT_TYPES) {
    it(`${targetType}: 「未対応」にならず、ヘッダーの全ての項目と明細を日本語のラベル・名前つきで出す`, () => {
      render(<PreviewRenderer targetType={targetType} mode="task" newData={documentSample(targetType)} displayNames={NAMES} />);
      expect(screen.queryByText(/未対応/)).toBeNull();
      for (const field of Object.values(PREVIEW_SPECS[targetType].header)) {
        expect(screen.getAllByText(`${field.label}:`).length).toBeGreaterThan(0);
      }
      expect(screen.getAllByText("テスト商事(P-1)").length).toBeGreaterThan(0);
      expect(screen.getByText("明細(1件):")).toBeInTheDocument();
      expect(screen.getByText("テスト品目(ITEM-1)")).toBeInTheDocument();
      expect(screen.getByText("個(PCS)")).toBeInTheDocument();
    });
  }

  it("申請の時に退避した保存データ(平らな形で items を持つ)も、同じように出す", () => {
    const saved = { id: "QT-1", title: "件名A", partnerId: "P-1", customerId: "P-1", items: [{ itemId: "ITEM-1", quantity: 1 }] };
    render(<PreviewRenderer targetType="sales_quotes" mode="task" newData={saved} displayNames={NAMES} />);
    expect(screen.getByText("件名A")).toBeInTheDocument();
    expect(screen.getByText("テスト品目(ITEM-1)")).toBeInTheDocument();
    // 保存データの別名(customerId)は「その他」に出さない
    expect(screen.queryByText("その他:")).toBeNull();
  });

  it("変更申請: 変わったヘッダーの項目を強調して変更前の値を出し、明細の追加・削除・変更を行ごとに出す", () => {
    const oldData = {
      header: { id: "SO-1", title: "旧件名", partnerId: "P-1", totalAmount: 1000 },
      items: [
        { id: "I-1", itemId: "ITEM-1", quantity: 1 },
        { id: "I-2", itemId: "ITEM-2", quantity: 5 },
      ],
    };
    const newData = {
      header: { id: "SO-1", title: "新件名", partnerId: "P-1", totalAmount: 1000 },
      items: [
        { id: "I-1", itemId: "ITEM-1", quantity: 3 },
        { id: "I-3", itemId: "ITEM-3", quantity: 7 },
      ],
    };
    const { container } = render(
      <PreviewRenderer targetType="sales_orders" mode="history" newData={newData} oldData={oldData} isUpdate displayNames={NAMES} />,
    );
    expect(screen.getByText("新件名")).toBeInTheDocument();
    expect(screen.getByText("旧件名")).toBeInTheDocument();
    const changedHeader = container.querySelectorAll("div[data-changed]");
    expect([...changedHeader].map((el) => el.textContent)).toEqual([expect.stringContaining("件名")]);

    const rows = container.querySelectorAll("tr[data-row-state]");
    const states = [...rows].map((r) => r.getAttribute("data-row-state"));
    expect(states).toEqual(["same", "added", "removed"]);
    expect(within(rows[1] as HTMLElement).getByText("追加")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("削除")).toBeInTheDocument();
    // 数量が 1 → 3 に変わったセルを強調する
    const changedCell = (rows[0] as HTMLElement).querySelector("td[data-changed]");
    expect(changedCell?.textContent).toContain("3");
    expect(changedCell?.textContent).toContain("変更前: 1");
  });

  it("設定に無い項目は、末尾の「その他」に項目名のまま出す(入れ子のデータも出す)", () => {
    render(
      <PreviewRenderer
        targetType="purchase_orders"
        mode="task"
        newData={{ header: { id: "PO-1", newField: "新しい値", nested: { a: 1 } }, items: [] }}
      />,
    );
    expect(screen.getByText("その他:")).toBeInTheDocument();
    expect(screen.getByText("newField:")).toBeInTheDocument();
    expect(screen.getByText("新しい値")).toBeInTheDocument();
    expect(screen.getByText("nested:")).toBeInTheDocument();
  });

  it("データが空の時だけ「未対応」を出す", () => {
    render(<PreviewRenderer targetType="sales_quotes" mode="task" newData={{}} />);
    expect(screen.getByText(/未対応/)).toBeInTheDocument();
  });

  it("添付を一覧で出し、変更申請では追加・削除を出す", () => {
    render(
      <PreviewRenderer
        targetType="sales_quotes"
        mode="history"
        newData={{ id: "QT-1", attachments: [{ fileName: "新しい資料.pdf" }] }}
        oldData={{ header: { id: "QT-1" }, attachments: [{ fileName: "古い資料.pdf" }] }}
        isUpdate
      />,
    );
    expect(screen.getByText(/新しい資料\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/古い資料\.pdf/)).toBeInTheDocument();
    expect(screen.getByText("追加")).toBeInTheDocument();
    expect(screen.getByText("削除")).toBeInTheDocument();
  });
});

describe("PreviewRenderer: 在庫(BUG-089)", () => {
  const W = { "warehouse:WH-1": "本社倉庫", "location:LOC-1": "A-01", "item:ITEM-1": "テスト品目", "partner:P-1": "テスト商事" };
  const cases: Array<{ targetType: string; specKey: string; data: unknown; expectText: string[] }> = [
    {
      targetType: "inventory_stock",
      specKey: "inventory_stock:receipt",
      data: { header: { id: "R-1", receivedDate: "2026-11-14", partnerId: "P-1" }, items: [{ itemId: "ITEM-1", warehouseId: "WH-1", locationId: "LOC-1", receivedQuantity: 3, inspectionStatus: "PASSED" }] },
      expectText: ["入庫番号:", "テスト商事(P-1)", "本社倉庫(WH-1)", "A-01(LOC-1)", "良品"],
    },
    {
      targetType: "inventory_stock",
      specKey: "inventory_stock:shipment",
      data: { header: { id: "S-1", shippedDate: "2026-11-14", partnerId: "P-1" }, items: [{ itemId: "ITEM-1", shippedQuantity: 2, qualityStatus: "DAMAGED" }] },
      expectText: ["出庫番号:", "テスト品目(ITEM-1)", "破損品"],
    },
    {
      targetType: "inventory_stock",
      specKey: "inventory_stock:reclassification",
      data: { header: { id: "RC-1", itemId: "ITEM-1", fromQualityStatus: "NORMAL", toQualityStatus: "DAMAGED", quantity: 1 } },
      expectText: ["変更前の品質区分:", "良品", "破損品"],
    },
    {
      targetType: "inventory_stock",
      specKey: "inventory_stock:disposal",
      data: { header: { id: "D-1", itemId: "ITEM-1", warehouseId: "WH-1", quantity: 1, memo: "割れた" } },
      expectText: ["廃棄理由:", "割れた", "本社倉庫(WH-1)"],
    },
    {
      targetType: "inventory_stock",
      specKey: "inventory_stock:return",
      data: { header: { id: "RT-1", itemId: "ITEM-1", direction: "OUTBOUND", quantity: 1 } },
      expectText: ["返品の方向:", "仕入先へ返品"],
    },
    {
      targetType: "inventory_instructions",
      specKey: "inventory_instructions:shipment",
      data: { header: { id: "SI-1", instructedShipDate: "2026-11-20", warehouseId: "WH-1" }, items: [{ itemId: "ITEM-1", instructedQuantity: 5 }] },
      expectText: ["出荷指示番号:", "出荷元の倉庫:", "指示数量"],
    },
    {
      targetType: "inventory_instructions",
      specKey: "inventory_instructions:receipt",
      data: { header: { id: "RI-1", instructedReceiveDate: "2026-11-20", warehouseId: "WH-1" }, items: [{ itemId: "ITEM-1", instructedQuantity: 5 }] },
      expectText: ["入荷指示番号:", "入荷先の倉庫:"],
    },
    {
      targetType: "inventory_audit",
      specKey: "inventory_audit",
      data: { audit: { id: "A-1", itemId: "ITEM-1", theoreticalQuantity: 10, countedQuantity: 8, differenceQuantity: -2 } },
      expectText: ["理論数量:", "実棚数量:", "-2"],
    },
  ];

  for (const { targetType, specKey, data, expectText } of cases) {
    it(`${specKey}: データから伝票を見分け、全ての項目を名前つきで出す`, async () => {
      const { resolvePreviewSpecKey } = await import("./preview-specs");
      expect(resolvePreviewSpecKey(targetType, data)).toBe(specKey);
      render(<PreviewRenderer targetType={targetType} mode="task" newData={data} displayNames={W} />);
      expect(screen.queryByText(/未対応/)).toBeNull();
      for (const field of Object.values(PREVIEW_SPECS[specKey].header)) {
        expect(screen.getAllByText(`${field.label}:`).length).toBeGreaterThan(0);
      }
      for (const text of expectText) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    });
  }
});

describe("PreviewRenderer: マスタ(BUG-089)", () => {
  const MASTER_TYPES = [
    "master_partners",
    "master_contacts",
    "master_units",
    "master_locations",
    "master_prices",
    "master_products",
    "master_accounts",
    "master_warehouses",
    "master_business_locations",
    "master_structures",
  ];

  for (const targetType of MASTER_TYPES) {
    it(`${targetType}: 「未対応」にならず、全ての項目を日本語のラベルで出す`, () => {
      const spec = PREVIEW_SPECS[targetType];
      const data = Object.fromEntries(Object.keys(spec.header).map((k) => [k, `値-${k}`]));
      render(<PreviewRenderer targetType={targetType} mode="task" newData={data} />);
      expect(screen.queryByText(/未対応/)).toBeNull();
      for (const field of Object.values(spec.header)) {
        expect(screen.getAllByText(`${field.label}:`).length).toBeGreaterThan(0);
      }
    });
  }

  it("取引先: 振込先口座の一覧を表で出し、変更申請では変わった項目を強調する", () => {
    const { container } = render(
      <PreviewRenderer
        targetType="master_partners"
        mode="history"
        isUpdate
        newData={{ id: "P-1", name: "新しい社名", type: "CUSTOMER", bankAccounts: [{ bankName: "テスト銀行", accountNumber: "1234567" }] }}
        oldData={{ id: "P-1", name: "古い社名", type: "CUSTOMER" }}
      />,
    );
    expect(screen.getByText("振込先口座:")).toBeInTheDocument();
    expect(screen.getByText("テスト銀行")).toBeInTheDocument();
    expect(screen.getAllByText("得意先").length).toBeGreaterThan(0);
    const changed = [...container.querySelectorAll("div[data-changed]")].map((el) => el.textContent ?? "");
    expect(changed.some((t) => t.includes("取引先名") && t.includes("古い社名"))).toBe(true);
    expect(changed.some((t) => t.includes("振込先口座"))).toBe(true);
  });

  it("設定の無い申請の種類でも、全ての項目を「その他」に出す(未対応にしない)", () => {
    render(<PreviewRenderer targetType="unknown_type" mode="task" newData={{ code: "X-1", label: "新しい種類" }} />);
    expect(screen.queryByText(/未対応/)).toBeNull();
    expect(screen.getByText("その他:")).toBeInTheDocument();
    expect(screen.getByText("新しい種類")).toBeInTheDocument();
  });
});
