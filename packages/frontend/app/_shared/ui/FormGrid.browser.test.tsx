import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FormGrid } from "./FormGrid";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
} from "../../../test-support/responsive";

// 実ブラウザ: 画面幅に応じて、1列(スマホ)→2列(sm)→指定列数(lg以上)に切り替わる
const columnCount = (container: HTMLElement) =>
  new Set(
    Array.from(container.querySelectorAll("[data-cell]")).map((el) =>
      Math.round(el.getBoundingClientRect().left),
    ),
  ).size;

describe("FormGrid(4列指定)", () => {
  it.each([
    ["phone", WIDTHS.phone, 1],
    ["tablet", WIDTHS.tablet, 2],
    ["desktop", WIDTHS.desktop, 4],
  ] as const)(
    "%s は %i 列になり、ページは横にはみ出さない",
    async (_n, width, expected) => {
      await setWidth(width);
      const { container } = render(
        <div className="p-4">
          <FormGrid cols={4}>
            {Array.from({ length: 8 }, (_, i) => (
              <input key={i} data-cell className="w-full border p-2" />
            ))}
          </FormGrid>
        </div>,
      );
      expect(columnCount(container)).toBe(expected);
      expect(pageOverflowsHorizontally()).toBe(false);
    },
  );
});
