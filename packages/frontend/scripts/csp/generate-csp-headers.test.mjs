// BUG-083: ページごとの Content-Security-Policy の生成のテスト。
// 実行(packages/frontend で): node --test scripts/csp/generate-csp-headers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendPageRules,
  buildPolicy,
  generate,
  inlineScriptHashes,
  pagePathToUrl,
} from "./generate-csp-headers.mjs";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("base64");

test("インラインスクリプトだけをハッシュにする(src のあるスクリプトは対象外・重複は1つ)", () => {
  const html = '<script src="/_next/a.js"></script><script>a()</script><script id="x">b()</script><script>a()</script>';
  assert.deepEqual(inlineScriptHashes(html), [sha("a()"), sha("b()")].sort());
});

test("ポリシーは自分のサイトと、ページのインラインスクリプトのハッシュだけを許可する", () => {
  assert.equal(
    buildPolicy(["AAA", "BBB"]),
    "script-src 'self' 'sha256-AAA' 'sha256-BBB'; object-src 'none'; base-uri 'self'; form-action 'self'",
  );
});

test("ページのファイルを URL にする", () => {
  assert.equal(pagePathToUrl("index.html"), "/");
  assert.equal(pagePathToUrl("dashboard.html"), "/dashboard");
  assert.equal(pagePathToUrl(join("sales", "quotes.html")), "/sales/quotes");
});

test("_headers に追記し、作り直しても重複しない", () => {
  const base = "/*\n  X-Frame-Options: DENY\n";
  const once = appendPageRules(base, [{ url: "/a", policy: "script-src 'self'" }]);
  assert.match(once, /^\/\*\n {2}X-Frame-Options: DENY\n/);
  assert.match(once, /\n\/a\n {2}Content-Security-Policy: script-src 'self'\n$/);
  const twice = appendPageRules(once, [{ url: "/b", policy: "script-src 'self'" }]);
  assert.doesNotMatch(twice, /\n\/a\n/);
  assert.match(twice, /\n\/b\n/);
});

test("Cloudflare の制限(1行2,000文字・ルール100件)を超える場合はエラーにする", () => {
  assert.throws(() => appendPageRules("", [{ url: "/a", policy: "x".repeat(2000) }]), /2000 文字/);
  const many = Array.from({ length: 101 }, (_, i) => ({ url: `/p${i}`, policy: "script-src 'self'" }));
  assert.throws(() => appendPageRules("", many), /100 件/);
});

test("out/ の HTML から _headers を作る(404 の画面は対象外)", () => {
  const out = mkdtempSync(join(tmpdir(), "csp-"));
  mkdirSync(join(out, "sales"));
  writeFileSync(join(out, "_headers"), "/*\n  X-Frame-Options: DENY\n");
  writeFileSync(join(out, "index.html"), "<script>i()</script>");
  writeFileSync(join(out, "sales", "quotes.html"), '<script src="/x.js"></script><script>q()</script>');
  writeFileSync(join(out, "404.html"), "<script>n()</script>");
  assert.equal(generate(out), 2);
  const headers = readFileSync(join(out, "_headers"), "utf8");
  assert.match(headers, new RegExp(`\\n/\\n {2}Content-Security-Policy: script-src 'self' 'sha256-${sha("i()").replace(/[+/]/g, "\\$&")}'`));
  assert.match(headers, /\n\/sales\/quotes\n/);
  assert.doesNotMatch(headers, /\/404/);
});
