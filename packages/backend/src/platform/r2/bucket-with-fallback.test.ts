import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { getWithFallback, headWithFallback, deleteFromPair } from "./bucket-with-fallback";
import { deleteOrphanedR2Attachments } from "./delete-orphaned-attachments";

const pair = { primary: env.SALES_ORDERS_BUCKET, legacy: env.QUATES_BUCKET };

describe("bucket-with-fallback(追加要望L-3-a)", () => {
  it("新バケットにあれば新バケットを、無ければ旧バケットを読む。どちらにも無ければnull", async () => {
    await env.QUATES_BUCKET.put("fb-test/legacy.txt", "legacy");
    await env.SALES_ORDERS_BUCKET.put("fb-test/new.txt", "new");
    await env.SALES_ORDERS_BUCKET.put("fb-test/both.txt", "primary-wins");
    await env.QUATES_BUCKET.put("fb-test/both.txt", "legacy-loses");

    expect(await (await getWithFallback(pair, "fb-test/legacy.txt"))!.text()).toBe("legacy");
    expect(await (await getWithFallback(pair, "fb-test/new.txt"))!.text()).toBe("new");
    expect(await (await getWithFallback(pair, "fb-test/both.txt"))!.text()).toBe("primary-wins");
    expect(await getWithFallback(pair, "fb-test/none.txt")).toBeNull();
    expect(await headWithFallback(pair, "fb-test/legacy.txt")).not.toBeNull();
    expect(await headWithFallback(pair, "fb-test/none.txt")).toBeNull();
  });

  it("旧バケットが無い場合(legacy未指定)は新バケットのみ", async () => {
    await env.QUATES_BUCKET.put("fb-test/only-legacy.txt", "x");
    expect(await getWithFallback({ primary: env.SALES_ORDERS_BUCKET }, "fb-test/only-legacy.txt")).toBeNull();
  });

  it("削除は新旧両方から行われる(既存ファイルが旧バケットにあっても消える)", async () => {
    await env.QUATES_BUCKET.put("fb-test/del.txt", "x");
    await env.SALES_ORDERS_BUCKET.put("fb-test/del.txt", "y");
    await deleteFromPair(pair, "fb-test/del.txt");
    expect(await env.QUATES_BUCKET.head("fb-test/del.txt")).toBeNull();
    expect(await env.SALES_ORDERS_BUCKET.head("fb-test/del.txt")).toBeNull();
  });

  it("deleteOrphanedR2Attachmentsは旧バケットにあるファイルも削除する", async () => {
    await env.QUATES_BUCKET.put("fb-test/orphan.txt", "x");
    await deleteOrphanedR2Attachments(
      env.SALES_ORDERS_BUCKET,
      [{ storageType: "R2", attachmentR2Path: "fb-test/orphan.txt" }],
      [],
      env.QUATES_BUCKET,
    );
    expect(await env.QUATES_BUCKET.head("fb-test/orphan.txt")).toBeNull();
  });
});
