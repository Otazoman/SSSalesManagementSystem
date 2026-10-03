import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskTable } from "./TaskTable";
import { BulkActionPanel } from "./BulkActionPanel";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
  isWithinViewport,
} from "../../../../test-support/responsive";

// 実ブラウザ: 承認タスクの一覧が、スマホでは1件=1枚のカード(横スクロール不要・操作ボタンは44px以上)、
// md以上では従来の表として表示される
const tasks: any[] = [1, 2, 3].map((i) => ({
  logId: `L${i}`,
  targetType: "quote",
  targetName: `サンプル商事向け見積(長い件名のサンプル${i})`,
  targetId: `QT-2026090${i}-001-1`,
  requestType: "REGISTER",
  applicantId: "EMP001",
  layer: 1,
  createdAt: "2026-09-10T01:00:00.000Z",
  flowProgress: [],
  previewData: {},
  applicantDepartmentId: null,
}));

const renderTable = (
  canUpdate = true,
  onAction = vi.fn(),
  onSelectOne = vi.fn(),
) =>
  render(
    <div className="p-4 space-y-4">
      <BulkActionPanel
        selectedCount={1}
        bulkComment=""
        isProcessing={false}
        onCommentChange={() => {}}
        onBulkAction={() => {}}
      />
      <TaskTable
        tasks={tasks}
        canUpdate={canUpdate}
        processingId={null}
        commentMap={{}}
        expandedTaskId={null}
        selectedLogIds={[]}
        getTargetTypeJapanese={() => "見積"}
        getEligibleApprovers={() => "承認者"}
        onSelectAll={() => {}}
        onSelectOne={onSelectOne}
        onToggleExpand={() => {}}
        onCommentChange={() => {}}
        onAction={onAction}
      />
    </div>,
  );

describe("承認タスク一覧(スマホ)", () => {
  it("1件=1枚のカード表示になり、列見出しは隠れて各セルの上に項目名が出る。ページは横にはみ出さない", async () => {
    await setWidth(WIDTHS.phone, 800);
    const { container } = renderTable();
    expect(getComputedStyle(container.querySelector("thead")!).display).toBe(
      "none",
    );
    const rows = Array.from(
      container.querySelectorAll("tbody > tr"),
    ) as HTMLElement[];
    expect(rows).toHaveLength(3);
    for (const tr of rows) expect(getComputedStyle(tr).display).toBe("block");
    const label = getComputedStyle(
      rows[0].querySelector("td[data-label='現在の承認段階']")!,
      "::before",
    ).content;
    expect(label).toContain("現在の承認段階");
    expect(pageOverflowsHorizontally()).toBe(false);
    for (const tr of rows) expect(isWithinViewport(tr)).toBe(true);
  });

  it("承認・差戻しは指で押せる大きさ(44px以上)で、押すと処理が呼ばれる。コメント欄は16px以上", async () => {
    await setWidth(WIDTHS.phone, 800);
    const onAction = vi.fn();
    const { container } = renderTable(true, onAction);
    const approve = screen.getAllByRole("button", { name: "承認" })[0];
    const remand = screen.getAllByRole("button", { name: "差戻し" })[0];
    expect(approve.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(remand.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(isWithinViewport(approve) && isWithinViewport(remand)).toBe(true);
    fireEvent.click(approve);
    expect(onAction).toHaveBeenCalledWith(tasks[0], "approve");
    const input = container.querySelector(
      "tbody input[type=text]",
    ) as HTMLElement;
    expect(parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(
      16,
    );
  });

  it("一括操作パネル: 一括承認・一括差戻しが画面内に収まる", async () => {
    await setWidth(WIDTHS.phone, 800);
    renderTable();
    for (const name of [/一括承認/, /一括差戻し/]) {
      const b = screen.getByRole("button", { name });
      expect(isWithinViewport(b)).toBe(true);
      expect(b.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});

describe.each([
  ["tablet", WIDTHS.tablet, 1024],
  ["desktop", 990, 800],
] as const)("承認タスク一覧(%s)", (_n, width, height) => {
  it("従来の表として表示され(列見出しあり・行はtable-row)、横にはみ出さない", async () => {
    await setWidth(width, height);
    const { container } = renderTable();
    expect(
      getComputedStyle(container.querySelector("thead")!).display,
    ).not.toBe("none");
    const rows = Array.from(
      container.querySelectorAll("tbody > tr"),
    ) as HTMLElement[];
    for (const tr of rows)
      expect(getComputedStyle(tr).display).toBe("table-row");
    // 項目名(::before)は表では表示しない
    expect(
      getComputedStyle(
        rows[0].querySelector("td[data-label='操作']")!,
        "::before",
      ).display,
    ).toBe("none");
    expect(pageOverflowsHorizontally()).toBe(false);
  });
});

describe("権限なし", () => {
  it("承認・差戻しの代わりに「権限なし」を表示する", async () => {
    await setWidth(WIDTHS.phone, 800);
    renderTable(false);
    expect(screen.queryByRole("button", { name: "承認" })).toBeNull();
    expect(screen.getAllByText(/権限なし/).length).toBe(3);
  });
});
