import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FlowForm } from "./FlowForm";
import {
  DepartmentOption,
  RoleRecord,
  ScreenRecord,
  BuilderStep,
} from "../_types";

const roles: RoleRecord[] = [{ id: "general_user", name: "一般ユーザー" }];
const screens: ScreenRecord[] = [
  { resource: "master_units", name: "単位マスタ", category: "business_master" },
];
const departmentOptions: DepartmentOption[] = [
  {
    surrogateId: "d1",
    id: "0001",
    name: "開発部",
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: null,
  },
];

function baseProps(overrides: Partial<Parameters<typeof FlowForm>[0]> = {}) {
  return {
    canCreate: true,
    canUpdate: true,
    editingFlowId: null,
    flowName: "",
    setFlowName: vi.fn(),
    requestType: "",
    setRequestType: vi.fn(),
    minAmount: "0",
    setMinAmount: vi.fn(),
    maxAmount: "999999999",
    setMaxAmount: vi.fn(),
    matchField: "",
    setMatchField: vi.fn(),
    matchValue: "",
    setMatchValue: vi.fn(),
    roles,
    selectedRoleId: "general_user",
    setSelectedRoleId: vi.fn(),
    departmentOptions,
    selectedDepartmentSurrogateId: null,
    setSelectedDepartmentSurrogateId: vi.fn(),
    stepName: "",
    setStepName: vi.fn(),
    stepMemo: "",
    setStepMemo: vi.fn(),
    builderSteps: [] as BuilderStep[],
    addStepToBuilder: vi.fn(),
    removeStepFromBuilder: vi.fn(),
    handleSubmitFlow: vi.fn((e: React.SyntheticEvent) => e.preventDefault()),
    handleCancelEdit: vi.fn(),
    screens,
    ...overrides,
  };
}

describe("FlowForm", () => {
  it("新規登録時は「新規個別ルート定義」を表示する", () => {
    render(<FlowForm {...baseProps()} />);
    expect(screen.getByText("新規個別ルート定義")).toBeInTheDocument();
  });

  it("編集時は「承認フロー情報の編集」とキャンセルボタンを表示する", () => {
    render(<FlowForm {...baseProps({ editingFlowId: "f1" })} />);
    expect(screen.getByText("承認フロー情報の編集")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "キャンセル" }),
    ).toBeInTheDocument();
  });

  it("組み立て済みのbuilderStepsを一覧表示する", () => {
    render(
      <FlowForm
        {...baseProps({
          builderSteps: [
            {
              approverRoleId: "general_user",
              targetDepartmentSurrogateId: "d1",
              stepName: "承認",
              memo: "",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("承認")).toBeInTheDocument();
    expect(screen.getAllByText("一般ユーザー").length).toBeGreaterThan(0);
    expect(screen.getByText("(開発部)")).toBeInTheDocument();
  });

  it("「＋ 追加」クリックでaddStepToBuilderを呼ぶ", async () => {
    const addStepToBuilder = vi.fn();
    render(<FlowForm {...baseProps({ addStepToBuilder })} />);
    await userEvent.click(screen.getByRole("button", { name: "＋ 追加" }));
    expect(addStepToBuilder).toHaveBeenCalledTimes(1);
  });

  it("ステップ削除クリックでremoveStepFromBuilderをindexで呼ぶ", async () => {
    const removeStepFromBuilder = vi.fn();
    render(
      <FlowForm
        {...baseProps({
          removeStepFromBuilder,
          builderSteps: [
            {
              approverRoleId: "general_user",
              targetDepartmentSurrogateId: null,
              stepName: null,
              memo: "",
            },
          ],
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(removeStepFromBuilder).toHaveBeenCalledWith(0);
  });

  it("canCreate:falseの新規登録では「閲覧専用」を表示しボタンを無効化する", () => {
    render(<FlowForm {...baseProps({ canCreate: false })} />);
    expect(screen.getByText("閲覧専用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登録" })).toBeDisabled();
  });

  it("フォーム送信でhandleSubmitFlowを呼ぶ", async () => {
    const handleSubmitFlow = vi.fn((e: React.SyntheticEvent) =>
      e.preventDefault(),
    );
    render(
      <FlowForm
        {...baseProps({
          handleSubmitFlow,
          flowName: "テストフロー",
          requestType: "master_units",
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "登録" }));
    expect(handleSubmitFlow).toHaveBeenCalledTimes(1);
  });

  it("詳細マッチ条件の入力でsetMatchField/setMatchValueを呼ぶ", async () => {
    const setMatchField = vi.fn();
    const setMatchValue = vi.fn();
    render(<FlowForm {...baseProps({ setMatchField, setMatchValue })} />);
    await userEvent.type(screen.getByPlaceholderText("例: requestType"), "a");
    await userEvent.type(screen.getByPlaceholderText("例: CONSUMABLE"), "b");
    expect(setMatchField).toHaveBeenCalledWith("a");
    expect(setMatchValue).toHaveBeenCalledWith("b");
  });

  it("既存のmatchField/matchValueを入力欄に反映する", () => {
    render(
      <FlowForm
        {...baseProps({ matchField: "requestType", matchValue: "CONSUMABLE" })}
      />,
    );
    expect(screen.getByPlaceholderText("例: requestType")).toHaveValue(
      "requestType",
    );
    expect(screen.getByPlaceholderText("例: CONSUMABLE")).toHaveValue(
      "CONSUMABLE",
    );
  });
});
