#!/usr/bin/env node
// BUG-083: 画面(静的ファイル)の Content-Security-Policy に、スクリプトの実行元の制限を加える。
//
// Next.js の静的書き出し(out/)は、各ページの HTML にインラインのスクリプト(画面の初期データ・テーマの初期化)を
// 埋め込む。script-src を 'self' だけにすると画面が動かなくなるため、ページごとに、そのページのインラインスクリプトの
// ハッシュ(sha256)だけを許可する。これ以外のインラインスクリプト(XSS で差し込まれたもの)や、外部サイトのスクリプトは
// 実行されない。
//
// next build の後に実行し(npm run build に含めている)、out/_headers の末尾にページごとのルールを追記する。
// public/_headers の共通のルール(埋め込みの禁止など)はそのまま残る(同じ名前のヘッダーは両方が適用され、
// ブラウザはすべての Content-Security-Policy を満たすものだけを許可する)。
//
// 使い方(packages/frontend で): node scripts/csp/generate-csp-headers.mjs [出力フォルダ(既定: out)]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "# --- BUG-083: ページごとのスクリプトの実行元の制限(scripts/csp/generate-csp-headers.mjs が生成) ---";
// Cloudflare の _headers の制限(ルール100件・1行2,000文字)
const MAX_RULES = 100;
const MAX_LINE_LENGTH = 2000;
// 404 の画面は、存在しない URL への応答として返るため、URL のルールでは指定できない
const SKIP_PAGES = new Set(["404.html", "_not-found.html"]);

/** HTML の中のインラインスクリプト(src の無い script)の中身の sha256(base64)を、重複を除いて返す */
export function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/i.test(m[1])) continue;
    hashes.add(createHash("sha256").update(m[2], "utf8").digest("base64"));
  }
  return [...hashes].sort();
}

/** ページの Content-Security-Policy(スクリプトの実行元を、自分のサイトと、そのページのインラインスクリプトに限る) */
export function buildPolicy(hashes) {
  return [
    `script-src 'self'${hashes.map((h) => ` 'sha256-${h}'`).join("")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** out/ からの相対パス(a/b.html)を、画面の URL(/a/b)にする。index.html は / */
export function pagePathToUrl(relPath) {
  const path = relPath.split(sep).join("/");
  if (path === "index.html") return "/";
  return "/" + path.replace(/\/index\.html$/, "").replace(/\.html$/, "");
}

/** _headers の内容に、ページごとのルールを追記する(以前に追記した部分は作り直す) */
export function appendPageRules(headersText, pages) {
  const base = headersText.includes(MARKER) ? headersText.slice(0, headersText.indexOf(MARKER)) : headersText;
  const lines = [base.trimEnd(), "", MARKER];
  for (const { url, policy } of pages) {
    const line = `  Content-Security-Policy: ${policy}`;
    if (line.length > MAX_LINE_LENGTH) {
      throw new Error(`${url} の Content-Security-Policy が ${MAX_LINE_LENGTH} 文字を超えます(${line.length} 文字)`);
    }
    lines.push(url, line);
  }
  const ruleCount = (base.match(/^\/\S*/gm) ?? []).length + pages.length;
  if (ruleCount > MAX_RULES) {
    throw new Error(`_headers のルールが ${MAX_RULES} 件を超えます(${ruleCount} 件)`);
  }
  return lines.join("\n") + "\n";
}

function listHtmlFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...listHtmlFiles(full));
    else if (name.endsWith(".html")) files.push(full);
  }
  return files;
}

export function generate(outDir) {
  const pages = listHtmlFiles(outDir)
    .map((file) => ({ file, rel: relative(outDir, file) }))
    .filter(({ rel }) => !SKIP_PAGES.has(rel))
    .map(({ file, rel }) => ({
      url: pagePathToUrl(rel),
      policy: buildPolicy(inlineScriptHashes(readFileSync(file, "utf8"))),
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
  const headersPath = join(outDir, "_headers");
  writeFileSync(headersPath, appendPageRules(readFileSync(headersPath, "utf8"), pages));
  return pages.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ?? "out";
  const count = generate(outDir);
  console.log(`Content-Security-Policy(スクリプトの実行元の制限)を ${count} 画面分、${join(outDir, "_headers")} に追記しました`);
}
