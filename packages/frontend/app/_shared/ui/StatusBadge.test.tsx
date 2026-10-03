import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";
import { getDocumentLifecycleStatus } from "../status/document-lifecycle-status";
import { getApprovalResultStatus, getInstructionStatus } from "../status/approval-result-status";
import { getMasterLifecycleStatus } from "../status/master-lifecycle-status";

describe("StatusBadge", () => {
  it("labelとtoneに応じたクラスでバッジを描画する", () => {
    render(<StatusBadge label="🟢 承認済み" tone="emerald" />);
    const badge = screen.getByText("🟢 承認済み");
    expect(badge.className).toContain("bg-emerald-50");
  });
});

describe("document-lifecycle-status: 見積・受注・発注・購買申請で共通の伝票ステータス", () => {
  it("既知のステータスは日本語ラベルへ変換される", () => {
    expect(getDocumentLifecycleStatus("DRAFT").label).toBe("⚪ 下書き");
    expect(getDocumentLifecycleStatus("PENDING_APPROVAL").label).toBe("🟡 承認申請中");
    expect(getDocumentLifecycleStatus("APPROVED").label).toBe("🟢 承認済み");
    expect(getDocumentLifecycleStatus("PENDING_DELETION").label).toBe("🔴 削除申請中");
  });

  it("未知のステータスはそのままラベルとして表示する(フェイルセーフ)", () => {
    expect(getDocumentLifecycleStatus("UNKNOWN_STATUS").label).toBe("UNKNOWN_STATUS");
  });
});

describe("approval-result-status: 棚卸・検収・納品等の履歴系で共通のステータス", () => {
  it("通常の履歴系(承認済み表記)を返す", () => {
    expect(getApprovalResultStatus("APPROVED").label).toBe("🟢 承認済み");
  });

  it("指示書系(発行済み表記+実績反映の進捗2状態)を返す", () => {
    expect(getInstructionStatus("APPROVED").label).toBe("🟢 発行済み");
    expect(getInstructionStatus("PARTIALLY_FULFILLED").label).toBe("🟠 一部実績反映");
    expect(getInstructionStatus("FULFILLED").label).toBe("✅ 実績反映済み");
    // UNAPPROVED/REMANDED/CANCELEDは履歴系と共通の文言を継承する
    expect(getInstructionStatus("UNAPPROVED").label).toBe("🟡 承認申請中");
  });
});

describe("master-lifecycle-status: マスタ系で共通のステータス", () => {
  it("temporary/active/suspendedの3状態を日本語ラベルへ変換する", () => {
    expect(getMasterLifecycleStatus("temporary").label).toBe("仮登録/申請中");
    expect(getMasterLifecycleStatus("active").label).toBe("有効");
    expect(getMasterLifecycleStatus("suspended").label).toBe("無効");
  });
});
