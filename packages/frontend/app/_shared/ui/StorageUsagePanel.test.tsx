import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StorageUsagePanel, formatStorageBytes } from "./StorageUsagePanel";

// REQ-001: D1・R2 の使用容量の表示
describe("formatStorageBytes", () => {
  it("B・KB・MB・GB で表す", () => {
    expect(formatStorageBytes(512)).toBe("512 B");
    expect(formatStorageBytes(1536)).toBe("1.5 KB");
    expect(formatStorageBytes(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatStorageBytes(3 * 1024 ** 3)).toBe("3.00 GB");
    expect(formatStorageBytes(null)).toBe("-");
  });
});

describe("StorageUsagePanel", () => {
  it("対象ごとの容量と総容量を表示する", () => {
    render(
      <StorageUsagePanel
        title="使用容量"
        rows={[
          { key: "a", label: "見積添付", sizeBytes: 2048, note: "3 ファイル" },
          { key: "b", label: "品目添付", sizeBytes: null, error: "失敗" },
        ]}
        totalBytes={2048}
        totalNote="3 ファイル"
        loading={false}
      />,
    );
    expect(screen.getByText("見積添付")).toBeInTheDocument();
    expect(screen.getAllByText("2.0 KB")).toHaveLength(2);
    expect(screen.getByText("総容量")).toBeInTheDocument();
    expect(screen.getByText(/取得できませんでした/)).toBeInTheDocument();
  });

  it("onLoad を渡すと計算のボタンを出し、押すと呼ぶ", () => {
    const onLoad = vi.fn();
    render(<StorageUsagePanel title="使用容量" rows={null} totalBytes={null} loading={false} onLoad={onLoad} />);
    fireEvent.click(screen.getByRole("button", { name: "容量を計算" }));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
