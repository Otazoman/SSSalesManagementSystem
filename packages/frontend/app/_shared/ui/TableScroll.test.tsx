import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TableScroll } from "./TableScroll";

describe("TableScroll", () => {
  it("外枠が横スクロールで、minWidth を内側に適用する", () => {
    render(
      <TableScroll minWidth={900}>
        <table data-testid="t" />
      </TableScroll>,
    );
    const inner = screen.getByTestId("t").parentElement as HTMLElement;
    const outer = inner.parentElement as HTMLElement;
    expect(outer.className).toContain("overflow-x-auto");
    expect(inner.style.minWidth).toBe("900px");
  });

  it("minWidth 未指定なら最小幅を付けず、className を追加できる", () => {
    render(
      <TableScroll className="max-h-[600px]">
        <table data-testid="t" />
      </TableScroll>,
    );
    const inner = screen.getByTestId("t").parentElement as HTMLElement;
    expect(inner.style.minWidth).toBe("");
    expect((inner.parentElement as HTMLElement).className).toContain(
      "max-h-[600px]",
    );
  });
});
