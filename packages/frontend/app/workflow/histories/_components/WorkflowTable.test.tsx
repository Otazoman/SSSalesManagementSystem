import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowTable } from "./WorkflowTable";
import { WorkflowHistoryTask } from "../_types";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

function baseTask(overrides: Partial<WorkflowHistoryTask> = {}): WorkflowHistoryTask {
  return {
    logId: "L1",
    requestId: "R1",
    targetType: "master_units",
    targetId: "PCS",
    targetName: "個",
    layer: 1,
    requestType: "REGISTER",
    applicantId: "applicant-1234567890",
    status: "PENDING",
    comment: null,
    performedAt: null,
    snapshotNew: null,
    snapshotOld: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<Parameters<typeof WorkflowTable>[0]> = {}) {
  return {
    histories: [] as WorkflowHistoryTask[],
    loadingData: false,
    isAdmin: false,
    userId: "applicant-1234567890",
    getTargetTypeJapanese: (t: string) => `[${t}]`,
    resolveTargetTypeEditPath: vi.fn(async () => "/master/units"),
    getEligibleApprovers: vi.fn(() => "承認者A"),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("WorkflowTable", () => {
  it("loadingData:trueの間は読み込み中メッセージを表示する", () => {
    render(<WorkflowTable {...baseProps({ loadingData: true })} />);
    expect(screen.getByText("履歴データを読み込み中...")).toBeInTheDocument();
  });

  it("historiesが空の場合は該当なしメッセージを表示する", () => {
    render(<WorkflowTable {...baseProps()} />);
    expect(screen.getByText("該当する決裁履歴はありません。")).toBeInTheDocument();
  });

  it("各履歴の対象名称・種別を表示する", () => {
    render(<WorkflowTable {...baseProps({ histories: [baseTask()] })} />);
    expect(screen.getByText("個")).toBeInTheDocument();
    expect(screen.getByText("REGISTER")).toBeInTheDocument();
  });

  it("プレビュークリックで展開し、もう一度押すと閉じる", async () => {
    render(<WorkflowTable {...baseProps({ histories: [baseTask()] })} />);
    await userEvent.click(screen.getByText("👁️ プレビュー"));
    expect(screen.getByText("▲ 閉じる")).toBeInTheDocument();
    await userEvent.click(screen.getByText("▲ 閉じる"));
    expect(screen.getByText("👁️ プレビュー")).toBeInTheDocument();
  });

  it("本人の最新PENDING申請には取下げボタンを表示し、クリックでonCancelRequestを呼ぶ", async () => {
    const onCancelRequest = vi.fn();
    render(
      <WorkflowTable
        {...baseProps({
          histories: [baseTask({ status: "PENDING" })],
          onCancelRequest,
        })}
      />,
    );

    const cancelButton = screen.getByRole("button", { name: "🚫 取下げ" });
    await userEvent.click(cancelButton);
    expect(onCancelRequest).toHaveBeenCalledWith("PCS", "L1");
  });

  it("取下げ確認でキャンセルした場合はonCancelRequestを呼ばない", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const onCancelRequest = vi.fn();
    render(
      <WorkflowTable
        {...baseProps({ histories: [baseTask({ status: "PENDING" })], onCancelRequest })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "🚫 取下げ" }));
    expect(onCancelRequest).not.toHaveBeenCalled();
  });

  it("本人以外の申請には取下げボタンを表示しない", () => {
    render(
      <WorkflowTable
        {...baseProps({
          histories: [baseTask({ status: "PENDING", applicantId: "other-user-000" })],
          onCancelRequest: vi.fn(),
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "🚫 取下げ" })).not.toBeInTheDocument();
  });

  it("APPROVEDステータスの申請には取下げボタンを表示しない", () => {
    render(
      <WorkflowTable
        {...baseProps({
          histories: [baseTask({ status: "APPROVED" })],
          onCancelRequest: vi.fn(),
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "🚫 取下げ" })).not.toBeInTheDocument();
  });

  it("REMANDED(差戻し)には「修正して再申請」ボタンを表示し、クリックでresolveTargetTypeEditPath経由でrouter.pushする", async () => {
    const resolveTargetTypeEditPath = vi.fn(async () => "/master/units");
    render(
      <WorkflowTable
        {...baseProps({
          histories: [baseTask({ status: "REMANDED", parentStatus: "REMANDED" })],
          resolveTargetTypeEditPath,
        })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /修正して再申請/ }));

    expect(resolveTargetTypeEditPath).toHaveBeenCalledWith("master_units", "PCS");
    await vi.waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/master/units?editId=PCS"),
    );
  });

  it("isAdmin:trueの場合は処理担当者列を表示する", () => {
    render(
      <WorkflowTable
        {...baseProps({
          isAdmin: true,
          histories: [baseTask({ status: "APPROVED", approverName: "承認太郎" })],
        })}
      />,
    );
    expect(screen.getByText("承認太郎")).toBeInTheDocument();
  });
});
