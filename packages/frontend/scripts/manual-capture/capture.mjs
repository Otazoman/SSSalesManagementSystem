#!/usr/bin/env node
// 使用マニュアル(docs/manual/)のキャプチャを、実際のブラウザ(Playwright・Chromium)で撮影する。
// 撮影と同時に、画面のエラー(コンソールのエラー・画面の例外・API の失敗)を記録する(実ブラウザでのテストを兼ねる)。
//
// 使い方(リポジトリのルートで):
//   node packages/frontend/scripts/manual-capture/capture.mjs                  # すべてのカテゴリを撮影
//   node packages/frontend/scripts/manual-capture/capture.mjs master admin     # カテゴリを指定
//   node packages/frontend/scripts/manual-capture/capture.mjs --list           # シナリオの一覧
//   MANUAL_BASE_URL=http://localhost:8788 node ...                             # ローカルで撮影(既定は Staging)
//
// 出力:
//   docs/manual/images/<カテゴリ>/<シナリオID>-<名前>.png   キャプチャ
//   packages/frontend/scripts/manual-capture/.output/report.json   画面のエラーの記録(Git 管理外。バグ票の材料)
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { BASE_URL, IMAGES_DIR, loginForCookie } from "./lib/config.mjs";
import { loadCompanyReplacements, settle, takeShot } from "./lib/shooting.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, ".output");
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 812 };

async function loadScenarios() {
  const dir = resolve(HERE, "scenarios");
  const all = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort()) {
    const mod = await import(pathToFileURL(resolve(dir, file)).href);
    for (const s of mod.default) all.push({ ...s, category: mod.category });
  }
  return all;
}

function helpers(page, scenario, issues) {
  const dir = resolve(IMAGES_DIR, scenario.category);
  mkdirSync(dir, { recursive: true });
  const shots = [];
  return {
    page,
    settle: () => settle(page),
    /** キャプチャを撮る。options.fullPage=false で画面に見えている範囲だけ、options.locator で要素だけ */
    async shot(name, options = {}) {
      const file = resolve(dir, `${scenario.id}-${name}.png`);
      await takeShot(page, file, options);
      shots.push(file);
    },
    /** 表示されている文字でボタン・リンクを押す */
    async click(text, options = {}) {
      const target = page.getByRole(options.role ?? "button", { name: text, exact: options.exact ?? false }).first();
      await target.click({ timeout: 10000 });
      await settle(page);
    },
    /** 画面の問題として記録する(シナリオの中で気づいた不具合) */
    note(message) {
      issues.push({ kind: "note", message });
    },
    shots,
  };
}

async function runScenario(context, scenario) {
  const issues = [];
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") issues.push({ kind: "console", message: msg.text().slice(0, 300) });
  });
  page.on("pageerror", (err) => issues.push({ kind: "pageerror", message: String(err.message).slice(0, 300) }));
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("/api/") && res.status() >= 400 && !(scenario.expectedErrors ?? []).some((p) => url.includes(p))) {
      issues.push({ kind: "api", message: `${res.status()} ${res.request().method()} ${url.replace(BASE_URL, "")}` });
    }
  });
  if (scenario.viewport === "phone") await page.setViewportSize(PHONE);
  const h = helpers(page, scenario, issues);
  let error = null;
  try {
    await page.goto(`${BASE_URL}${scenario.path}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    if (scenario.steps) await scenario.steps(h);
    else await h.shot("list");
  } catch (err) {
    error = err instanceof Error ? err.message.split("\n")[0] : String(err);
    await page.screenshot({ path: resolve(OUTPUT_DIR, `failed-${scenario.category}-${scenario.id}.png`), fullPage: true }).catch(() => {});
  }
  await page.close();
  return { id: scenario.id, category: scenario.category, title: scenario.title, path: scenario.path, shots: h.shots.length, error, issues };
}

async function main() {
  const args = process.argv.slice(2);
  const scenarios = await loadScenarios();
  if (args.includes("--list")) {
    for (const s of scenarios) console.log(`${s.category.padEnd(12)} ${s.id.padEnd(28)} ${s.path}  ${s.title}`);
    return;
  }
  const categories = args.filter((a) => !a.startsWith("--"));
  const targets = categories.length ? scenarios.filter((s) => categories.includes(s.category)) : scenarios;
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const token = await loginForCookie();
  await loadCompanyReplacements(`session_token=${token}`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: DESKTOP, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  await context.addCookies([{ name: "session_token", value: token, url: BASE_URL, httpOnly: true, secure: BASE_URL.startsWith("https"), sameSite: "Lax" }]);

  // ログイン画面など、ログインしていない状態で撮るシナリオ用(anonymous: true)
  const anonymousContext = await browser.newContext({ viewport: DESKTOP, locale: "ja-JP", timezoneId: "Asia/Tokyo" });

  const results = [];
  for (const scenario of targets) {
    const result = await runScenario(scenario.anonymous ? anonymousContext : context, scenario);
    results.push(result);
    const mark = result.error ? "NG" : result.issues.length ? "!!" : "OK";
    console.log(`${mark} ${scenario.category}/${scenario.id} (${result.shots}枚)${result.error ? ` - ${result.error}` : ""}${result.issues.length ? ` - 問題 ${result.issues.length}件` : ""}`);
  }
  await browser.close();

  const reportPath = resolve(OUTPUT_DIR, "report.json");
  writeFileSync(reportPath, JSON.stringify({ baseUrl: BASE_URL, capturedAt: new Date().toISOString(), results }, null, 2));
  const problems = results.filter((r) => r.error || r.issues.length).length;
  console.log(`\n${results.length} シナリオ(問題あり ${problems})。記録: ${reportPath}`);
}

main().catch((err) => {
  console.error(`エラー: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
