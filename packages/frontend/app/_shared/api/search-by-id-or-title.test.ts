import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchListByIdOrTitle } from "./search-by-id-or-title";

const rows = [
  { id: "SO-0001", title: "製品X 納入" },
  { id: "SO-0002", title: "製品Y 納入" },
];

// 一覧APIの検索(id・title)は「両方に一致」するものだけを返す(Backendと同じ)
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = new URL(url.toString(), "http://localhost");
      const id = u.searchParams.get("id");
      const title = u.searchParams.get("title");
      const body = rows.filter((r) => (!id || r.id.includes(id)) && (!title || r.title.includes(title)));
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchListByIdOrTitle: BUG-064 番号・件名のどちらかに一致するものを探す", () => {
  it("番号で探すと見つかる(件名が一致しなくても0件にならない)", async () => {
    expect((await fetchListByIdOrTitle<{ id: string }>("/api/sales-orders?status=APPROVED", "SO-0002")).map((r) => r.id)).toEqual(["SO-0002"]);
  });

  it("件名で探すと見つかる", async () => {
    expect((await fetchListByIdOrTitle<{ id: string }>("/api/sales-orders?status=APPROVED", "製品X")).map((r) => r.id)).toEqual(["SO-0001"]);
  });

  it("番号・件名の両方で見つかったものは1件にまとめる", async () => {
    expect((await fetchListByIdOrTitle<{ id: string }>("/api/sales-orders?status=APPROVED", "0")).map((r) => r.id)).toEqual(["SO-0001", "SO-0002"]);
  });

  it("検索の文字が無ければ1回だけ問い合わせて全件を返す", async () => {
    expect(await fetchListByIdOrTitle<{ id: string }>("/api/sales-orders?status=APPROVED", "")).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
