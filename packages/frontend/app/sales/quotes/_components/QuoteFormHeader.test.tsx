import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuoteFormHeader } from "./QuoteFormHeader";

// REQ-002: PDF 発行の時に、見積書の後ろにご発注書を付けるかを選べる
describe("QuoteFormHeader: ご発注書を付ける", () => {
  const renderHeader = (onGeneratePDF = vi.fn()) => {
    render(
      <QuoteFormHeader
        editingId="QT-1-1"
        quoteId="QT-1-1"
        status="APPROVED"
        isMailSending={false}
        siblingVersions={[]}
        onOpenEditForm={vi.fn()}
        onOpenMailModal={vi.fn()}
        onGeneratePDF={onGeneratePDF}
      />,
    );
    return onGeneratePDF;
  };

  it("チェックしなければ見積書だけ、チェックすればご発注書を付ける指定で発行する", () => {
    const onGeneratePDF = renderHeader();
    const button = screen.getByRole("button", { name: /PDF見積書を発行/ });
    fireEvent.click(button);
    expect(onGeneratePDF).toHaveBeenLastCalledWith("QT-1-1", { includeOrderForm: false });

    fireEvent.click(screen.getByLabelText("ご発注書を付ける"));
    fireEvent.click(button);
    expect(onGeneratePDF).toHaveBeenLastCalledWith("QT-1-1", { includeOrderForm: true });
  });
});
