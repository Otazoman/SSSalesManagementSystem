import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentTypeChecklist } from "./DocumentTypeChecklist";
import {
  PARTNER_CONTACT_DOCUMENT_TYPE_OPTIONS,
  WAREHOUSE_CONTACT_DOCUMENT_TYPE_OPTIONS,
  summarizeDocumentTypes,
} from "../contact-document-types";

const options = WAREHOUSE_CONTACT_DOCUMENT_TYPE_OPTIONS;

describe("DocumentTypeChecklist", () => {
  it("選択中の帳票にチェックが入り、チェックの切り替えで定義順の配列を返す", async () => {
    const onChange = vi.fn();
    render(
      <DocumentTypeChecklist
        legend="メールで送る帳票"
        options={options}
        value={["receipt_instruction"]}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("出荷指示書")).not.toBeChecked();
    expect(screen.getByLabelText("入荷指示書")).toBeChecked();

    await userEvent.click(screen.getByLabelText("出荷指示書"));
    expect(onChange).toHaveBeenLastCalledWith([
      "shipment_instruction",
      "receipt_instruction",
    ]);

    await userEvent.click(screen.getByLabelText("入荷指示書"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("「すべて選ぶ」「すべて外す」で全選択・全解除できる", async () => {
    function Harness() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <DocumentTypeChecklist
          legend="帳票"
          options={options}
          value={value}
          onChange={setValue}
        />
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "すべて選ぶ" }));
    expect(screen.getByLabelText("出荷指示書")).toBeChecked();
    expect(screen.getByLabelText("入荷指示書")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "すべて外す" }));
    expect(screen.getByLabelText("出荷指示書")).not.toBeChecked();
  });

  it("disabledのときは操作できない", () => {
    render(
      <DocumentTypeChecklist
        legend="帳票"
        options={options}
        value={[]}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByLabelText("出荷指示書")).toBeDisabled();
    expect(screen.getByRole("button", { name: "すべて選ぶ" })).toBeDisabled();
  });
});

describe("summarizeDocumentTypes", () => {
  const partner = PARTNER_CONTACT_DOCUMENT_TYPE_OPTIONS;
  it("なし・すべて・一部(定義順)を表示する。定義にないキーは無視する", () => {
    expect(summarizeDocumentTypes([], partner)).toBe("なし");
    expect(summarizeDocumentTypes(undefined, partner)).toBe("なし");
    expect(
      summarizeDocumentTypes(
        partner.map((o) => o.value),
        partner,
      ),
    ).toBe("すべての帳票");
    expect(
      summarizeDocumentTypes(["billing", "quote", "unknown"], partner),
    ).toBe("見積書、請求書");
    expect(summarizeDocumentTypes(["unknown"], partner)).toBe("なし");
  });
});
