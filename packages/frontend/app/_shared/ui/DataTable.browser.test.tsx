import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DataTable } from "./DataTable";
import {
  WIDTHS,
  setWidth,
  pageOverflowsHorizontally,
} from "../../../test-support/responsive";

// 実ブラウザで、幅の広い表がスマホ幅でもページ全体を横にはみ出させず、表の枠内で横スクロールになることを確認する
const columns = Array.from({ length: 12 }, (_, i) => ({
  key: `c${i}`,
  label: `列${i}`,
}));
const data = [{ id: 1 }];

describe.each([
  ["phone", WIDTHS.phone],
  ["tablet", WIDTHS.tablet],
  ["desktop", WIDTHS.desktop],
] as const)("DataTable(%s)", (_n, width) => {
  it("ページ全体は横にはみ出さない", async () => {
    await setWidth(width);
    render(
      <div className="p-4">
        <DataTable
          columns={columns}
          data={data}
          renderRow={(item) => (
            <tr key={item.id}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className="p-2 whitespace-nowrap"
                >{`値${c.key}`}</td>
              ))}
            </tr>
          )}
        />
      </div>,
    );
    expect(pageOverflowsHorizontally()).toBe(false);
  });
});
