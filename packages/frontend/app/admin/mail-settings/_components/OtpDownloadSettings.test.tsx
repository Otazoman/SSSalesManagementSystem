import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpDownloadSettings } from "./OtpDownloadSettings";
import { SystemSettings } from "../../company-settings/_types";

function baseSettings(): SystemSettings {
  return {
    is_otp_download_restricted_to_contacts: true,
    otp_digit_count: "4",
    otp_expiry_minutes: "10",
    otp_max_attempts: "5",
  } as SystemSettings;
}

describe("OtpDownloadSettings", () => {
  it("loading:trueの場合は読み込み中を表示しフォームを描画しない", () => {
    render(
      <OtpDownloadSettings
        settings={null}
        loading
        submitting={false}
        canWrite
        onFieldChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("読み込み中...")).toBeInTheDocument();
  });

  it("設定値をフォームへ反映する", () => {
    render(
      <OtpDownloadSettings
        settings={baseSettings()}
        loading={false}
        submitting={false}
        canWrite
        onFieldChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
  });

  it("桁数入力でonFieldChangeを呼ぶ", async () => {
    const onFieldChange = vi.fn();
    render(
      <OtpDownloadSettings
        settings={baseSettings()}
        loading={false}
        submitting={false}
        canWrite
        onFieldChange={onFieldChange}
        onSave={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByDisplayValue("4"), "6");
    expect(onFieldChange).toHaveBeenCalledWith("otp_digit_count", expect.stringContaining("6"));
  });

  it("canWrite:falseの場合はfieldsetと保存ボタンが無効になる", () => {
    const { container } = render(
      <OtpDownloadSettings
        settings={baseSettings()}
        loading={false}
        submitting={false}
        canWrite={false}
        onFieldChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(container.querySelector("fieldset")).toBeDisabled();
    expect(screen.getByRole("button", { name: "OTPダウンロード設定を保存" })).toBeDisabled();
  });

  it("フォーム送信でonSaveを呼ぶ", async () => {
    const onSave = vi.fn((e: React.SyntheticEvent) => e.preventDefault());
    render(
      <OtpDownloadSettings
        settings={baseSettings()}
        loading={false}
        submitting={false}
        canWrite
        onFieldChange={vi.fn()}
        onSave={onSave}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "OTPダウンロード設定を保存" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
