import { inArray } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { fetchInChunks } from "../../../platform/repository/chunked-fetch";

// BUG-089: 承認のプレビューで、番号(取引先・倉庫・品目など)ではなく名前を出すため、プレビューの中の番号を集めて名前を引く。
// 名前は、表ごとに1回ずつまとめて引く(PERF-02・03 と同じく、行ごとに問い合わせない)。
// 結果は「種類:番号」→名前(例: "partner:P-1" → "テスト商事")。画面は「名前(番号)」で出す
// (画面のプレビューの設定 preview-specs.ts の ref と同じ種類名)。

export type PreviewRef =
  | "partner"
  | "warehouse"
  | "location"
  | "item"
  | "unit"
  | "account"
  | "taxCategory"
  | "project"
  | "employee"
  | "user"
  | "department"
  | "businessLocation";

// 項目名 → 名前の種類(伝票・マスタ・在庫で同じ項目名を使っている)
const REF_BY_KEY: Record<string, PreviewRef> = {
  partnerId: "partner",
  customerId: "partner",
  supplierId: "partner",
  warehouseId: "warehouse",
  fromWarehouseId: "warehouse",
  toWarehouseId: "warehouse",
  deliveryWarehouseId: "warehouse",
  sourceWarehouseId: "warehouse",
  destinationWarehouseId: "warehouse",
  locationId: "location",
  fromLocationId: "location",
  toLocationId: "location",
  itemId: "item",
  parentItemId: "item",
  childItemId: "item",
  unitCode: "unit",
  baseUnitCode: "unit",
  accountCode: "account",
  taxCategoryCode: "taxCategory",
  projectId: "project",
  salesPersonEmployeeNumber: "employee",
  inputPersonEmployeeNumber: "employee",
  purchasePersonEmployeeNumber: "employee",
  applicantId: "user",
  companyDepartment: "department",
  company_department: "department",
  departmentSurrogateId: "department",
  deliveryLocationId: "businessLocation",
  businessLocationId: "businessLocation",
};

function collect(value: unknown, refs: Map<PreviewRef, Set<string>>, depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) collect(v, refs, depth + 1);
    return;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const ref = REF_BY_KEY[key];
    if (ref && (typeof v === "string" || typeof v === "number") && String(v) !== "") {
      if (!refs.has(ref)) refs.set(ref, new Set());
      refs.get(ref)!.add(String(v));
    } else if (v !== null && typeof v === "object") {
      collect(v, refs, depth + 1);
    }
  }
}

/** プレビューのデータに含まれる「種類:番号」の一覧 */
export function collectPreviewRefKeys(previews: unknown[]): Set<string> {
  const refs = new Map<PreviewRef, Set<string>>();
  for (const p of previews) collect(p, refs);
  const keys = new Set<string>();
  for (const [ref, ids] of refs) for (const id of ids) keys.add(`${ref}:${id}`);
  return keys;
}

type NameRow = { key: string | null; name: string | null };

/** プレビュー(複数)に含まれる番号の名前を、表ごとに1回ずつまとめて引く。結果は「種類:番号」→名前 */
export async function resolvePreviewDisplayNames(
  db: any,
  previews: unknown[],
): Promise<Record<string, string>> {
  const refs = new Map<PreviewRef, Set<string>>();
  for (const p of previews) collect(p, refs);
  const names: Record<string, string> = {};
  const add = (ref: PreviewRef, rows: NameRow[]) => {
    for (const row of rows) {
      if (row.key && row.name) names[`${ref}:${row.key}`] = row.name;
    }
  };
  const lookups: Record<PreviewRef, (ids: string[]) => Promise<NameRow[]>> = {
    partner: (ids) => db.select({ key: schema.partners.id, name: schema.partners.name }).from(schema.partners).where(inArray(schema.partners.id, ids)),
    warehouse: (ids) => db.select({ key: schema.warehouses.id, name: schema.warehouses.name }).from(schema.warehouses).where(inArray(schema.warehouses.id, ids)),
    location: (ids) => db.select({ key: schema.locations.id, name: schema.locations.name }).from(schema.locations).where(inArray(schema.locations.id, ids)),
    item: (ids) => db.select({ key: schema.items.id, name: schema.items.name }).from(schema.items).where(inArray(schema.items.id, ids)),
    unit: (ids) => db.select({ key: schema.units.code, name: schema.units.name }).from(schema.units).where(inArray(schema.units.code, ids)),
    account: (ids) => db.select({ key: schema.accounts.code, name: schema.accounts.name }).from(schema.accounts).where(inArray(schema.accounts.code, ids)),
    taxCategory: (ids) =>
      db.select({ key: schema.taxCategories.code, name: schema.taxCategories.name }).from(schema.taxCategories).where(inArray(schema.taxCategories.code, ids)),
    project: (ids) => db.select({ key: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(inArray(schema.projects.id, ids)),
    employee: (ids) =>
      db.select({ key: schema.users.employeeNumber, name: schema.users.name }).from(schema.users).where(inArray(schema.users.employeeNumber, ids)),
    user: (ids) => db.select({ key: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, ids)),
    // 部門は、保存している値が内部ID(surrogateId)の場合と部門コード(id)の場合があるため両方で引く
    department: async (ids) => [
      ...(await db
        .select({ key: schema.departments.surrogateId, name: schema.departments.name })
        .from(schema.departments)
        .where(inArray(schema.departments.surrogateId, ids))),
      ...(await db
        .select({ key: schema.departments.id, name: schema.departments.name })
        .from(schema.departments)
        .where(inArray(schema.departments.id, ids))),
    ],
    businessLocation: (ids) =>
      db
        .select({ key: schema.businessLocations.id, name: schema.businessLocations.name })
        .from(schema.businessLocations)
        .where(inArray(schema.businessLocations.id, ids)),
  };
  for (const [ref, ids] of refs) {
    add(ref, await fetchInChunks([...ids], (chunk) => lookups[ref](chunk)));
  }
  return names;
}

/** まとめて引いた名前のうち、そのプレビューに含まれる番号の分だけを返す(行ごとの応答に付ける) */
export function pickDisplayNames(names: Record<string, string>, previews: unknown[]): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of collectPreviewRefKeys(previews)) {
    if (names[key]) picked[key] = names[key];
  }
  return picked;
}
