import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FlowList } from "./FlowList";
import { ApprovalFlowRecord, ScreenRecord } from "../_types";

const screens: ScreenRecord[] = [
  { resource: "master_units", name: "単位マスタ", category: "business_master" },
];

const activeFlow: ApprovalFlowRecord = {
  id: "f1",
  name: "購買申請_通常",
  requestType: "master_units",
  minAmount: 0,
  maxAmount: 100000,
  isActive: true,
  matchField: null,
  matchValue: null,
  steps: [
    { id: "s1", stepOrder: 1, approverRoleId: "general_user", roleName: "一般ユーザー", targetDepartmentSurrogateId: null, stepName: "承認", memo: null },
  ],
};
const inactiveFlow: ApprovalFlowRecord = { ...activeFlow, id: "f2", isActive: false, name: "廃止フロー" };

function setup(flows: ApprovalFlowRecord[], overrides: Partial<Parameters<typeof FlowList>[0]> = {}) {
  const onSelectRow = vi.fn();
  const handleDisableFlow = vi.fn();
  const handleRestoreFlow = vi.fn();
  const handlePurgeFlow = vi.fn();
  render(
    <FlowList
      filteredFlows={flows}
      screens={screens}
      canUpdate
      canDelete
      onSelectRow={onSelectRow}
      handleDisableFlow={handleDisableFlow}
      handleRestoreFlow={handleRestoreFlow}
      handlePurgeFlow={handlePurgeFlow}
      {...overrides}
    />,
  );
  return { onSelectRow, handleDisableFlow, handleRestoreFlow, handlePurgeFlow };
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("FlowList", () => {
  it("画面リソース名を解決して対象種別に表示する", () => {
    setup([activeFlow]);
    expect(screen.getByText("単位マスタ")).toBeInTheDocument();
  });

  it("金額レンジとステップシーケンスを表示する", () => {
    setup([activeFlow]);
    expect(screen.getByText(/0 円 ≦ 金額 ＜/)).toBeInTheDocument();
    expect(screen.getByText(/一般ユーザー/)).toBeInTheDocument();
  });

  it("有効フローには「変更」「無効化」ボタンを表示する", () => {
    setup([activeFlow]);
    expect(screen.getByRole("button", { name: "変更" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "無効化" })).toBeInTheDocument();
  });

  it("無効フローには「復元」「削除」ボタンを表示する", () => {
    setup([inactiveFlow]);
    expect(screen.getByRole("button", { name: "復元" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
  });

  it("行クリックでonSelectRowを呼ぶ", async () => {
    const { onSelectRow } = setup([activeFlow]);
    await userEvent.click(screen.getByText("購買申請_通常"));
    expect(onSelectRow).toHaveBeenCalledWith(activeFlow);
  });

  it("無効化ボタンクリックでhandleDisableFlowをid/nameで呼ぶ", async () => {
    const { handleDisableFlow } = setup([activeFlow]);
    await userEvent.click(screen.getByRole("button", { name: "無効化" }));
    expect(handleDisableFlow).toHaveBeenCalledWith("f1", "購買申請_通常");
  });

  it("復元ボタンクリックでhandleRestoreFlowをflowで呼ぶ", async () => {
    const { handleRestoreFlow } = setup([inactiveFlow]);
    await userEvent.click(screen.getByRole("button", { name: "復元" }));
    expect(handleRestoreFlow).toHaveBeenCalledWith(inactiveFlow);
  });

  it("matchFieldが設定されている場合は条件バッジを表示する", () => {
    setup([{ ...activeFlow, matchField: "requestType", matchValue: "CONSUMABLE" }]);
    expect(screen.getByText("条件: requestType = CONSUMABLE")).toBeInTheDocument();
  });

  it("matchFieldが未設定の場合は条件バッジを表示しない", () => {
    setup([activeFlow]);
    expect(screen.queryByText(/条件:/)).not.toBeInTheDocument();
  });

  it("データが空の場合は空メッセージを表示する", () => {
    setup([]);
    expect(screen.getByText("該当するデータはありません")).toBeInTheDocument();
  });
});
