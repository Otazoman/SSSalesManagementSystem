import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
  isWithinViewport,
} from "../../../test-support/responsive";

// 実ブラウザ検出そのものの動作確認(Tailwindが効き、画面幅の切り替えとはみ出し検出が機能していること)
describe("実ブラウザの検出基盤", () => {
  it("幅を超える固定幅の要素は、ページの横はみ出しとして検出される", async () => {
    await setWidth(WIDTHS.phone);
    render(<div className="w-[900px] h-4" />);
    expect(pageOverflowsHorizontally()).toBe(true);
  });

  it("w-full max-w-[..] なら、スマホ幅でも収まる", async () => {
    await setWidth(WIDTHS.phone);
    const { getByTestId } = render(
      <div data-testid="box" className="w-full max-w-[900px] h-4" />,
    );
    expect(pageOverflowsHorizontally()).toBe(false);
    expect(isWithinViewport(getByTestId("box"))).toBe(true);
  });

  it("ブレークポイント(sm:)が画面幅で切り替わる(Tailwindが効いている)", async () => {
    const { getByTestId } = render(
      <div data-testid="t" className="w-10 sm:w-40 h-4" />,
    );
    await setWidth(WIDTHS.phone);
    expect(getByTestId("t").getBoundingClientRect().width).toBe(40);
    await setWidth(WIDTHS.desktop);
    expect(getByTestId("t").getBoundingClientRect().width).toBe(160);
  });
});
