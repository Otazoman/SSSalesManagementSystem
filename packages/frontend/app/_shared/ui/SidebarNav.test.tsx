import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SidebarNav } from "./SidebarNav";
import type { MenuSection } from "../../types";

const item = (resource: string, title: string, path: string) => ({
  resource,
  title,
  path,
  icon: "📄",
  category: "x",
});

const sections: MenuSection[] = [
  {
    sectionTitle: "日常業務",
    items: [
      item("sales_quotes", "見積管理", "/sales/quotes"),
      item("sales_orders", "受注管理", "/sales/orders"),
    ],
  },
  {
    sectionTitle: "システム管理",
    items: [item("admin_users", "ユーザー管理", "/admin/users")],
  },
];

describe("SidebarNav(権限のない項目は表示しない)", () => {
  it("権限のある項目だけ表示する。無効表示(🔒・disabled)は出さない", () => {
    render(
      <SidebarNav
        sections={sections}
        canOpen={(r) => r !== "sales_orders"}
        currentPath="/"
        onNavigate={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /見積管理/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("受注管理")).not.toBeInTheDocument();
    expect(screen.queryByText("🔒")).not.toBeInTheDocument();
    for (const b of screen.getAllByRole("button")) expect(b).not.toBeDisabled();
  });

  it("項目が1つも残らないセクションは見出しごと出さない", () => {
    render(
      <SidebarNav
        sections={sections}
        canOpen={(r) => r !== "admin_users"}
        currentPath="/"
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText("日常業務")).toBeInTheDocument();
    expect(screen.queryByText("システム管理")).not.toBeInTheDocument();
  });

  it("すべて権限がなければ何も出さない", () => {
    const { container } = render(
      <SidebarNav
        sections={sections}
        canOpen={() => false}
        currentPath="/"
        onNavigate={() => {}}
      />,
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(screen.queryByText("日常業務")).not.toBeInTheDocument();
  });

  it("クリックでその画面へ移動する。現在の画面は強調される", () => {
    const onNavigate = vi.fn();
    render(
      <SidebarNav
        sections={sections}
        canOpen={() => true}
        currentPath="/sales/orders"
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /見積管理/ }));
    expect(onNavigate).toHaveBeenCalledWith("/sales/quotes");
    expect(
      screen.getByRole("button", { name: /受注管理/ }).className,
    ).toContain("bg-indigo-50");
    expect(
      screen.getByRole("button", { name: /見積管理/ }).className,
    ).not.toContain("bg-indigo-50");
  });

  it("文字色: 薄いグレー(slate-400以下)を使わない(CLAUDE.md #20)", () => {
    const { container } = render(
      <SidebarNav
        sections={sections}
        canOpen={() => true}
        currentPath="/"
        onNavigate={() => {}}
      />,
    );
    expect(container.innerHTML).not.toMatch(/text-(slate|gray)-[1-4]00/);
  });
});

describe("SidebarNav(ツールチップ)", () => {
  it("各メニュー項目に、メニュー名の全体をツールチップ(title)として付ける", () => {
    render(
      <SidebarNav
        sections={[
          {
            sectionTitle: "業務",
            items: [item("workflow_tasks", "承認タスク管理(未処理・判定)", "/workflow/tasks")],
          },
        ]}
        canOpen={() => true}
        currentPath="/"
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTitle("承認タスク管理(未処理・判定)")).toBeInTheDocument();
  });
});
