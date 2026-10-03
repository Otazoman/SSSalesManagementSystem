#!/usr/bin/env node
// 使用マニュアル(docs/manual/workflow/)の「申請 → 承認・差戻し → 再申請」の流れを、実際に操作して撮影する。
//
// ⚠ capture.mjs(表示だけ)と違い、撮影先のデータを変更する。Staging など撮影用の環境でだけ実行すること。
//   1. 会社・システム設定で「見積の承認機能」を有効にする(終わったら元に戻す。--keep で有効のまま)
//      前回の実行で作った見本の見積(件名が【承認の例】)は、最初に片付ける(取下げ・削除・削除の承認)
//   2. 一般社員(MANUAL_APPLICANT_*)で、見本の見積を3件、下書きで作る(既存の見積の品目を1個ずつ使う)
//   3. 一般社員で、画面から3件を承認申請する
//   4. 上長(MANUAL_APPROVER_*)で、1件を承認・1件を差戻し・1件は承認待ちのまま残す
//   5. 一般社員で、差し戻された見積を画面から再申請する
//   6. 管理者(MANUAL_*)で、承認の通知メールの送信履歴を撮る
// 承認の通知メールが、申請者・上長のメールアドレスに実際に送られる。
// 見積の承認機能は、実行の最初に読んだ設定(元の設定)に戻す。実行中に画面から設定を変えないこと。
//
// 使い方(リポジトリのルートで):
//   node packages/frontend/scripts/manual-capture/capture-approval.mjs          # 実行して、承認機能を元に戻す
//   node packages/frontend/scripts/manual-capture/capture-approval.mjs --keep   # 承認機能を有効のまま残す
//
// .env に MANUAL_USER/PASSWORD(管理者)・MANUAL_APPLICANT_USER/PASSWORD(一般社員)・
// MANUAL_APPROVER_USER/PASSWORD(一般社員の見積を承認する上長)が必要。
// 出力: docs/manual/images/workflow/approval-*.png
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BASE_URL, IMAGES_DIR, loginForCookie, readCredentials } from "./lib/config.mjs";
import { loadCompanyReplacements, settle, takeShot } from "./lib/shooting.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, ".output");
const SHOT_DIR = resolve(IMAGES_DIR, "workflow");
const DESKTOP = { width: 1280, height: 800 };
const KEEP = process.argv.includes("--keep");

// 見本の見積(1件目: 承認する、2件目: 差し戻して再申請する、3件目: 承認待ちのまま残す)
const SAMPLE_TITLES = ["【承認の例】事務用品一式のお見積", "【承認の例】会議室備品のお見積", "【承認の例】消耗品(定期納品)のお見積"];

