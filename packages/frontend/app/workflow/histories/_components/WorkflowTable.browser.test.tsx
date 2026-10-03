import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowTable } from "./WorkflowTable";
import { WorkflowSearchForm } from "./WorkflowSearchForm";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
  isWithinViewport,
} from "../../../../test-support/responsive";

// 実ブラウザ: 申請履歴が、スマホでは1件=1枚のカード、md以上では従来の表として表示される
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const histories: any[] = [
  {
    logId: "L1",
    targetId: "QT-1",
    targetType: "quote",
    targetName: "サンプル商事向け見積(長い件名のサンプル)",
    requestType: "REGISTER",
    applicantId: "EMP00001",
    layer: 1,
    status: "REMANDED",
    parentStatus: "REMANDED",
    approverName: "承認 花子",
    comment:
      "金額を見直してください。長いコメントのサンプルがここに入ります。".repeat(
        2,
      ),
    performedAt: "2026-09-10T01:00:00.000Z",
    flowProgress: [],
    snapshotNew: null,
    snapshotOld: null,
    applicantDepartmentId: null,
  },
  {
    logId: "L2",
    targetId: "QT-2",
    targetType: "quote",
    targetName: "別の見積",
    requestType: "UPDATE",
    applicantId: "EMP00002",
    layer: 2,
    status: "APPROVED",
    parentStatus: "APPROVED",
    approverName: null,
    comment: null,
    performedAt: null,
    flowProgress: [],
    snapshotNew: null,
    snapshotOld: null,
    applicantDepartmentId: null,
  },
];

const renderTable = (isAdmin = true) =>
  render(
    <div className="p-4">
      <WorkflowTable
        histories={histories}
        loadingData={false}
        isAdmin={isAdmin}
        userId="EMP00001-user"
        getTargetTypeJapanese={() => "見積"}
        resolveTargetTypeEditPath={async () => "/sales/quotes"}
        getEligibleApprovers={() => ""}
        onCancelRequest={() => {}}
      />
    </div>,
  );

describe("申請履歴(スマホ)", () => {
  it("1件=1枚のカード表示。項目名が各セルの上に出て、横にはみ出さない", async () => {
    await setWidth(WIDTHS.phone, 800);
    const { container } = renderTable();
    expect(getComputedStyle(container.querySelector("thead")!).display).toBe(
      "none",
    );
    const rows = Array.from(
      container.querySelectorAll("tbody > tr"),
    ) as HTMLElement[];
    expect(rows).toHaveLength(2);
    for (const tr of rows) {
      expect(getComputedStyle(tr).display).toBe("block");
      expect(isWithinViewport(tr)).toBe(true);
    }
    expect(
      getComputedStyle(
        rows[0].querySelector("td[data-label='処理状況']")!,
        "::before",
      ).content,
    ).toContain("処理状況");
    // 長いコメントは、スマホでは切り詰めずに折り返して全文を表示する
    const comment = rows[0].querySelector(
      "td[data-label='コメント / メモ']",
    ) as HTMLElement;
    expect(comment.scrollWidth).toBeLessThanOrEqual(comment.clientWidth + 1);
    expect(getComputedStyle(comment).textOverflow).not.toBe("ellipsis");
    expect(pageOverflowsHorizontally()).toBe(false);
  });

  it("管理者以外は「処理担当者」の欄を出さない", async () => {
    await setWidth(WIDTHS.phone, 800);
    const { container } = renderTable(false);
    expect(container.querySelector("td[data-label='処理担当者']")).toBeNull();
  });
});

describe.each([
  ["tablet", WIDTHS.tablet, 1024],
  ["desktop", 990, 800],
] as const)("申請履歴(%s)", (_n, width, height) => {
  it("従来の表として表示され、横にはみ出さない", async () => {
    await setWidth(width, height);
    const { container } = renderTable();
    expect(
      getComputedStyle(container.querySelector("thead")!).display,
    ).not.toBe("none");
    for (const tr of Array.from(container.querySelectorAll("tbody > tr")))
      expect(getComputedStyle(tr).display).toBe("table-row");
    expect(pageOverflowsHorizontally()).toBe(false);
  });
});

describe("申請履歴の検索欄", () => {
  it.each([
    ["phone", WIDTHS.phone],
    ["tablet", WIDTHS.tablet],
    ["desktop", 990],
  ] as const)(
    "%s: 横にはみ出さず、スマホの入力欄は16px以上",
    async (_n, width) => {
      await setWidth(width, 800);
      const { container } = render(
        <div className="p-4">
          <WorkflowSearchForm
            filters={
              {
                startDate: "",
                endDate: "",
                applicantId: "",
                targetName: "",
                status: "",
                targetType: "",
              } as any
            }
            setFilters={() => {}}
            onClear={() => {}}
            isAdmin
            userMaster={
              [{ id: "u1", name: "サンプル 太郎", employeeNumber: "E1" }] as any
            }
          />
        </div>,
      );
      expect(pageOverflowsHorizontally()).toBe(false);
      if (width < 640) {
        for (const el of Array.from(
          container.querySelectorAll("input, select"),
        )) {
          expect(
            parseFloat(getComputedStyle(el).fontSize),
            el.outerHTML.slice(0, 60),
          ).toBeGreaterThanOrEqual(16);
        }
      }
      expect(
        screen.getByRole("button", { name: /条件を初期化/ }),
      ).toBeInTheDocument();
    },
  );
});
