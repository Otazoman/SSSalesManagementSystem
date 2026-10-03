import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FormGrid } from "./FormGrid";

describe("FormGrid", () => {
  const cls = (ui: React.ReactElement) =>
    (render(ui).container.firstElementChild as HTMLElement).className;

  it("スマホは常に1列。列数を指定すると、lg以上でその列数になる", () => {
    expect(cls(<FormGrid cols={4}>x</FormGrid>)).toBe(
      "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3",
    );
  });

  it("既定は2列(sm以上)・gap-3。3列はlgで3列", () => {
    expect(cls(<FormGrid>x</FormGrid>)).toBe(
      "grid grid-cols-1 sm:grid-cols-2 gap-3",
    );
    expect(cls(<FormGrid cols={3}>x</FormGrid>)).toContain("lg:grid-cols-3");
  });

  it("gap と追加クラスを指定できる", () => {
    expect(
      cls(
        <FormGrid gap={2} className="mt-2">
          x
        </FormGrid>,
      ),
    ).toBe("grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2");
  });

  it("どの列数でも、ブレークポイントなしで2列以上になるクラスを出さない", () => {
    for (const cols of [1, 2, 3, 4] as const) {
      const tokens = cls(<FormGrid cols={cols}>x</FormGrid>).split(" ");
      expect(tokens.filter((t) => /^grid-cols-[2-9]$/.test(t))).toEqual([]);
    }
  });
});
