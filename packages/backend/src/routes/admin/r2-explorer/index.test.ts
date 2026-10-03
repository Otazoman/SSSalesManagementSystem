import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { r2ExplorerRouter } from "./index";

// Item13-a: R2参照機能。SYSTEM_BUCKET/QUATES_BUCKETへ実際にput/get/deleteして検証する
// (acceptance-inspection.test.ts等と同じ、cloudflare:testのMiniflare R2バインディングをそのまま使う方式)

async function callGet(path: string) {
  const ctx = createExecutionContext();
  const res = await r2ExplorerRouter.request(path, {}, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function callPost(path: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await r2ExplorerRouter.request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("GET /buckets", () => {
  it("ブラウズ可能なバケット一覧を返す(systemバケットを含む)", async () => {
    const res = await callGet("/buckets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; label: string }[];
    expect(body.some((b) => b.key === "system")).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(9);
  });
});

describe("GET /objects", () => {
  it("フォルダ・ファイルの一覧を返す", async () => {
    await env.SYSTEM_BUCKET.put("r2-explorer-test/list/a.txt", "content-a", {
      httpMetadata: { contentType: "text/plain" },
    });
    await env.SYSTEM_BUCKET.put("r2-explorer-test/list/sub/b.txt", "content-b");

    const res = await callGet("/objects?bucket=system&prefix=r2-explorer-test/list/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { name: string; type: string }[] };
    expect(body.items.some((i) => i.name === "a.txt" && i.type === "file")).toBe(true);
    expect(body.items.some((i) => i.name === "sub" && i.type === "folder")).toBe(true);
  });

  it("未知のbucketを指定すると400", async () => {
    const res = await callGet("/objects?bucket=nope&prefix=");
    expect(res.status).toBe(400);
  });
});

describe("POST /objects/delete", () => {
  it("正常にファイルを削除する", async () => {
    await env.SYSTEM_BUCKET.put("r2-explorer-test/delete/target.txt", "to-delete");

    const res = await callPost("/objects/delete", {
      bucket: "system",
      key: "r2-explorer-test/delete/target.txt",
    });
    expect(res.status).toBe(200);

    const after = await env.SYSTEM_BUCKET.head("r2-explorer-test/delete/target.txt");
    expect(after).toBeNull();
  });

  it("存在しないファイルを対象にすると404", async () => {
    const res = await callPost("/objects/delete", {
      bucket: "system",
      key: "r2-explorer-test/delete/nope.txt",
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /objects/rename", () => {
  it("正常にファイル名を変更する(内容・content-typeを保持する)", async () => {
    await env.SYSTEM_BUCKET.put("r2-explorer-test/rename/old.txt", "rename-content", {
      httpMetadata: { contentType: "text/plain" },
    });

    const res = await callPost("/objects/rename", {
      bucket: "system",
      oldKey: "r2-explorer-test/rename/old.txt",
      newKey: "r2-explorer-test/rename/new.txt",
    });
    expect(res.status).toBe(200);

    const oldObj = await env.SYSTEM_BUCKET.head("r2-explorer-test/rename/old.txt");
    expect(oldObj).toBeNull();

    const newObj = await env.SYSTEM_BUCKET.get("r2-explorer-test/rename/new.txt");
    expect(newObj).not.toBeNull();
    expect(await newObj!.text()).toBe("rename-content");
    expect(newObj!.httpMetadata?.contentType).toBe("text/plain");
  });

  it("変更後のファイル名が既に使用されている場合は400", async () => {
    await env.SYSTEM_BUCKET.put("r2-explorer-test/rename2/old.txt", "a");
    await env.SYSTEM_BUCKET.put("r2-explorer-test/rename2/new.txt", "b");

    const res = await callPost("/objects/rename", {
      bucket: "system",
      oldKey: "r2-explorer-test/rename2/old.txt",
      newKey: "r2-explorer-test/rename2/new.txt",
    });
    expect(res.status).toBe(400);
  });

  it("対象ファイルが存在しない場合は404", async () => {
    const res = await callPost("/objects/rename", {
      bucket: "system",
      oldKey: "r2-explorer-test/rename3/nope.txt",
      newKey: "r2-explorer-test/rename3/new.txt",
    });
    expect(res.status).toBe(404);
  });
});

async function upload(fields: Record<string, string>, file?: File) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set("file", file);
  const ctx = createExecutionContext();
  const res = await r2ExplorerRouter.request("/objects/upload", { method: "POST", body: form }, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("追加要望L-3-d: アップロード・ダウンロード", () => {
  it("フォルダ配下へアップロードでき、ダウンロードで同じ内容が日本語ファイル名付きで取得できる", async () => {
    const res = await upload(
      { bucket: "system", prefix: "r2-explorer-test/upload/" },
      new File(["こんにちは"], "見積書.txt", { type: "text/plain" }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).key).toBe("r2-explorer-test/upload/見積書.txt");

    const dl = await callGet(`/objects/download?bucket=system&key=${encodeURIComponent("r2-explorer-test/upload/見積書.txt")}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("Content-Disposition")).toContain(encodeURIComponent("見積書.txt"));
    expect(dl.headers.get("Content-Type")).toContain("text/plain");
    expect(await dl.text()).toBe("こんにちは");
  });

  it("同名ファイルは上書き指定が無ければ400、指定すれば上書きできる", async () => {
    const first = await upload({ bucket: "system", prefix: "r2-explorer-test/ow/" }, new File(["v1"], "a.txt", { type: "text/plain" }));
    expect(first.status).toBe(200);
    const dup = await upload({ bucket: "system", prefix: "r2-explorer-test/ow/" }, new File(["v2"], "a.txt", { type: "text/plain" }));
    expect(dup.status).toBe(400);
    expect(await (await env.SYSTEM_BUCKET.get("r2-explorer-test/ow/a.txt"))!.text()).toBe("v1");

    const ok = await upload({ bucket: "system", prefix: "r2-explorer-test/ow/", overwrite: "true" }, new File(["v2"], "a.txt", { type: "text/plain" }));
    expect(ok.status).toBe(200);
    expect(await (await env.SYSTEM_BUCKET.get("r2-explorer-test/ow/a.txt"))!.text()).toBe("v2");
  });

  it("不正なファイル名・保存先・空ファイル・未知のバケットは400、存在しないファイルのダウンロードは404", async () => {
    expect((await upload({ bucket: "system", prefix: "x/" }, new File(["a"], "..", { type: "text/plain" }))).status).toBe(400);
    expect((await upload({ bucket: "system", prefix: "x/../y/" }, new File(["a"], "a.txt"))).status).toBe(400);
    expect((await upload({ bucket: "system", prefix: "x" }, new File(["a"], "a.txt"))).status).toBe(400);
    expect((await upload({ bucket: "system", prefix: "x/" }, new File([""], "empty.txt"))).status).toBe(400);
    expect((await upload({ bucket: "nope", prefix: "" }, new File(["a"], "a.txt"))).status).toBe(400);
    expect((await upload({ bucket: "system" })).status).toBe(400);
    expect((await callGet("/objects/download?bucket=system&key=r2-explorer-test/none.txt")).status).toBe(404);
  });
});
