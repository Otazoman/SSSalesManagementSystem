import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusPillTabs } from "./StatusPillTabs";

const options = [
  { value: "draft", label: "下書き" },
  { value: "sent", label: "送付済み" },
];

describe("StatusPillTabs", () => {
  it("全選択肢を表示する", () => {
    render(<StatusPillTabs options={options} value="draft" onChange={vi.fn()} />);
    expect(screen.getByText("下書き")).toBeInTheDocument();
    expect(screen.getByText("送付済み")).toBeInTheDocument();
  });

  it("ピルクリックでonChangeにvalueを渡す", async () => {
    const onChange = vi.fn();
    render(<StatusPillTabs options={options} value="draft" onChange={onChange} />);
    await userEvent.click(screen.getByText("送付済み"));
    expect(onChange).toHaveBeenCalledWith("sent");
  });
});
