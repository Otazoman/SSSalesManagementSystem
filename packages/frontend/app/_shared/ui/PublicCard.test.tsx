import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PublicCard,
  PublicField,
  publicInputClass,
  publicButtonClass,
} from "./PublicCard";
import { PublicPage } from "./PublicPage";

describe("PublicCard", () => {
  it("タイトル・説明・本文を表示する(onSubmit未指定は div)", () => {
    const { container } = render(
      <PublicCard title="見積書ダウンロード" description="説明文">
        <p>本文</p>
      </PublicCard>,
    );
    expect(
      screen.getByRole("heading", { name: "見積書ダウンロード" }),
    ).toBeInTheDocument();
    expect(screen.getByText("説明文")).toBeInTheDocument();
    expect(screen.getByText("本文")).toBeInTheDocument();
    expect(container.querySelector("form")).toBeNull();
  });

  it("onSubmit を渡すと form になり、送信で呼ばれる", () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    const { container } = render(
      <PublicCard title="t" onSubmit={onSubmit}>
        <button type="submit">送信</button>
      </PublicCard>,
    );
    expect(container.querySelector("form")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("badge を表示する。説明は省略できる", () => {
    render(
      <PublicCard title="t" badge={<span>SMS</span>}>
        x
      </PublicCard>,
    );
    expect(screen.getByText("SMS")).toBeInTheDocument();
  });

  it("スマホ用の余白・幅指定(w-full max-w-md・p-5 sm:p-8)を持つ", () => {
    const { container } = render(<PublicCard title="t">x</PublicCard>);
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain("w-full");
    expect(cls).toContain("max-w-md");
    expect(cls).toContain("p-5");
    expect(cls).toContain("sm:p-8");
  });

  it("PublicField はラベルを表示する", () => {
    render(
      <PublicField label="メールアドレス">
        <input aria-label="x" />
      </PublicField>,
    );
    expect(screen.getByText("メールアドレス").className).toContain(
      "text-slate-700",
    );
  });

  it("入力欄・ボタンのクラス: スマホ16px・44px以上、薄いグレー文字なし(CLAUDE.md #20)", () => {
    expect(publicInputClass.split(" ")).toContain("text-base");
    expect(publicInputClass.split(" ")).toContain("sm:text-xs");
    expect(publicInputClass).toContain("bg-white");
    expect(publicInputClass).toContain("text-slate-900");
    expect(publicInputClass).toContain("placeholder-slate-500");
    for (const cls of Object.values(publicButtonClass))
      expect(cls).not.toMatch(/text-slate-[1-4]00/);
    expect(publicButtonClass.primary).toContain("py-3");
  });
});

describe("PublicPage", () => {
  it("全画面・縦スクロール可能で、子を中央に置く", () => {
    const { container } = render(<PublicPage>子</PublicPage>);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("fixed");
    expect(outer.className).toContain("inset-0");
    expect(outer.className).toContain("overflow-y-auto");
    expect(outer.className).toContain("bg-slate-100");
    expect(screen.getByText("子")).toBeInTheDocument();
  });

  it("tone=dark で背景が暗くなる", () => {
    const { container } = render(<PublicPage tone="dark">子</PublicPage>);
    expect((container.firstElementChild as HTMLElement).className).toContain(
      "bg-slate-900",
    );
  });
});
