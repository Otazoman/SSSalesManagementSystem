import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("タイトル・本文・footerを表示し、✕で onClose を呼ぶ", () => {
    const onClose = vi.fn();
    render(
      <Modal
        title="メール送信"
        onClose={onClose}
        footer={<button>送信</button>}
      >
        <p>本文</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("メール送信")).toBeInTheDocument();
    expect(screen.getByText("本文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ダイアログを閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("footer未指定なら操作ボタン行を出さない", () => {
    render(
      <Modal title="t" onClose={() => {}}>
        x
      </Modal>,
    );
    expect(screen.queryByText("送信")).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog").querySelectorAll(".border-t").length,
    ).toBe(0);
  });

  it("size で最大幅が変わる(既定は max-w-md)", () => {
    const { rerender } = render(
      <Modal title="t" onClose={() => {}}>
        x
      </Modal>,
    );
    const panel = () =>
      screen.getByRole("dialog").firstElementChild as HTMLElement;
    expect(panel().className).toContain("max-w-md");
    rerender(
      <Modal title="t" size="2xl" onClose={() => {}}>
        x
      </Modal>,
    );
    expect(panel().className).toContain("max-w-2xl");
  });

  it("スマホでも画面内に収める指定(w-full・max-h-[90dvh]・本文だけスクロール)を持つ", () => {
    render(
      <Modal title="t" onClose={() => {}}>
        x
      </Modal>,
    );
    const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;
    expect(panel.className).toContain("w-full");
    expect(panel.className).toContain("max-h-[90dvh]");
    expect(screen.getByText("x").className).toContain("overflow-y-auto");
  });
});
