import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button, buttonClass } from "./Button";
import { FormActions } from "./FormActions";
import { Modal } from "./Modal";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
  isWithinViewport,
} from "../../../test-support/responsive";

// 実ブラウザ: 色のトークンが実際に効いていること、テーマ(変数の上書き)で全ボタンの色が変わること、
// 操作ボタン行が スマホ=全幅で縦積み(確定が上)/ PC=右寄せの横並び になること

const rgb = (
  el: Element,
  prop: "backgroundColor" | "color" = "backgroundColor",
) => getComputedStyle(el)[prop];

describe("Button の色(トークン)", () => {
  it("既定の色が、globals.css の変数どおりに描画される", () => {
    render(
      <>
        <Button>主要</Button>
        <Button variant="success">完了</Button>
        <Button variant="danger">削除</Button>
      </>,
    );
    expect(rgb(screen.getByRole("button", { name: "主要" }))).toBe(
      "rgb(79, 70, 229)",
    );
    expect(rgb(screen.getByRole("button", { name: "完了" }))).toBe(
      "rgb(5, 150, 105)",
    );
    expect(rgb(screen.getByRole("button", { name: "削除" }))).toBe(
      "rgb(220, 38, 38)",
    );
  });

  it("変数(--primary)を上書きするだけで、全ボタンの色が変わる(ダークモード・画面色の指定の土台)", () => {
    render(
      <>
        <Button>A</Button>
        <a href="#x" className={buttonClass()}>
          B
        </a>
      </>,
    );
    document.documentElement.style.setProperty("--primary", "#0f766e");
    try {
      expect(rgb(screen.getByRole("button", { name: "A" }))).toBe(
        "rgb(15, 118, 110)",
      );
      expect(rgb(screen.getByRole("link", { name: "B" }))).toBe(
        "rgb(15, 118, 110)",
      );
    } finally {
      document.documentElement.style.removeProperty("--primary");
    }
  });

  it("文字は白(塗りボタン)・濃い色(副次)で、薄くならない", () => {
    render(
      <>
        <Button>主要</Button>
        <Button variant="secondary">副次</Button>
      </>,
    );
    expect(rgb(screen.getByRole("button", { name: "主要" }), "color")).toBe(
      "rgb(255, 255, 255)",
    );
    // Tailwind v4 はパレットを oklch で出すため、text-slate-800 を付けた要素と同じ色かで比べる
    const probe = document.createElement("span");
    probe.className = "text-slate-800";
    document.body.appendChild(probe);
    expect(rgb(screen.getByRole("button", { name: "副次" }), "color")).toBe(
      rgb(probe, "color"),
    );
    probe.remove();
  });

  it("無効状態は不透明度を下げて示す", () => {
    render(<Button disabled>無効</Button>);
    expect(
      parseFloat(
        getComputedStyle(screen.getByRole("button", { name: "無効" })).opacity,
      ),
    ).toBeLessThan(1);
  });

  it("スマホは高さ44px以上、PCは従来の小さいサイズ(12px文字)", async () => {
    render(<Button>実行</Button>);
    await setWidth(WIDTHS.phone, 667);
    const btn = screen.getByRole("button", { name: "実行" });
    expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await setWidth(WIDTHS.desktop, 800);
    expect(parseFloat(getComputedStyle(btn).fontSize)).toBe(12);
  });
});

describe("FormActions の配置", () => {
  const renderActions = () =>
    render(
      <div className="p-4">
        <FormActions
          mode="edit"
          onCancel={() => {}}
          extra={<Button variant="danger">削除</Button>}
        />
      </div>,
    );

  it("スマホ: 全幅で縦積み。確定(保存)が上、キャンセルが下。横にはみ出さない", async () => {
    await setWidth(WIDTHS.phone, 667);
    renderActions();
    const save = screen.getByRole("button", { name: "保存" });
    const cancel = screen.getByRole("button", { name: "キャンセル" });
    expect(save.getBoundingClientRect().top).toBeLessThan(
      cancel.getBoundingClientRect().top,
    );
    expect(save.getBoundingClientRect().width).toBeCloseTo(
      cancel.getBoundingClientRect().width,
      0,
    );
    expect(save.getBoundingClientRect().width).toBeGreaterThan(300);
    expect(pageOverflowsHorizontally()).toBe(false);
  });

  it("PC: 同じ行に並び、[キャンセル][保存]の順で右寄せ、削除は左端", async () => {
    await setWidth(WIDTHS.desktop, 800);
    renderActions();
    const save = screen
      .getByRole("button", { name: "保存" })
      .getBoundingClientRect();
    const cancel = screen
      .getByRole("button", { name: "キャンセル" })
      .getBoundingClientRect();
    const del = screen
      .getByRole("button", { name: "削除" })
      .getBoundingClientRect();
    expect(Math.abs(save.top - cancel.top)).toBeLessThan(2);
    expect(cancel.right).toBeLessThanOrEqual(save.left);
    expect(del.left).toBeLessThan(cancel.left);
    expect(save.right).toBeGreaterThan(
      document.documentElement.clientWidth - 40,
    ); // 右寄せ
  });

  it("Modal の footer に置いても、画面内に収まる(スマホ・PC)", async () => {
    for (const [w, h] of [
      [WIDTHS.phone, 667],
      [WIDTHS.desktop, 800],
    ] as const) {
      await setWidth(w, h);
      const { unmount } = render(
        <Modal
          title="編集"
          onClose={() => {}}
          footer={<FormActions mode="edit" onCancel={() => {}} formId="f" />}
        >
          <form id="f" />
        </Modal>,
      );
      expect(
        isWithinViewport(screen.getByRole("button", { name: "保存" })),
      ).toBe(true);
      expect(
        isWithinViewport(screen.getByRole("button", { name: "キャンセル" })),
      ).toBe(true);
      unmount();
    }
  });
});
