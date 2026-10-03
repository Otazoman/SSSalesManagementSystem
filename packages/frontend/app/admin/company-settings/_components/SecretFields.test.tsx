import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SmtpSettings } from "./SmtpSettings";
import { NotificationOutboxSettings } from "./NotificationOutboxSettings";
import { SystemSettings } from "../_types";

// BUG-011: 取得APIは SMTP のパスワード・Slack の Bot トークンを空で返す。
// 設定済みの場合は、入力欄に「設定済み(変更する時だけ入力)」と表示する
function settings(overrides: Partial<SystemSettings>): SystemSettings {
  return { smtp_pass: "", slack_bot_token: "", ...overrides } as SystemSettings;
}

function renderSmtp(s: SystemSettings) {
  render(
    <SmtpSettings
      settings={s}
      setSettings={vi.fn()}
      canWrite
      testEmail=""
      setTestEmail={vi.fn()}
      sendingTest={false}
      testMessage=""
      testError=""
      sendTestEmail={vi.fn()}
      setTestError={vi.fn()}
      setTestMessage={vi.fn()}
    />,
  );
}

describe("秘密の値の入力欄", () => {
  it("SMTPパスワード: 設定済みなら「設定済み」と表示する(値は空のまま)", () => {
    renderSmtp(settings({ smtp_pass_configured: true }));
    expect(screen.getByPlaceholderText("設定済み(変更する時だけ入力)")).toHaveValue("");
  });

  it("SMTPパスワード: 未設定なら入力例を表示する", () => {
    renderSmtp(settings({ smtp_pass_configured: false }));
    expect(screen.getByPlaceholderText("xxxx xxxx xxxx xxxx")).toBeInTheDocument();
  });

  it("Slack Bot Token: 設定済みなら「設定済み」と表示する", () => {
    render(
      <NotificationOutboxSettings
        settings={settings({ slack_bot_token_configured: true })}
        setSettings={vi.fn()}
        canWrite
      />,
    );
    expect(screen.getByPlaceholderText("設定済み(変更する時だけ入力)")).toHaveValue("");
  });
});
