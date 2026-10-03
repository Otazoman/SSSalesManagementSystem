// 撮影の手順(scenarios/*.mjs)で共通に使う操作。
// データを変える操作(登録・保存・申請・削除など)は行わない。画面を開く・タブを切り替える・フォームを開くだけにする。

/** 一覧を撮り、「新規…」のボタンでフォームを開いて撮る(ボタンが無い画面は一覧だけ) */
export async function listAndNewForm(h, options = {}) {
  await h.shot("list");
  await openNewForm(h, options);
}

/** 「新規…」(または options.button に合う)ボタンでフォームを開いて撮る */
export async function openNewForm(h, { button = /新規/, name = "form" } = {}) {
  const target = h.page.getByRole("button", { name: button }).first();
  if (await target.isVisible().catch(() => false)) {
    if (await target.isDisabled().catch(() => false)) {
      h.note(`「${button}」のボタンが無効のため、フォームを撮影できない`);
      return false;
    }
    await target.click();
    await h.settle();
    await h.shot(name);
    return true;
  }
  return false;
}

/** 名前に合うタブ(ボタン)を押して撮る。見つからなければ記録だけする */
export async function clickTabAndShot(h, tabName, shotName) {
  const tab = h.page.getByRole("button", { name: tabName }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    h.note(`タブ「${tabName}」が見つからない`);
    return false;
  }
  await tab.click();
  await h.settle();
  await h.shot(shotName);
  return true;
}

/** 一覧の最初の行(またはリンク)を開いて撮る(詳細の表示・明細の展開) */
export async function openFirstRow(h, { name = "detail", selector = "main table tbody tr" } = {}) {
  const row = h.page.locator(selector).first();
  if (!(await row.isVisible().catch(() => false))) return false;
  const text = (await row.innerText().catch(() => "")) || "";
  if (/該当する|ありません/.test(text)) return false;
  await row.click();
  await h.settle();
  await h.shot(name);
  return true;
}

/**
 * ラベルの文字で入力欄を探し、表示だけを架空の値に置き換える(保存はしない)。
 * 会社・システム設定など、実際の値を写したくない画面で使う。mapping: { ラベルに含まれる文字: 表示する値 }
 */
export async function overrideFieldsByLabel(h, mapping) {
  await h.page.evaluate((entries) => {
    for (const label of document.querySelectorAll("main label")) {
      const text = label.textContent || "";
      const hit = entries.find(([key]) => text.includes(key));
      if (!hit) continue;
      const field =
        (label.htmlFor && document.getElementById(label.htmlFor)) ||
        label.querySelector("input, textarea") ||
        label.parentElement?.querySelector("input, textarea");
      if (field) field.value = hit[1];
    }
  }, Object.entries(mapping));
}
