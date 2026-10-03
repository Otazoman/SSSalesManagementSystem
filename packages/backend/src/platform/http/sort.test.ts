import { describe, it, expect } from "vitest";
import * as schema from "../../db/schema";
import { buildOrderBy, applyInMemorySort, SortColumnMap } from "./sort";

const ROLES_SORT_COLUMNS: SortColumnMap = {
  id: schema.roles.id,
  name: schema.roles.name,
};

describe("buildOrderBy", () => {
  it("sortBy未指定の場合はundefinedを返す", () => {
    expect(buildOrderBy({}, ROLES_SORT_COLUMNS)).toBeUndefined();
  });

  it("許可されていないキーのみの場合はundefinedを返す", () => {
    expect(buildOrderBy({ sortBy: "unknown" }, ROLES_SORT_COLUMNS)).toBeUndefined();
  });

  it("単一キー指定の場合は要素数1の配列を返す(既存の単一ソートと互換)", () => {
    const result = buildOrderBy({ sortBy: "name", sortOrder: "desc" }, ROLES_SORT_COLUMNS);
    expect(result).toHaveLength(1);
  });

  it("sortOrderが'desc'以外(未指定含む)の場合は昇順として1件のSQL句を返す", () => {
    const asc = buildOrderBy({ sortBy: "name" }, ROLES_SORT_COLUMNS);
    const desc = buildOrderBy({ sortBy: "name", sortOrder: "desc" }, ROLES_SORT_COLUMNS);
    expect(asc).toHaveLength(1);
    expect(desc).toHaveLength(1);
  });

  it("追加要望J-1-a: カンマ区切りで複数キーを指定すると同じ数の要素を返す(優先順位はキーの並び順)", () => {
    const result = buildOrderBy(
      { sortBy: "name,id", sortOrder: "desc,asc" },
      ROLES_SORT_COLUMNS,
    );
    expect(result).toHaveLength(2);
  });

  it("複数キーのうち許可されていないキーは無視され、許可されたキーだけが残る", () => {
    const result = buildOrderBy(
      { sortBy: "name,unknown,id", sortOrder: "desc,asc,asc" },
      ROLES_SORT_COLUMNS,
    );
    expect(result).toHaveLength(2);
  });

  it("sortOrderの要素数がsortByより少ない場合、対応が無いキーはascにフォールバックする", () => {
    const result = buildOrderBy({ sortBy: "name,id", sortOrder: "desc" }, ROLES_SORT_COLUMNS);
    expect(result).toHaveLength(2);
  });
});

interface FakeRole {
  id: string;
  name: string;
  priority: number | null;
}

const IN_MEMORY_COLUMNS: Record<string, (item: FakeRole) => unknown> = {
  id: (r) => r.id,
  name: (r) => r.name,
  priority: (r) => r.priority,
};

describe("applyInMemorySort", () => {
  const items: FakeRole[] = [
    { id: "b", name: "manager", priority: 1 },
    { id: "a", name: "manager", priority: 2 },
    { id: "c", name: "leader", priority: null },
  ];

  it("sortBy未指定の場合は元の配列をそのまま返す", () => {
    expect(applyInMemorySort(items, {}, IN_MEMORY_COLUMNS)).toEqual(items);
  });

  it("許可されていないキーのみの場合は元の配列をそのまま返す", () => {
    expect(applyInMemorySort(items, { sortBy: "unknown" }, IN_MEMORY_COLUMNS)).toEqual(items);
  });

  it("単一キーで昇順ソートする(nullは末尾)", () => {
    const result = applyInMemorySort(items, { sortBy: "name" }, IN_MEMORY_COLUMNS);
    expect(result.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("追加要望J-1-a: 複数キー指定時は先頭キーが同値の場合のみ次のキーで比較する(Excelの複数キーソートと同じ優先順位)", () => {
    // name(desc): manager,manager,leader → 同値のmanager2件はpriority(asc)で比較
    const result = applyInMemorySort(
      items,
      { sortBy: "name,priority", sortOrder: "desc,asc" },
      IN_MEMORY_COLUMNS,
    );
    expect(result.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("複数キーのうち許可されていないキーは無視され、残りのキーだけで比較する", () => {
    const result = applyInMemorySort(
      items,
      { sortBy: "name,unknown", sortOrder: "asc,asc" },
      IN_MEMORY_COLUMNS,
    );
    expect(result.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});
