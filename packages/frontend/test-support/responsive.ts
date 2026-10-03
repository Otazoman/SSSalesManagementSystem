import { page } from "vitest/browser";

/** 画面幅の基準(ルールは docs/architecture/frontend.md「7-2. 画面幅への対応」): スマホ / タブレット(md) / PC(lg以上) */
export const WIDTHS = { phone: 375, tablet: 768, desktop: 1280 } as const;

export async function setWidth(width: number, height = 800) {
  await page.viewport(width, height);
}

/** ページ全体が横にはみ出しているか(部品内の横スクロール枠は含まない) */
export function pageOverflowsHorizontally(): boolean {
  const el = document.documentElement;
  return el.scrollWidth > el.clientWidth;
}

/** 要素がビューポートの内側に収まっているか(右端・左端のはみ出し検出用) */
export function isWithinViewport(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.left >= 0 && r.right <= document.documentElement.clientWidth;
}
