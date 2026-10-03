import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField, formFieldInputClass } from "./FormField";

describe("FormField", () => {
  it("labelとchildrenを表示する", () => {
    render(
      <FormField label="単位コード">
        <input aria-label="code-input" />
      </FormField>,
    );
    expect(screen.getByText("単位コード")).toBeInTheDocument();
    expect(screen.getByLabelText("code-input")).toBeInTheDocument();
  });

  it("required指定時はラベルに*を付与する", () => {
    render(
      <FormField label="単位コード" required>
        <input />
      </FormField>,
    );
    expect(screen.getByText("単位コード *")).toBeInTheDocument();
  });

  it("hint指定時のみヒント文を表示する", () => {
    const { rerender } = render(
      <FormField label="単位コード" hint="半角英数字で入力してください">
        <input />
      </FormField>,
    );
    expect(
      screen.getByText("半角英数字で入力してください"),
    ).toBeInTheDocument();

    rerender(
      <FormField label="単位コード">
        <input />
      </FormField>,
    );
    expect(
      screen.queryByText("半角英数字で入力してください"),
    ).not.toBeInTheDocument();
  });

  it("入力欄: スマホは16px(iOSの自動拡大を防ぐ)、sm以上は従来のtext-xs", () => {
    const tokens = formFieldInputClass.split(" ");
    expect(tokens).toContain("text-base");
    expect(tokens).toContain("sm:text-xs");
    expect(tokens).not.toContain("text-xs");
  });

  it("文字色: 薄いグレー(slate-400以下)を使わない(CLAUDE.md #20)", () => {
    expect(formFieldInputClass).not.toMatch(/text-slate-[1-4]00/);
    expect(formFieldInputClass).toContain("placeholder:text-slate-500");
    expect(formFieldInputClass).toContain("disabled:text-slate-500");
    render(
      <FormField label="コード">
        <input />
      </FormField>,
    );
    expect(screen.getByText("コード").className).toContain("text-slate-700");
  });
});
