import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Modal } from "./Modal";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
  isWithinViewport,
} from "../../../test-support/responsive";

// 実ブラウザ: 長い本文・幅の大きい指定でも、パネルが画面内(横・縦)に収まり、本文だけがスクロールする
const longBody = Array.from({ length: 60 }, (_, i) => (
  <p key={i}>{`行${i}`}</p>
));

describe.each([
  ["phone", WIDTHS.phone, 667],
  ["tablet", WIDTHS.tablet, 1024],
  ["desktop", WIDTHS.desktop, 800],
] as const)("Modal(%s)", (_n, width, height) => {
  it("最大幅の指定が大きくても横にはみ出さず、縦も画面高さ内に収まる", async () => {
    await setWidth(width, height);
    render(
      <Modal
        title="タイトル"
        size="6xl"
        onClose={() => {}}
        footer={<button>OK</button>}
      >
        {longBody}
      </Modal>,
    );
    const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;
    expect(pageOverflowsHorizontally()).toBe(false);
    expect(isWithinViewport(panel)).toBe(true);
    expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(
      height * 0.9 + 1,
    );
    // 本文がスクロール領域になっている(はみ出た分はパネル内でスクロール)
    const body = screen.getByText("行0").parentElement as HTMLElement;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    // 操作ボタンは常に画面内
    expect(isWithinViewport(screen.getByRole("button", { name: "OK" }))).toBe(
      true,
    );
  });

  it("✕ボタンが画面内にあり、スマホでは指で押せる大きさ(44px)", async () => {
    await setWidth(width, height);
    render(
      <Modal title="t" onClose={() => {}}>
        x
      </Modal>,
    );
    const close = screen.getByRole("button", { name: "ダイアログを閉じる" });
    expect(isWithinViewport(close)).toBe(true);
    if (width < 640)
      expect(close.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});
