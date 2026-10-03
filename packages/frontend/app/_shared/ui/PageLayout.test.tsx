import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PageHeader } from "./PageHeader";
import { ListToolbar } from "./ListToolbar";
import { SidePanel } from "./SidePanel";
import { FormActions } from "./FormActions";
import { TableScroll } from "./TableScroll";

describe("PageHeader", () => {
  it("タイトル・説明・操作ボタンを表示する。説明・操作は省略できる", () => {
    const { rerender } = render(
      <PageHeader
        title="📄 見積管理"
        description="説明文"
        actions={<button>CSV</button>}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "📄 見積管理" }),
    ).toBeInTheDocument();
    expect(screen.getByText("説明文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CSV" })).toBeInTheDocument();
    rerender(<PageHeader title="タイトルだけ" />);
    expect(screen.queryByText("説明文")).not.toBeInTheDocument();
  });

  it("スマホは縦積み・sm以上は左右配置、操作ボタンは折り返せる(flex-wrap)", () => {
    const { container } = render(
      <PageHeader title="t" actions={<button>a</button>} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("flex-col");
    expect(root.className).toContain("sm:flex-row");
    expect(
      (screen.getByRole("button", { name: "a" }).parentElement as HTMLElement)
        .className,
    ).toContain("flex-wrap");
    expect(container.innerHTML).not.toMatch(/text-(slate|gray)-[1-4]00/);
  });
});

describe("ListToolbar", () => {
  // BUG-010: 画面幅で縦積み/左右配置を切り替えるのではなく、収まらなければ折り返す(タブ・ボタンを押し潰さない)
  it("左に絞り込み・右に操作を出し、1行に収まらなければ操作を次の行へ折り返す", () => {
    const { container } = render(
      <ListToolbar
        filters={<span>タブ</span>}
        actions={<button>新規</button>}
      />,
    );
    expect(screen.getByText("タブ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新規" })).toBeInTheDocument();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("flex-wrap");
    expect(root.className).toContain("justify-between");
    expect(
      (
        screen.getByRole("button", { name: "新規" })
          .parentElement as HTMLElement
      ).className,
    ).toContain("flex-wrap");
  });
});

describe("SidePanel", () => {
  it("識別子・タイトル・本文を表示し、✕と下の「閉じる」の両方で onClose を呼ぶ", () => {
    const onClose = vi.fn();
    render(
      <SidePanel eyebrow="QT-001" title="見積書プレビュー" onClose={onClose}>
        <p>本文</p>
      </SidePanel>,
    );
    expect(
      screen.getByRole("dialog", { name: "見積書プレビュー" }),
    ).toBeInTheDocument();
    expect(screen.getByText("QT-001")).toBeInTheDocument();
    expect(screen.getByText("本文")).toBeInTheDocument();
    // ✕(右上)と「閉じる」(下)の2つがあり、どちらも閉じる
    const closers = screen.getAllByRole("button", { name: "閉じる" });
    expect(closers).toHaveLength(2);
    for (const c of closers) fireEvent.click(c);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ダイアログ名・✕の名前・下のボタン文言を指定できる", () => {
    const onClose = vi.fn();
    render(
      <SidePanel
        title="t"
        ariaLabel="商談プレビュー"
        closeAriaLabel="プレビューを閉じる"
        closeLabel="閉じる"
        onClose={onClose}
      >
        x
      </SidePanel>,
    );
    expect(
      screen.getByRole("dialog", { name: "商談プレビュー" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("プレビューを閉じる"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("スマホは画面幅いっぱい・sm以上は w-96、薄いグレー文字を使わない(CLAUDE.md #20)", () => {
    render(
      <SidePanel title="t" onClose={() => {}}>
        x
      </SidePanel>,
    );
    const cls = screen.getByRole("dialog").className;
    expect(cls).toContain("w-full");
    expect(cls).toContain("sm:w-96");
    expect(screen.getByRole("dialog").innerHTML).not.toMatch(
      /text-(slate|gray)-[1-4]00/,
    );
  });
});

describe("FormActions の文言の上書き / TableScroll の bare", () => {
  it("submitLabel で確定ボタンの文言を変えられる(送信中は「<文言>中...」)", () => {
    const { rerender } = render(
      <FormActions mode="create" submitLabel="送信" onSubmit={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument();
    rerender(
      <FormActions
        mode="create"
        submitLabel="送信"
        onSubmit={() => {}}
        loading
      />,
    );
    expect(screen.getByRole("button", { name: "送信中..." })).toBeDisabled();
  });

  it("TableScroll bare: 枠(角丸・罫線・影)を付けず、横スクロールだけ持つ", () => {
    const { container } = render(
      <TableScroll bare minWidth={800}>
        <table />
      </TableScroll>,
    );
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain("overflow-x-auto");
    expect(cls).not.toContain("rounded-xl");
    expect(cls).not.toContain("border");
  });
});
