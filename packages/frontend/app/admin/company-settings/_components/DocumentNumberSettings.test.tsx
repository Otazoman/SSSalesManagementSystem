import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentNumberSettings } from "./DocumentNumberSettings";
import { DOCUMENT_TYPES } from "../_types";
import type { SystemSettings } from "../_types";

const settings = { document_number_formats: {} } as unknown as SystemSettings;

describe("DocumentNumberSettings: 伝票番号フォーマット", () => {
  it("商談を含む伝票種別が一覧に表示される", () => {
    render(<DocumentNumberSettings settings={settings} setSettings={vi.fn()} canWrite />);
    expect(DOCUMENT_TYPES.some((d) => d.key === "deal" && d.defaultPrefix === "DL")).toBe(true);
    const row = screen.getByText("商談").closest("tr")!;
    expect(within(row).getByDisplayValue("DL")).toBeInTheDocument();
  });

  it("商談のプレフィックスを変更すると、document_number_formats.dealとして設定に反映される", async () => {
    const setSettings = vi.fn();
    render(<DocumentNumberSettings settings={settings} setSettings={setSettings} canWrite />);
    const row = screen.getByText("商談").closest("tr")!;
    const prefix = within(row).getByDisplayValue("DL");
    await userEvent.type(prefix, "X");

    const next = setSettings.mock.calls.at(-1)![0] as SystemSettings;
    expect(next.document_number_formats.deal).toMatchObject({ usePrefix: true, prefix: "DLX", digitCount: 4 });
  });

  it("書き込み権限が無い場合は入力できない", () => {
    render(<DocumentNumberSettings settings={settings} setSettings={vi.fn()} canWrite={false} />);
    const row = screen.getByText("商談").closest("tr")!;
    expect(within(row).getByDisplayValue("DL")).toBeDisabled();
  });
});
