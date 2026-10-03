import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DepartmentTable from "./DepartmentTable";
import { DepartmentRecord } from "../_types";

const departments: DepartmentRecord[] = [
  {
    id: "0001",
    name: "本社",
    parentDepartmentId: null,
    surrogateId: "s1",
    memo: null,
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: null,
  },
  {
    id: "0002",
    name: "開発部",
    parentDepartmentId: "0001",
    parentDepartmentSurrogateId: "s1",
    surrogateId: "s2",
    memo: "開発チーム",
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: null,
  },
  {
    id: "0003",
    name: "廃止済み部署",
    parentDepartmentId: null,
    surrogateId: "s3",
    memo: null,
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: "2020-12-31T00:00:00.000Z",
  },
];

function setup(overrides: Partial<Parameters<typeof DepartmentTable>[0]> = {}) {
  const onSelectRow = vi.fn();
  const onDeleteClick = vi.fn();
  const onRestoreClick = vi.fn();
  render(
    <DepartmentTable
      departments={departments}
      targetDate="2026-09-01"
      canUpdate
      canDelete
      onSelectRow={onSelectRow}
      onDeleteClick={onDeleteClick}
      onRestoreClick={onRestoreClick}
      {...overrides}
    />,
  );
  return { onSelectRow, onDeleteClick, onRestoreClick };
}

describe("DepartmentTable", () => {
  it("親子関係をツリー階層としてインデント表示する(子は└──付き)", () => {
    setup();
    expect(screen.getByText("本社")).toBeInTheDocument();
    expect(screen.getByText("└──")).toBeInTheDocument();
  });

  it("targetDateより前にvalidToが切れている部署は「無効(期限切)」表示になる", () => {
    setup();
    expect(screen.getByText("無効(期限切)")).toBeInTheDocument();
  });

  it("有効な部署行には「変更」「無効化」ボタンを表示する", () => {
    setup();
    expect(screen.getAllByRole("button", { name: "変更" }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: "無効化" }).length).toBe(2);
  });

  it("期限切れ部署の行には「復元」ボタンのみ表示する", () => {
    setup();
    expect(screen.getByRole("button", { name: "復元" })).toBeInTheDocument();
  });

  it("行クリックでonSelectRowを呼ぶ", async () => {
    const { onSelectRow } = setup();
    await userEvent.click(screen.getByText("本社"));
    expect(onSelectRow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "0001", name: "本社" }),
    );
  });

  it("「無効化」クリックはonDeleteClickのみ呼び行クリックへ伝播しない", async () => {
    const { onSelectRow, onDeleteClick } = setup();
    await userEvent.click(screen.getAllByRole("button", { name: "無効化" })[0]);
    expect(onDeleteClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "0001" }),
    );
    expect(onSelectRow).not.toHaveBeenCalled();
  });

  it("「復元」クリックでonRestoreClickを呼ぶ", async () => {
    const { onRestoreClick } = setup();
    await userEvent.click(screen.getByRole("button", { name: "復元" }));
    expect(onRestoreClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "0003" }),
    );
  });

  it("データが空の場合は空メッセージを表示する", () => {
    setup({ departments: [] });
    expect(
      screen.getByText("該当するデータはありません"),
    ).toBeInTheDocument();
  });

  it("3階層の親子関係は孫までインデント(└──2個分)して表示する", () => {
    const threeLevel: DepartmentRecord[] = [
      {
        id: "R",
        name: "ルート組織",
        parentDepartmentId: null,
        surrogateId: "sR",
        memo: null,
        validFrom: "2020-01-01T00:00:00.000Z",
        validTo: null,
      },
      {
        id: "C",
        name: "子組織",
        parentDepartmentId: "R",
        parentDepartmentSurrogateId: "sR",
        surrogateId: "sC",
        memo: null,
        validFrom: "2020-01-01T00:00:00.000Z",
        validTo: null,
      },
      {
        id: "G",
        name: "孫組織",
        parentDepartmentId: "C",
        parentDepartmentSurrogateId: "sC",
        surrogateId: "sG",
        memo: null,
        validFrom: "2020-01-01T00:00:00.000Z",
        validTo: null,
      },
    ];
    setup({ departments: threeLevel });
    expect(screen.getAllByText("└──")).toHaveLength(2);
    expect(screen.getByText("孫組織")).toBeInTheDocument();
  });

  it("自分自身を親に指定した部署はルート扱いになる(自己参照ガード)", () => {
    const selfParent: DepartmentRecord[] = [
      {
        id: "X",
        name: "自己参照組織",
        parentDepartmentId: "X",
        parentDepartmentSurrogateId: "sX",
        surrogateId: "sX",
        memo: null,
        validFrom: "2020-01-01T00:00:00.000Z",
        validTo: null,
      },
    ];
    setup({ departments: selfParent });
    expect(screen.getByText("自己参照組織")).toBeInTheDocument();
  });
});
