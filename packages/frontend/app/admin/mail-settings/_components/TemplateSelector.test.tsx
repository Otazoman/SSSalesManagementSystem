import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateSelector } from "./TemplateSelector";

const templates = [
  { id: "quote", name: "見積書" } as never,
  { id: "order", name: "注文請書" } as never,
];

describe("TemplateSelector", () => {
  it("全テンプレート名を表示する", () => {
    render(<TemplateSelector templates={templates} activeTab="quote" onSelectTab={vi.fn()} />);
    expect(screen.getByText("見積書")).toBeInTheDocument();
    expect(screen.getByText("注文請書")).toBeInTheDocument();
  });

  it("クリックでonSelectTabにidを渡す", async () => {
    const onSelectTab = vi.fn();
    render(<TemplateSelector templates={templates} activeTab="quote" onSelectTab={onSelectTab} />);
    await userEvent.click(screen.getByText("注文請書"));
    expect(onSelectTab).toHaveBeenCalledWith("order");
  });

  it("activeTabの項目は強調スタイルクラスを持つ", () => {
    render(<TemplateSelector templates={templates} activeTab="quote" onSelectTab={vi.fn()} />);
    expect(screen.getByText("見積書").closest("button")?.className).toContain("bg-indigo-50");
    expect(screen.getByText("注文請書").closest("button")?.className).not.toContain(
      "bg-indigo-50",
    );
  });
});
