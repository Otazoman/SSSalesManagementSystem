import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  PublicCard,
  PublicField,
  publicInputClass,
  publicButtonClass,
} from "./PublicCard";
import { PublicPage } from "./PublicPage";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
  isWithinViewport,
} from "../../../test-support/responsive";

// 実ブラウザ: 公開画面のカードが、スマホ・タブレット・PCで画面内に収まり、
// 内容が画面より高くてもスクロールで全体に届く。入力欄は16px以上・ボタンは44px以上(スマホ)
const tall = Array.from({ length: 14 }, (_, i) => (
  <PublicField key={i} label={`項目${i}`}>
    <input className={publicInputClass} defaultValue="値" />
  </PublicField>
));

describe.each([
  ["phone", WIDTHS.phone, 667],
  ["tablet", WIDTHS.tablet, 1024],
  ["desktop", WIDTHS.desktop, 800],
] as const)("PublicPage + PublicCard(%s)", (_n, width, height) => {
  it("横にはみ出さず、カードは画面幅の内側に収まる", async () => {
    await setWidth(width, height);
    const { container } = render(
      <PublicPage>
        <PublicCard title="タイトル" description="説明">
          {tall}
          <button className={publicButtonClass.primary}>送信</button>
        </PublicCard>
      </PublicPage>,
    );
    expect(pageOverflowsHorizontally()).toBe(false);
    const card = container.querySelector("h1")!.parentElement!.parentElement!;
    expect(isWithinViewport(card)).toBe(true);
  });

  it("内容が画面より高い時は、外枠が縦スクロールになり、下端のボタンまで届く", async () => {
    await setWidth(width, height);
    const { container } = render(
      <PublicPage>
        <PublicCard title="タイトル">
          {tall}
          <button className={publicButtonClass.primary}>送信</button>
        </PublicCard>
      </PublicPage>,
    );
    const scroller = container.firstElementChild as HTMLElement;
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    // 最後までスクロールすれば、ボタンは外枠の内側に入る(切れて押せないままにならない)
    scroller.scrollTop = scroller.scrollHeight;
    const rect = screen
      .getByRole("button", { name: "送信" })
      .getBoundingClientRect();
    expect(rect.bottom).toBeLessThanOrEqual(
      scroller.getBoundingClientRect().bottom + 1,
    );
    expect(rect.top).toBeGreaterThanOrEqual(0);
  });
});

describe("公開画面の入力欄・ボタンの大きさ", () => {
  it("スマホ: 入力欄は16px以上(iOSの自動拡大を防ぐ)、ボタンは高さ44px以上", async () => {
    await setWidth(WIDTHS.phone, 667);
    render(
      <PublicPage>
        <PublicCard title="t">
          <input aria-label="入力" className={publicInputClass} />
          <button className={publicButtonClass.primary}>送信</button>
        </PublicCard>
      </PublicPage>,
    );
    expect(
      parseFloat(getComputedStyle(screen.getByLabelText("入力")).fontSize),
    ).toBeGreaterThanOrEqual(16);
    expect(
      screen.getByRole("button", { name: "送信" }).getBoundingClientRect()
        .height,
    ).toBeGreaterThanOrEqual(44);
  });

  it("PC: 従来の小さい文字(12px)のまま", async () => {
    await setWidth(WIDTHS.desktop, 800);
    render(<input aria-label="入力" className={publicInputClass} />);
    expect(
      parseFloat(getComputedStyle(screen.getByLabelText("入力")).fontSize),
    ).toBe(12);
  });
});