async function api(token, method, path, body) {
  const isForm = body instanceof FormData;
  const headers = { Cookie: `session_token=${token}` };
  if (body && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} が失敗しました(${res.status}): ${json?.message ?? ""}`);
  return json;
}

const asList = (json) => (Array.isArray(json) ? json : (json?.data ?? json?.items ?? json?.users ?? json?.quotes ?? json?.histories ?? []));
const today = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000 + 9 * 3600000).toISOString().slice(0, 10);

async function setQuoteApproval(adminToken, enabled) {
  // PUT は全項目の上書きのため、現在の設定を読んで1項目だけ変えて戻す(値は出力しない)
  const settings = await api(adminToken, "GET", "/api/company-settings");
  const before = Boolean(settings.is_quote_approval_enabled);
  if (before !== enabled) await api(adminToken, "PUT", "/api/company-settings", { ...settings, is_quote_approval_enabled: enabled });
  return before;
}

/** 一般社員で、見本の見積を下書きで作る(既存の見積から得意先・品目を借りる)。作った見積の ID を返す */
async function createDraftQuotes(adminToken, applicantToken) {
  const users = asList(await api(adminToken, "GET", "/api/users"));
  const applicantEmail = readCredentials("MANUAL_APPLICANT").user;
  const applicant = users.find((u) => u.email === applicantEmail);
  const employeeNumber = applicant?.employeeNumber ?? null;

  const base = asList(await api(applicantToken, "GET", "/api/quotes")).find((q) => !isSample(q) && Number(q.totalAmount) > 0);
  if (!base) throw new Error("見本にする既存の見積がありません(サンプルデータを取り込んでください)");
  const detail = await api(applicantToken, "GET", `/api/quotes/${base.id}`);
  const items = (detail.items ?? []).slice(0, 3);
  if (items.length === 0) throw new Error("見本にする見積に明細がありません");
  // 消費税率は、見本にした見積の合計(税込)と消費税から求める(求められなければ10%)
  const baseNet = Number(detail.totalAmount) - Number(detail.taxAmount);
  const taxRate = baseNet > 0 && Number(detail.taxAmount) > 0 ? Math.round((Number(detail.taxAmount) / baseNet) * 100) / 100 : 0.1;

  // 件名での検索は長い日本語で失敗するため(BUG-012)、一覧を読んで手元で探す
  const findDraft = async (title) =>
    asList(await api(applicantToken, "GET", "/api/quotes"))
      .filter((q) => q.title === title && q.status === "DRAFT")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];

  const ids = [];
  for (const [i, title] of SAMPLE_TITLES.entries()) {
    const item = items[i % items.length];
    const quantity = 2 + i;
    const unitPrice = Math.min(Number(item.unitPrice) || 1000, 100000); // 承認経路が「100万円未満」になる金額にする
    // 合計・消費税は画面では自動で計算されるが、API では送った値がそのまま保存されるため、ここで計算する
    const subtotal = quantity * unitPrice;
    const taxAmount = Math.floor(subtotal * taxRate);
    const quoteData = {
      title,
      partnerId: detail.partnerId,
      customerId: detail.customerId,
      quoteDate: today(),
      validUntil: today(30),
      status: "DRAFT",
      totalAmount: subtotal + taxAmount,
      taxAmount,
      salesPersonEmployeeNumber: employeeNumber,
      inputPersonEmployeeNumber: employeeNumber,
      projectId: detail.projectId,
      deliveryPlace: detail.deliveryPlace,
      paymentTerms: detail.paymentTerms,
      memo: "使用マニュアルの撮影用の見本です。",
      items: [
        {
          itemId: item.itemId,
          itemName: item.itemName,
          inputType: item.inputType,
          quantity,
          unitPrice,
          unitCode: item.unitCode,
          taxCategoryCode: item.taxCategoryCode,
        },
      ],
    };
    const form = new FormData();
    form.append("quoteData", JSON.stringify(quoteData));
    await api(applicantToken, "POST", "/api/quotes/register", form);
    const created = await findDraft(title);
    if (!created) throw new Error(`作った見積「${title}」が見つかりません`);
    ids.push(created.id);
  }
  return ids;
}

const isSample = (q) => q.title?.startsWith("【承認の例】");

/**
 * 前回の実行で作った見本の見積を片付ける(一覧・承認タスク・申請履歴に前回の分が残らないように)。
 * 承認待ちは申請者が取り下げて下書きに戻し、下書きは削除し、承認済みは削除を申請して上長が承認する。
 * 最後に、削除した見積の差戻し済みの申請を取り下げる(残すと「あなたの申請(差戻し)」に「不明な見積」として出続ける)
 */
async function cleanupSamples(tokens, userIds) {
  const quotes = async () => asList(await api(tokens.applicant, "GET", "/api/quotes")).filter(isSample);
  const history = async () =>
    asList(await api(tokens.applicant, "GET", `/api/workflow-tasks/history?userId=${encodeURIComponent(userIds.applicant)}`)).filter(
      (h) => h.targetType === "sales_quotes",
    );
  const cancel = (h) => api(tokens.applicant, "POST", "/api/workflow-tasks/cancel", { targetId: h.targetId, logId: h.logId, userId: userIds.applicant });

  for (let pass = 0; pass < 4; pass++) {
    const samples = await quotes();
    if (samples.length === 0) break;
    const pending = (await history()).filter((h) => h.status === "PENDING");
    for (const q of samples) {
      if (q.status === "DRAFT") {
        await api(tokens.applicant, "DELETE", `/api/quotes/${q.id}`);
      } else if (q.status === "APPROVED") {
        await api(tokens.applicant, "POST", `/api/quotes/${q.id}/request-deletion`, {});
      } else if (q.status === "PENDING_APPROVAL") {
        const h = pending.find((x) => x.targetId === q.id);
        if (!h) throw new Error(`前回の見本の見積 ${q.id} の申請が見つからないため、取り下げられません`);
        await cancel(h);
      } else if (q.status === "PENDING_DELETION") {
        const task = asList(
          await api(tokens.approver, "GET", `/api/workflow-tasks/my-pending?userId=${encodeURIComponent(userIds.approver)}`),
        ).find((t) => t.targetId === q.id);
        if (!task) throw new Error(`前回の見本の見積 ${q.id} の削除の承認タスクが上長に見つからないため、片付けられません`);
        const body = { logId: task.logId, requestId: task.requestId, userId: userIds.approver, comment: "マニュアルの撮影のやり直しのため" };
        await api(tokens.approver, "POST", "/api/workflow-tasks/approve", body);
      }
    }
  }
  const left = await quotes();
  if (left.length > 0) throw new Error(`前回の見本の見積を片付けられませんでした: ${left.map((q) => `${q.id}(${q.status})`).join(", ")}`);
  const alive = new Set(asList(await api(tokens.applicant, "GET", "/api/quotes")).map((q) => q.id));
  for (const h of await history()) {
    if (h.status === "REMANDED" && !alive.has(h.targetId)) await cancel(h);
  }
}

async function newPage(browser, token) {
  const context = await browser.newContext({ viewport: DESKTOP, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  await context.addCookies([{ name: "session_token", value: token, url: BASE_URL, httpOnly: true, secure: BASE_URL.startsWith("https"), sameSite: "Lax" }]);
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept()); // 「申請しますか?」などの確認は OK にする
  return page;
}

async function open(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await settle(page);
}

const shot = (page, name, options) => takeShot(page, resolve(SHOT_DIR, `approval-${name}.png`), options);

/** 見積の一覧の「下書き」から見積を開き、承認を申請する(一覧に件名の列は無いため、見積コードで探す) */
async function submitQuote(page, quoteId, shots = {}) {
  await open(page, "/sales/quotes");
  await page.getByRole("button", { name: /下書き/ }).first().click();
  await settle(page);
  if (shots.list) await shot(page, shots.list);
  // 一覧は版(末尾の -1 など)を除いた見積コードで表示される
  const baseCode = quoteId.replace(/-\d+$/, "");
  await page.locator("main table tbody tr", { hasText: baseCode }).first().click();
  await settle(page);
  if (shots.form) await shot(page, shots.form);
  await page.getByRole("button", { name: /承認を申請する/ }).first().click();
  await page.getByText("承認を申請しました").first().waitFor({ timeout: 15000 });
  await settle(page);
  await page.waitForTimeout(1500); // 一覧の再読み込みを待つ
  if (shots.done) await shot(page, shots.done);
}

/** 承認タスク管理で、見積の行にコメントを入れて承認・差戻しする */
async function decide(page, quoteId, action, comment) {
  const row = page.locator("main table tbody tr", { hasText: quoteId }).first();
  await row.locator("input[type=text]").fill(comment);
  await row.getByRole("button", { name: action === "approve" ? "承認" : "差戻し", exact: true }).click();
  await settle(page);
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const adminToken = await loginForCookie("MANUAL");
  const applicantToken = await loginForCookie("MANUAL_APPLICANT");
  const approverToken = await loginForCookie("MANUAL_APPROVER");
  await loadCompanyReplacements(`session_token=${adminToken}`);

  const wasEnabled = await setQuoteApproval(adminToken, true);
  console.log(`見積の承認機能を有効にしました(元の設定: ${wasEnabled ? "有効" : "無効"})`);
  const browser = await chromium.launch();
  let step = "準備";
  let current = null;
  try {
    step = "前回の見本の片付け";
    const users = asList(await api(adminToken, "GET", "/api/users"));
    const userIdOf = (prefix) => {
      const user = users.find((u) => u.email === readCredentials(prefix).user);
      if (!user) throw new Error(`${prefix}_USER のユーザーが見つかりません`);
      return user.id;
    };
    await cleanupSamples(
      { applicant: applicantToken, approver: approverToken },
      { applicant: userIdOf("MANUAL_APPLICANT"), approver: userIdOf("MANUAL_APPROVER") },
    );

    step = "見本の見積の作成";
    const [approveId, remandId, pendingId] = await createDraftQuotes(adminToken, applicantToken);
    console.log("見本の見積を3件、下書きで作りました");

    const applicant = await newPage(browser, applicantToken);
    const approver = await newPage(browser, approverToken);
    const admin = await newPage(browser, adminToken);

    step = "一般社員: 承認申請";
    current = applicant;
    await submitQuote(applicant, approveId, { list: "01-drafts", form: "02-quote-form", done: "03-submitted" });
    await submitQuote(applicant, remandId);
    await submitQuote(applicant, pendingId);
    await open(applicant, "/workflow/histories");
    await shot(applicant, "04-histories-pending");

    step = "上長: 承認・差戻し";
    current = approver;
    await open(approver, "/dashboard");
    await shot(approver, "05-dashboard-approver", { fullPage: false });
    await open(approver, "/workflow/tasks");
    await shot(approver, "06-tasks-pending");
    const row = approver.locator("main table tbody tr", { hasText: approveId }).first();
    await row.getByRole("button", { name: /プレビュー/ }).click();
    await settle(approver);
    await shot(approver, "07-tasks-preview");
    await row.getByRole("button", { name: /閉じる/ }).click();
    await decide(approver, approveId, "approve", "内容を確認しました。お客様へ送付してください。");
    await decide(approver, remandId, "remand", "数量をお客様に再確認してから、再申請してください。");
    await open(approver, "/workflow/tasks");
    await shot(approver, "08-tasks-after");

    step = "一般社員: 結果の確認・再申請";
    current = applicant;
    await open(applicant, "/dashboard");
    await shot(applicant, "09-dashboard-applicant", { fullPage: false });
    await open(applicant, "/workflow/histories");
    await shot(applicant, "10-histories-result");
    await submitQuote(applicant, remandId, { form: "11-remanded-quote-form", done: "12-resubmitted" });

    step = "管理者: 通知メールの送信履歴";
    current = admin;
    await admin.waitForTimeout(90000); // 通知メールは1分ごとにまとめて送るため、送信を待つ
    await open(admin, "/admin/mail-logs");
    await admin.getByRole("button", { name: /ログを検索/ }).first().click(); // この画面は開いただけでは検索しない
    await settle(admin);
    await shot(admin, "13-mail-logs");
    console.log(`撮影しました(承認待ちのまま残した見積: ${pendingId})`);
  } catch (err) {
    console.error(`「${step}」で失敗しました: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    if (current) await current.screenshot({ path: resolve(OUTPUT_DIR, "failed-approval.png"), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (!KEEP && !wasEnabled) {
      await setQuoteApproval(adminToken, false);
      console.log("見積の承認機能を元(無効)に戻しました");
    }
  }
}

main().catch((err) => {
  console.error(`エラー: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
