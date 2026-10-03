import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, buttonClass } from "./Button";

describe("Button", () => {
  it("既定は type=button(form内でも意図せず送信しない)で、クリックを受け取る", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>実行</Button>);
    const btn = screen.getByRole("button", { name: "実行" });
    expect(btn).toHaveAttribute("type", "button");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("type=submit を明示できる。disabled は押せない", () => {
    const onClick = vi.fn();
    render(
      <Button type="submit" disabled onClick={onClick}>
        送信
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "送信" });
    expect(btn).toHaveAttribute("type", "submit");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("用途別の色は、色の名前(トークン)で指定する(色コードを直接書かない)", () => {
    expect(buttonClass({ variant: "primary" })).toContain("bg-primary");
    expect(buttonClass({ variant: "primary" })).toContain(
      "hover:bg-primary-hover",
    );
    expect(buttonClass({ variant: "success" })).toContain("bg-success");
    expect(buttonClass({ variant: "danger" })).toContain("bg-danger");
    for (const v of [
      "primary",
      "success",
      "danger",
      "secondary",
      "text",
    ] as const) {
      expect(buttonClass({ variant: v })).not.toMatch(
        /bg-(indigo|emerald|red|rose|slate-900|slate-800)-?\d*/,
      );
    }
  });

  it("文字色を明示する(CLAUDE.md #20): 塗りは白、副次は濃い文字+白背景", () => {
    expect(buttonClass({ variant: "primary" })).toContain("text-white");
    expect(buttonClass({ variant: "secondary" })).toContain("bg-white");
    expect(buttonClass({ variant: "secondary" })).toContain("text-slate-800");
    for (const v of [
      "primary",
      "success",
      "danger",
      "secondary",
      "text",
    ] as const) {
      expect(buttonClass({ variant: v })).not.toMatch(
        /text-(slate|gray)-[1-4]00/,
      );
    }
  });

  it("無効状態は文字色だけでなく opacity で示す", () => {
    expect(buttonClass()).toContain("disabled:opacity-60");
  });

  it("size: md はスマホで44px以上になる縦余白(py-3)、sm は密な場所向け。fullWidth で w-full", () => {
    expect(buttonClass({ size: "md" })).toContain("py-3");
    expect(buttonClass({ size: "sm" })).toContain("py-1.5");
    expect(buttonClass({ fullWidth: true })).toContain("w-full");
    expect(buttonClass()).not.toContain("w-full");
  });

  it("className を追加できる。button 以外の要素にも buttonClass で同じ見た目にできる", () => {
    render(
      <>
        <Button className="mt-2">追加</Button>
        <a href="#x" className={buttonClass({ variant: "success" })}>
          リンク
        </a>
      </>,
    );
    expect(screen.getByRole("button", { name: "追加" }).className).toContain(
      "mt-2",
    );
    expect(screen.getByRole("link", { name: "リンク" }).className).toContain(
      "bg-success",
    );
  });
});
