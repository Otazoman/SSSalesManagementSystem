import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FirmBankingExportModal } from "./FirmBankingExportModal";

const baseProps = {
  isOpen: true,
  selectedCount: 2,
  transferDate: "2026-11-25",
  setTransferDate: vi.fn(),
  preview: null,
  isLoading: false,
  onPreview: vi.fn(),
  onDownload: vi.fn(),
  onClose: vi.fn(),
};

// BUG-120: 確認のエラーはモーダルの中に出す(以前は裏の画面にしか出ず、ボタンが反応しないように見えた)
describe("FirmBankingExportModal", () => {
  it("確認のエラーをモーダルの中に出し、確認の結果が無い間はダウンロードを押せない", () => {
    render(<FirmBankingExportModal {...baseProps} error="会社設定にファームバンキング用の自社口座情報が未設定です" />);
    expect(screen.getByText(/会社設定にファームバンキング用の自社口座情報が未設定です/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ダウンロード/ })).toBeDisabled();
  });

  it("エラーが無ければ何も出さない", () => {
    render(<FirmBankingExportModal {...baseProps} />);
    expect(screen.queryByText(/⚠️/)).not.toBeInTheDocument();
  });
});
