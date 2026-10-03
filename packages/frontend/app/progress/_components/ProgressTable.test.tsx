import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressTable } from "./ProgressTable";
import { PROGRESS_STAGE_KEYS, ProgressRow, ProgressStageKey, ProgressStageDoc, ProgressStageStatus } from "../_types";

function makeRow(overrides: Partial<Record<ProgressStageKey, ProgressStageDoc[]>>, extra: Partial<ProgressRow> = {}): ProgressRow {
  const stages = Object.fromEntries(PROGRESS_STAGE_KEYS.map((k) => [k, overrides[k] ?? []])) as ProgressRow["stages"];
  // 工程セルの状態は、伝票が無ければNONE、全伝票が完了ならCOMPLETED、それ以外はIN_PROGRESS(手動上書きなし)
  const stageStatuses = Object.fromEntries(
    PROGRESS_STAGE_KEYS.map((k) => {
      const docs = stages[k];
      const state = docs.length === 0 ? "NONE" : docs.every((d) => d.completed) ? "COMPLETED" : "IN_PROGRESS";
      return [k, { state, manual: false }];
    }),
  ) as Record<ProgressStageKey, ProgressStageStatus>;
  const present = Object.values(stageStatuses).filter((st) => st.state !== "NONE");
  const caseState = present.length > 0 && present.every((st) => st.state === "COMPLETED") ? "COMPLETED" : "IN_PROGRESS";
  return {
    rootKind: "sales_order",
    rootId: "SO-1",
    partnerName: "テスト商事",
    title: null,
    projectName: null,
    stages,
    stageStatuses,
    caseState,
    nextSteps: [],
    assignments: {},
    ...extra,
  };
}

describe("ProgressTable", () => {
  it("12工程の列見出しを見積→支払の順で表示する", () => {
    render(<ProgressTable rows={[]} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "案件(起点伝票)",
      "見積",
      "受注",
      "購買申請",
      "発注",
      "入荷",
      "入庫",
      "仕入",
      "出荷",
      "出庫",
      "売上",
      "請求",
      "支払",
    ]);
    expect(screen.getByText("該当する案件がありません")).toBeTruthy();
  });

  it("伝票・担当者・承認ステップの進み具合を表示する", () => {
    render(
      <ProgressTable
        rows={[
          makeRow({
            sales_order: [
              {
                id: "SO-1",
                status: "PENDING_APPROVAL",
                assigneeName: "営業太郎",
                approval: { requestStatus: "PENDING", approvedLayers: 1, totalLayers: 2, pendingRoleName: "部長" },
                completed: false,
              },
            ],
            billing: [{ id: "B-1", status: "ISSUED", assigneeName: null, approval: null, completed: true }],
          }),
        ]}
      />,
    );
    expect(screen.getByText("テスト商事")).toBeTruthy();
    expect(screen.getByText("担当: 営業太郎")).toBeTruthy();
    expect(screen.getByText(/承認 1\/2 → 部長待ち/)).toBeTruthy();
    expect(screen.getByText("🟡 承認申請中")).toBeTruthy();
    expect(screen.getByText("🟢 発行済み")).toBeTruthy(); // 請求は請求・支払ヘッダー用の辞書
  });

  it("次の処理と担当を表示し、担当設定は更新権限がある場合(assignment指定)のみ表示する", () => {
    const row = makeRow(
      {},
      {
        nextSteps: [{ chain: "sales", stageKey: "shipment_instruction", assigneeName: "出荷花子", source: "case" }],
      },
    );
    const { rerender } = render(<ProgressTable rows={[row]} />);
    expect(screen.getByText(/次: 出荷/)).toBeTruthy();
    expect(screen.getByText((text) => text.includes("担当: 出荷花子(個別)"))).toBeTruthy();
    expect(screen.queryByText("担当設定")).toBeNull();

    rerender(<ProgressTable rows={[row]} assignment={{ employees: [{ employeeNumber: "EMP1", name: "山田" }], onAssign: () => {} }} />);
    expect(screen.getByText("担当設定")).toBeTruthy();
  });

  it("次工程が無い案件は「なし(最終工程まで完了)」、担当未設定は「未設定」と表示する", () => {
    render(
      <ProgressTable
        rows={[
          makeRow({}, { rootId: "SO-9" }),
          makeRow({}, { rootId: "SO-8", nextSteps: [{ chain: "sales", stageKey: "billing", assigneeName: null, source: null }] }),
        ]}
      />,
    );
    expect(screen.getByText(/次の処理: なし/)).toBeTruthy();
    expect(screen.getByText(/担当: 未設定/)).toBeTruthy();
  });

  it("工程ごとに完了/進行中バッジを表示し、案件の件名・プロジェクト・案件全体の状態も表示する", () => {
    render(
      <ProgressTable
        rows={[
          makeRow(
            {
              sales_order: [{ id: "SO-1", status: "APPROVED", assigneeName: null, approval: null, completed: false }],
              billing: [{ id: "B-1", status: "ISSUED", assigneeName: null, approval: null, completed: true }],
            },
            { title: "太陽光設置", projectName: "本社ビル" },
          ),
        ]}
      />,
    );
    expect(screen.getByText("太陽光設置")).toBeTruthy();
    expect(screen.getByText("プロジェクト: 本社ビル")).toBeTruthy();
    // 受注=進行中、請求=完了、案件全体=進行中
    expect(screen.getAllByText("進行中")).toHaveLength(2);
    expect(screen.getAllByText("完了")).toHaveLength(1);
  });

  it("進捗確認は閲覧専用: 完了/進行中を変更する操作(完了にする等)は表示しない", () => {
    const row = makeRow({
      sales_order: [{ id: "SO-1", status: "APPROVED", assigneeName: null, approval: null, completed: false }],
      billing: [{ id: "B-1", status: "ISSUED", assigneeName: null, approval: null, completed: true }],
    });
    render(<ProgressTable rows={[row]} />);

    expect(screen.queryByText("完了にする")).toBeNull();
    expect(screen.queryByText("進行中に戻す")).toBeNull();
    expect(screen.queryByText("自動判定に戻す")).toBeNull();
  });

  it("各伝票の画面で手動設定された工程は「手動」と表示する(表示のみ)", () => {
    const row = makeRow({
      sales_order: [{ id: "SO-1", status: "APPROVED", assigneeName: null, approval: null, completed: true, manual: true }],
    });
    row.stageStatuses.sales_order = { state: "COMPLETED", manual: true };
    render(<ProgressTable rows={[row]} />);

    expect(screen.getByText("手動")).toBeTruthy();
    expect(screen.queryByText("自動判定に戻す")).toBeNull();
  });
});
