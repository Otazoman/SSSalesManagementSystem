// 撮影の共通処理(画面が落ち着くのを待つ・写してはいけない値を置き換える・本文の高さに合わせて撮る)。
// capture.mjs(表示だけのシナリオ)と capture-approval.mjs(申請・承認の流れ)で使う。
import { BASE_URL, readCredentials, readMaskWords } from "./config.mjs";

const MASK_WORDS = readMaskWords();

// 会社・システム設定の値(住所・電話など)は、帳票の発行元として多くの画面に表示されるため、
// 撮影の最初に実際の値を読み、どの画面でも架空の値に置き換える(値はログ・ファイルに出さない)
const COMPANY_SAMPLE_VALUES = {
  site_url: "https://sms.example.com",
  company_zip: "000-0000",
  company_address: "東京都サンプル区サンプル町1-2-3",
  company_tel: "03-0000-0000",
  company_fax: "03-0000-0001",
  company_invoice_registration_no: "T0000000000000",
  smtp_host: "smtp.example.com",
  smtp_user: "no-reply@example.com",
  smtp_from: "no-reply@example.com",
  fb_committer_code: "0000000000",
  fb_committer_name: "ｶ)ｻﾝﾌﾟﾙ",
  fb_bank_code: "0000",
  fb_bank_name: "ｻﾝﾌﾟﾙｷﾞﾝｺｳ",
  fb_branch_code: "000",
  fb_branch_name: "ｻﾝﾌﾟﾙｼﾃﾝ",
  fb_account_number: "0000000",
};
// 撮影に使うアカウントのメールアドレスは、画面の氏名(見本データ)に合わせた架空のアドレスにする
const ACCOUNT_SAMPLE_EMAILS = {
  MANUAL: "admin@example.com",
  MANUAL_APPLICANT: "suzuki.ichiro@example.com",
  MANUAL_APPROVER: "sato.hanako@example.com",
};
let replacements = [];

function accountReplacements() {
  const pairs = [];
  for (const [prefix, sample] of Object.entries(ACCOUNT_SAMPLE_EMAILS)) {
    try {
      const { user } = readCredentials(prefix);
      if (user.includes("@")) pairs.push([user, sample]);
    } catch {
      // .env に無いアカウントは置き換えない
    }
  }
  return pairs;
}

/** 会社・システム設定の実際の値を読み、置き換えの組を用意する(撮影の最初に1回) */
export async function loadCompanyReplacements(cookie) {
  const res = await fetch(`${BASE_URL}/api/company-settings`, { headers: { Cookie: cookie } });
  const settings = res.ok ? await res.json() : {};
  replacements = [
    ...accountReplacements(),
    ...Object.entries(COMPANY_SAMPLE_VALUES).map(([key, sample]) => [String(settings[key] ?? ""), sample]),
  ]
    .filter(([real]) => real.trim().length >= 3)
    .sort((a, b) => b[0].length - a[0].length); // 長い値から置き換える(部分一致の取りこぼし防止)
}

/**
 * 撮影の直前に、画面の表示だけを置き換える(保存はしない)。実際のドメインを含むメールアドレスは user@example.com に、
 * URL・ホスト名は example.com に置き換える(文字・入力欄のすべて。メールアドレスは名前の部分も写さない)
 */
export async function maskSensitive(page) {
  if (replacements.length > 0) {
    await page.evaluate((pairs) => {
      const replace = (text) => pairs.reduce((t, [real, sample]) => t.split(real).join(sample), text);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const next = replace(n.nodeValue);
        if (next !== n.nodeValue) n.nodeValue = next;
      }
      for (const el of document.querySelectorAll("input, textarea")) {
        const next = replace(el.value);
        if (next !== el.value) el.value = next;
      }
    }, replacements);
  }
  if (MASK_WORDS.length === 0) return;
  await page.evaluate((words) => {
    // 語は英数字とハイフンだけ(readMaskWords で確認済み)なので、正規表現のエスケープは不要
    const pattern = new RegExp(`([A-Za-z0-9._%+-]+@)?[A-Za-z0-9.-]*(${words.join("|")})[A-Za-z0-9.-]*`, "gi");
    const mask = (text) => text.replace(pattern, (m, at) => (at ? "user@example.com" : "example.com"));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (pattern.test(n.nodeValue)) n.nodeValue = mask(n.nodeValue);
      pattern.lastIndex = 0;
    }
    for (const el of document.querySelectorAll("input, textarea")) {
      if (el.value && pattern.test(el.value)) el.value = mask(el.value);
      pattern.lastIndex = 0;
    }
  }, MASK_WORDS);
}

/** 画面が落ち着くまで待つ(通信が止まり、読み込み中の表示が消えるまで) */
export async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page
    .waitForFunction(() => !/読み込み中|システムを最適化中|更新中\.\.\./.test(document.body?.innerText ?? ""), null, { timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(300);
}

/** キャプチャを撮る。options.fullPage=false で画面に見えている範囲だけ、options.locator で要素だけ */
export async function takeShot(page, file, options = {}) {
  await settle(page);
  await maskSensitive(page);
  if (options.locator) {
    await page.locator(options.locator).first().screenshot({ path: file });
  } else if (options.fullPage ?? true) {
    // このアプリはページ全体ではなく内側の領域がスクロールするため、Playwright の fullPage では
    // 下が切れる。スクロールする領域の高さに合わせて、撮影の間だけブラウザの高さを伸ばす
    const original = page.viewportSize();
    // 本文(<main>)の高さだけを使う(サイドメニューの長さで伸ばさない)。<main> が無い画面(ログイン等)はページ全体
    const needed = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return document.documentElement.scrollHeight;
      return Math.ceil(main.getBoundingClientRect().top + window.scrollY + main.scrollHeight);
    });
    const height = Math.min(Math.max(needed, original.height), 8000);
    if (height > original.height) {
      await page.setViewportSize({ width: original.width, height });
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: file });
    if (height > original.height) await page.setViewportSize(original);
  } else {
    await page.screenshot({ path: file });
  }
}
