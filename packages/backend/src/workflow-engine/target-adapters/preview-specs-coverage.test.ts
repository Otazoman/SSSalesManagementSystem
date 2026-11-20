import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../../db/schema";
import { getTargetAdapter, listTargetTypes } from "./registry";
import { PREVIEW_SPECS } from "../../../../frontend/app/workflow/_shared/preview-specs";

// BUG-089: 承認のプレビューの設定(画面側の preview-specs.ts)の漏れを防ぐ。
// DB の表の全ての列が、プレビューの「表示する項目」か「表示しない項目(理由つき)」に入っていること。
// フォームに項目を足して DB の列を足した時に、プレビューの設定への追加を忘れると、このテストが失敗する。

// 登録されている全ての申請の種類(registry.ts の targetType)
const TARGET_TYPES_WITH_SPECS = listTargetTypes();

// 1つの申請の種類に複数の伝票が同居している種類(画面はデータの項目から伝票を見分けて設定を選ぶ)
const SPEC_KEYS_BY_TARGET_TYPE: Record<string, string[]> = {
  inventory_stock: [
    "inventory_stock:receipt",
    "inventory_stock:shipment",
    "inventory_stock:reclassification",
    "inventory_stock:disposal",
    "inventory_stock:return",
  ],
  inventory_instructions: ["inventory_instructions:shipment", "inventory_instructions:receipt"],
};
const specKeysOf = (targetType: string) => SPEC_KEYS_BY_TARGET_TYPE[targetType] ?? [targetType];

function columnsOf(tableName: string): string[] {
  const table = (schema as Record<string, unknown>)[tableName];
  expect(table, `schema.${tableName} が見つからない`).toBeDefined();
  return Object.keys(getTableColumns(table as Parameters<typeof getTableColumns>[0]));
}

describe("承認のプレビューの設定(BUG-089)", () => {
  it("申請の種類が登録されている(このテストが空にならない)", () => {
    expect(TARGET_TYPES_WITH_SPECS.length).toBeGreaterThanOrEqual(19);
  });

  for (const targetType of TARGET_TYPES_WITH_SPECS) {
    it(`${targetType}: 設定があり、承認タスク・申請履歴のプレビューを返す`, () => {
      for (const key of specKeysOf(targetType)) {
        expect(PREVIEW_SPECS[key], `${key} の設定が preview-specs.ts に無い`).toBeDefined();
      }
      const adapter = getTargetAdapter(targetType);
      expect(typeof adapter?.getTaskPreview).toBe("function");
      expect(typeof adapter?.getHistoryPreview).toBe("function");
    });

    it(`${targetType}: ヘッダー・明細の表の全ての列が、表示する項目か表示しない項目に入っている`, () => {
      for (const key of specKeysOf(targetType)) {
        const spec = PREVIEW_SPECS[key];
        const missingHeader = columnsOf(spec.table).filter((c) => !(c in spec.header) && !(c in spec.hidden));
        expect(missingHeader, `${spec.table} の列のうち、プレビューの設定に無いもの`).toEqual([]);
        if (spec.items) {
          const items = spec.items;
          const missingItems = columnsOf(items.table).filter((c) => !(c in items.columns) && !(c in items.hidden));
          expect(missingItems, `${items.table} の列のうち、プレビューの設定に無いもの`).toEqual([]);
        }
      }
    });
  }
});
