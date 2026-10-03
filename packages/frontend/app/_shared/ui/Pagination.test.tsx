import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination } from "./Pagination";

describe("Pagination", () => {
  it("paginationEnabled:falseの場合は何も描画しない", () => {
    const { container } = render(
      <Pagination
        paginationEnabled={false}
        page={1}
        totalPages={1}
        total={0}
        limit={50}
        onPageChange={vi.fn()}
        onLimitChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("件数表示・ページ番号を表示する", () => {
    render(
      <Pagination
        paginationEnabled
        page={2}
        totalPages={3}
        total={120}
        limit={50}
        onPageChange={vi.fn()}
        onLimitChange={vi.fn()}
      />,
    );
    expect(screen.getByText("120", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("1ページ目では「前へ」が無効、最終ページでは「次へ」が無効になる", () => {
    render(
      <Pagination
        paginationEnabled
        page={1}
        totalPages={1}
        total={10}
        limit={50}
        onPageChange={vi.fn()}
        onLimitChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "前へ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
  });

  it("「次へ」クリックでonPageChange(page+1)を呼ぶ", async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        paginationEnabled
        page={1}
        totalPages={2}
        total={100}
        limit={50}
        onPageChange={onPageChange}
        onLimitChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("件数セレクト変更でonLimitChangeを数値で呼ぶ", async () => {
    const onLimitChange = vi.fn();
    render(
      <Pagination
        paginationEnabled
        page={1}
        totalPages={1}
        total={10}
        limit={50}
        onPageChange={vi.fn()}
        onLimitChange={onLimitChange}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "100");
    expect(onLimitChange).toHaveBeenCalledWith(100);
  });
});
