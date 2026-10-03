import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LogTable } from "./LogTable";
import { AuditLogRecord } from "../_types";

function makeLog(overrides: Partial<AuditLogRecord> = {}): AuditLogRecord {
  return {
    id: "1",
    userId: "EMP001",
    action: "CREATE_UNIT",
    tableName: "units",
    screenName: "単位マスタ",
    recordId: "PCS",
    oldValues: null,
    newValues: null,
    performedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("LogTable", () => {
  it("空の場合はメッセージを表示する", () => {
    render(<LogTable logs={[]} />);
    expect(screen.getByText("該当するデータはありません")).toBeInTheDocument();
  });

  it("ログの基本情報を表示する", () => {
    render(<LogTable logs={[makeLog()]} />);
    expect(screen.getByText("EMP001")).toBeInTheDocument();
    expect(screen.getByText("単位マスタ")).toBeInTheDocument();
    expect(screen.getByText("CREATE_UNIT")).toBeInTheDocument();
  });

  it("oldValues/newValuesが無い場合は「付帯データなし」と表示する", () => {
    render(<LogTable logs={[makeLog()]} />);
    expect(screen.getByText("付帯データなし")).toBeInTheDocument();
  });

  it("oldValues/newValuesがある場合はそれぞれ表示する", () => {
    render(
      <LogTable
        logs={[makeLog({ oldValues: '{"status":"active"}', newValues: '{"status":"suspended"}' })]}
      />,
    );
    expect(screen.getByText(/"status":"active"/)).toBeInTheDocument();
    expect(screen.getByText(/"status":"suspended"/)).toBeInTheDocument();
  });

  it("UPDATE系アクションと異常系アクションで異なるバッジ色クラスを適用する", () => {
    render(
      <LogTable
        logs={[
          makeLog({ id: "1", action: "UPDATE_UNIT" }),
          makeLog({ id: "2", action: "LOGIN_FAILED" }),
        ]}
      />,
    );
    expect(screen.getByText("UPDATE_UNIT").className).toContain("amber");
    expect(screen.getByText("LOGIN_FAILED").className).toContain("rose");
  });
});
