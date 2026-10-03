import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MailLogTable } from "./MailLogTable";
import { MailDeliveryLogRecord } from "../_types";

function makeLog(overrides: Partial<MailDeliveryLogRecord> = {}): MailDeliveryLogRecord {
  return {
    id: "1",
    type: "email",
    category: "sales_quote",
    documentId: "QT-1",
    smtpFrom: "sales@example.com",
    recipientTo: "customer@example.com",
    recipientCc: null,
    subject: "御見積書送付のご案内",
    attachedR2Path: null,
    status: "SUCCESS",
    errorMessage: null,
    performedById: "EMP001",
    performedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("MailLogTable", () => {
  it("空の場合はメッセージを表示する", () => {
    render(<MailLogTable logs={[]} />);
    expect(
      screen.getByText("該当するデータはありません"),
    ).toBeInTheDocument();
  });

  it("SUCCESSの場合は成功メッセージを表示する", () => {
    render(<MailLogTable logs={[makeLog({ status: "SUCCESS" })]} />);
    expect(screen.getByText("正常にリレー完了しました")).toBeInTheDocument();
  });

  it("FAILEDの場合はerrorMessageを表示する", () => {
    render(
      <MailLogTable logs={[makeLog({ status: "FAILED", errorMessage: "SMTP認証エラー" })]} />,
    );
    expect(screen.getByText("SMTP認証エラー")).toBeInTheDocument();
  });

  it("FAILEDでerrorMessageが無い場合はデフォルト文言を表示する", () => {
    render(<MailLogTable logs={[makeLog({ status: "FAILED", errorMessage: null })]} />);
    expect(screen.getByText("SMTPタイムアウト、または接続拒否")).toBeInTheDocument();
  });

  it("PENDINGの場合は送信待ち文言を表示する", () => {
    render(<MailLogTable logs={[makeLog({ status: "PENDING" })]} />);
    expect(
      screen.getByText("送信待ち(次回Cron実行時に送信されます)"),
    ).toBeInTheDocument();
  });

  it("追加要望J-2-c: ステータスは生の英語文字列ではなく日本語バッジで表示する", () => {
    render(<MailLogTable logs={[makeLog({ status: "SUCCESS" })]} />);
    expect(screen.getByText("🟢 送信成功")).toBeInTheDocument();
    expect(screen.queryByText("SUCCESS")).not.toBeInTheDocument();
  });

  it("type:slackの場合はSlackラベルを表示する", () => {
    render(<MailLogTable logs={[makeLog({ type: "slack" })]} />);
    expect(screen.getByText(/💬 Slack/)).toBeInTheDocument();
  });

  it("attachedR2Pathがある場合はファイル名部分だけ表示する", () => {
    render(
      <MailLogTable
        logs={[makeLog({ attachedR2Path: "quotes/2026/QT-1/QT-1_見積書.pdf" })]}
      />,
    );
    expect(screen.getByText("QT-1_見積書.pdf")).toBeInTheDocument();
  });
});
