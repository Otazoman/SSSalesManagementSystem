import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskTable } from "./TaskTable";
import { WorkflowTask } from "../_types";

function baseTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    logId: "L1",
    requestId: "R1",
    targetType: "master_units",
    targetId: "PCS",
    targetName: "個",
    layer: 1,
    requestType: "REGISTER",
    applicantId: "applicant-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseProps(overrides: Partial<Parameters<typeof TaskTable>[0]> = {}) {
  return {
    tasks: [] as WorkflowTask[],
    canUpdate: true,
    processingId: null,
    commentMap: {},
    expandedTaskId: null,
    selectedLogIds: [] as string[],
    getTargetTypeJapanese: (t: string) => `[${t}]`,
    getEligibleApprovers: vi.fn(() => "承認者A"),
    onSelectAll: vi.fn(),
    onSelectOne: vi.fn(),
    onToggleExpand: vi.fn(),
    onCommentChange: vi.fn(),
    onAction: vi.fn(),
    ...overrides,
  };
}

describe("TaskTable", () => {
  it("tasksが空の場合は該当なしメッセージを表示する", () => {
    render(<TaskTable {...baseProps()} />);
    expect(
      screen.getByText("現在、あなた宛ての未決済承認タスクはありません。📥"),
    ).toBeInTheDocument();
  });

  it("各タスクの対象名称・件数を表示する", () => {
    render(<TaskTable {...baseProps({ tasks: [baseTask()] })} />);
    expect(screen.getByText("個")).toBeInTheDocument();
    expect(screen.getByText("REGISTER")).toBeInTheDocument();
  });

  it("行チェックボックスのクリックでonSelectOneを呼ぶ", async () => {
    const onSelectOne = vi.fn();
    render(<TaskTable {...baseProps({ tasks: [baseTask()], onSelectOne })} />);
    const checkboxes = screen.getAllByRole("checkbox");
    // checkboxes[0]はヘッダーの全選択チェックボックス
    await userEvent.click(checkboxes[1]);
    expect(onSelectOne).toHaveBeenCalledWith("L1");
  });

  it("ヘッダーの全選択チェックボックスはtasks全件選択済みの場合checked", () => {
    render(
      <TaskTable
        {...baseProps({ tasks: [baseTask()], selectedLogIds: ["L1"] })}
      />,
    );
    const headerCheckbox = screen.getAllByRole("checkbox")[0];
    expect(headerCheckbox).toBeChecked();
  });

  it("canUpdate:falseの場合は「権限なし」を表示し操作ボタンを表示しない", () => {
    render(<TaskTable {...baseProps({ tasks: [baseTask()], canUpdate: false })} />);
    expect(screen.getByText("🔒 権限なし")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "承認" })).not.toBeInTheDocument();
  });

  it("「承認」クリックでonAction(task, 'approve')を呼ぶ", async () => {
    const onAction = vi.fn();
    render(<TaskTable {...baseProps({ tasks: [baseTask()], onAction })} />);
    await userEvent.click(screen.getByRole("button", { name: "承認" }));
    expect(onAction).toHaveBeenCalledWith(baseTask(), "approve");
  });

  it("expandedTaskIdが一致する行はプレビュー行を展開表示する", () => {
    render(
      <TaskTable
        {...baseProps({
          tasks: [baseTask({ flowProgress: [], previewData: { code: "PCS" } })],
          expandedTaskId: "L1",
        })}
      />,
    );
    expect(screen.getByText("📝 申請内容のプレビュー")).toBeInTheDocument();
  });

  it("「プレビュー」クリックでonToggleExpandを呼ぶ", async () => {
    const onToggleExpand = vi.fn();
    render(<TaskTable {...baseProps({ tasks: [baseTask()], onToggleExpand })} />);
    await userEvent.click(screen.getByText("👁️ プレビュー"));
    expect(onToggleExpand).toHaveBeenCalledWith("L1");
  });

  it("コメント入力でonCommentChangeを呼ぶ", async () => {
    const onCommentChange = vi.fn();
    render(<TaskTable {...baseProps({ tasks: [baseTask()], onCommentChange })} />);
    await userEvent.type(
      screen.getByPlaceholderText("差戻し理由の記述、または承認メモ(任意)"),
      "A",
    );
    expect(onCommentChange).toHaveBeenCalledWith("L1", "A");
  });
});
