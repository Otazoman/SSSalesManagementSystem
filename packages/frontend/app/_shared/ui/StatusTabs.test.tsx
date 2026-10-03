import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusTabs } from "./StatusTabs";

const options = [
  { value: "active", label: "🟢 有効" },
  { value: "suspended", label: "🔴 無効" },
];

describe("StatusTabs", () => {
  it("全選択肢を表示する", () => {
    render(<StatusTabs options={options} value="active" onChange={vi.fn()} />);
    expect(screen.getByText("🟢 有効")).toBeInTheDocument();
    expect(screen.getByText("🔴 無効")).toBeInTheDocument();
  });

  it("タブクリックでonChangeにvalueを渡す", async () => {
    const onChange = vi.fn();
    render(<StatusTabs options={options} value="active" onChange={onChange} />);
    await userEvent.click(screen.getByText("🔴 無効"));
    expect(onChange).toHaveBeenCalledWith("suspended");
  });
});
