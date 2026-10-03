import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidePanel } from "./SidePanel";
import { PageHeader } from "./PageHeader";
import { ListToolbar } from "./ListToolbar";
import { Button } from "./Button";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
} from "../../../test-support/responsive";

// 実ブラウザ: 右側プレビューがスマホで画面幅を超えない(従来は w-96=384px 固定でスマホ幅375pxからはみ出した)、
// 見出し・操作バーのボタンが多くても、スマホで折り返して横にはみ出さない

const longBody = Array.from({ length: 60 }, (_, i) => (
  <p key={i}>{`行${i}`}</p>
));

describe("SidePanel(実ブラウザ)", () => {
  it.each([
    ["phone", WIDTHS.phone, 667, WIDTHS.phone],
    ["tablet", WIDTHS.tablet, 1024, 384],
    ["desktop", WIDTHS.desktop, 800, 384],
  ] as const)(
    "%s: 幅は %i 想定どおり(スマホは画面幅いっぱい、それ以外は384px)で、右端に固定される",
    async (_n, width, height, expectedWidth) => {
      await setWidth(width, height);
      render(
        <SidePanel title="プレビュー" eyebrow="QT-001" onClose={() => {}}>
          {longBody}
        </SidePanel>,
      );
      const rect = screen.getByRole("dialog").getBoundingClientRect();
      expect(Math.round(rect.width)).toBe(expectedWidth);
      expect(Math.round(rect.right)).toBe(width);
      expect(pageOverflowsHorizontally()).toBe(false);
    },
  );

  it("本文だけがスクロールし、下の「閉じる」は常に画面内にある(スマホ)", async () => {
    await setWidth(WIDTHS.phone, 667);
    render(
      <SidePanel title="プレビュー" onClose={() => {}}>
        {longBody}
      </SidePanel>,
    );
    const body = screen.getByText("行0").parentElement as HTMLElement;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    const close = screen.getAllByRole("button", { name: "閉じる" }).pop()!;
    expect(close.getBoundingClientRect().bottom).toBeLessThanOrEqual(667);
    expect(close.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});

describe("PageHeader・ListToolbar(実ブラウザ)", () => {
  const manyButtons = (
    <>
      {[
        "📥 CSVダウンロード",
        "📤 CSVインポート",
        "選択したデータをメール一括送信 (3件) 🚀",
        "➕ 見積を新規登録・申請する",
      ].map((t) => (
        <Button key={t} size="sm">
          {t}
        </Button>
      ))}
    </>
  );

  it.each([
    ["phone", WIDTHS.phone],
    ["tablet", WIDTHS.tablet],
    ["desktop", WIDTHS.desktop],
  ] as const)("%s: ボタンが多くても横にはみ出さない", async (_n, width) => {
    await setWidth(width, 800);
    render(
      <div className="p-4 space-y-4">
        <PageHeader
          title="📄 見積管理"
          description="営業見積データの新規登録・修正、決裁・承認申請および関連する証跡ファイルの管理を行います。"
          actions={manyButtons}
        />
        <ListToolbar
          filters={
            <div className="flex flex-wrap gap-1">
              {[
                "🌐 すべて",
                "⚪ 下書き",
                "🟡 承認申請中",
                "🟢 承認済み",
                "🔴 削除申請中",
              ].map((t) => (
                <Button key={t} size="sm" variant="secondary">
                  {t}
                </Button>
              ))}
            </div>
          }
          actions={manyButtons}
        />
      </div>,
    );
    expect(pageOverflowsHorizontally()).toBe(false);
  });

  it("PC: 見出しの操作ボタンは右側、スマホでは説明の下に折り返す", async () => {
    const view = () =>
      render(
        <PageHeader
          title="タイトル"
          description="説明"
          actions={<Button size="sm">操作</Button>}
        />,
      );
    await setWidth(WIDTHS.desktop, 800);
    const { unmount } = view();
    const h1 = screen.getByRole("heading").getBoundingClientRect();
    const btn = screen
      .getByRole("button", { name: "操作" })
      .getBoundingClientRect();
    expect(btn.left).toBeGreaterThan(h1.right); // 右側
    unmount();
    await setWidth(WIDTHS.phone, 667);
    view();
    const h1p = screen.getByRole("heading").getBoundingClientRect();
    const btnp = screen
      .getByRole("button", { name: "操作" })
      .getBoundingClientRect();
    expect(btnp.top).toBeGreaterThan(h1p.bottom); // 下
  });
});
