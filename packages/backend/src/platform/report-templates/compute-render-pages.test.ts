import { describe, it, expect } from "vitest";
import { computeRenderPages } from "./compute-render-pages";
import { CompiledLayout } from "./types";

describe("computeRenderPages", () => {
  function buildPaginatedLayout(): CompiledLayout {
    return {
      version: 1,
      pageMarginsPt: { top: 36, bottom: 36, left: 36, right: 36 },
      itemTemplateRow: 2,
      images: [],
      cells: [
        {
          row: 1,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 0,
          widthPt: 200,
          heightPt: 20,
          text: "ヘッダー",
          placeholders: [],
          fontSizePt: 10,
          bold: false,
          align: "left",
          border: { top: false, bottom: false, left: false, right: false },
          fillColor: null,
          fontColor: "1A1A1A",
        },
        {
          // 1行がPAGE_HEIGHT(841.89)-margins(72)=769.89pt中300ptを占めるため、
          // ヘッダー分を差し引いた1ページ目には2件、以降のページにも2件しか入らない
          row: 2,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 30,
          widthPt: 200,
          heightPt: 300,
          text: "{{item.name}}",
          placeholders: ["item.name"],
          fontSizePt: 10,
          bold: false,
          align: "left",
          border: { top: true, bottom: true, left: true, right: true },
          fillColor: null,
          fontColor: "1A1A1A",
        },
        {
          row: 3,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 335,
          widthPt: 200,
          heightPt: 20,
          text: "フッター",
          placeholders: [],
          fontSizePt: 10,
          bold: false,
          align: "left",
          border: { top: false, bottom: false, left: false, right: false },
          fillColor: null,
          fontColor: "1A1A1A",
        },
      ],
    };
  }

  it("1ページに収まらない件数は自動的に複数ページへ分割される", () => {
    const layout = buildPaginatedLayout();
    const items = Array.from({ length: 5 }, (_, i) => ({ name: `品目${i + 1}` }));
    const pages = computeRenderPages(layout, {}, items);
    expect(pages.length).toBe(3);
  });

  it("(このテスト用レイアウトでは列見出し行=ヘッダー行のため)列見出し行は全ページに繰り返し描画され、フッターは最終ページのみに描画される", () => {
    const layout = buildPaginatedLayout();
    const items = Array.from({ length: 5 }, (_, i) => ({ name: `品目${i + 1}` }));
    const pages = computeRenderPages(layout, {}, items);

    expect(pages[0].cells.some((c) => c.text === "ヘッダー")).toBe(true);
    expect(pages[1].cells.some((c) => c.text === "ヘッダー")).toBe(true);
    expect(pages[2].cells.some((c) => c.text === "ヘッダー")).toBe(true);

    expect(pages[0].cells.some((c) => c.text === "フッター")).toBe(false);
    expect(pages[1].cells.some((c) => c.text === "フッター")).toBe(false);
    expect(pages[2].cells.some((c) => c.text === "フッター")).toBe(true);
  });

  // 明細ひな形行の直上の1行(列見出し行)だけが2ページ目以降に繰り返され、それより上の
  // ヘッダー全体(タイトル・宛先等)は1ページ目にしか描画されないことを検証する
  function buildLayoutWithSeparateTitleRow(): CompiledLayout {
    return {
      version: 1,
      pageMarginsPt: { top: 36, bottom: 36, left: 36, right: 36 },
      itemTemplateRow: 3,
      images: [],
      cells: [
        {
          row: 1,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 0,
          widthPt: 200,
          heightPt: 20,
          text: "会社情報",
          placeholders: [],
          fontSizePt: 10,
          bold: false,
          align: "left",
          border: { top: false, bottom: false, left: false, right: false },
          fillColor: null,
          fontColor: "1A1A1A",
        },
        {
          // itemTemplateRow(3)の直上の行 = 繰り返し対象の列見出し行
          row: 2,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 20,
          widthPt: 200,
          heightPt: 20,
          text: "列見出し",
          placeholders: [],
          fontSizePt: 10,
          bold: false,
          align: "left",
          border: { top: false, bottom: false, left: false, right: false },
          fillColor: null,
          fontColor: "1A1A1A",
        },
        {
          row: 3,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 40,
          widthPt: 200,
          heightPt: 300,
          text: "{{item.name}}",
          placeholders: ["item.name"],
          fontSizePt: 10,
          bold: false,
          align: "left",
          border: { top: true, bottom: true, left: true, right: true },
          fillColor: null,
          fontColor: "1A1A1A",
        },
        {
          row: 4,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 345,
          widthPt: 200,
          heightPt: 20,
          text: "フッター",
          placeholders: [],
          fontSizePt: 10,
          bold: false,
          align: "left",
          border: { top: false, bottom: false, left: false, right: false },
          fillColor: null,
          fontColor: "1A1A1A",
        },
      ],
    };
  }

  it("列見出し行のみが2ページ目以降に繰り返され、それより上のヘッダー(会社情報等)は1ページ目のみに描画される", () => {
    const layout = buildLayoutWithSeparateTitleRow();
    const items = Array.from({ length: 5 }, (_, i) => ({ name: `品目${i + 1}` }));
    const pages = computeRenderPages(layout, {}, items);

    expect(pages.length).toBe(3);

    expect(pages[0].cells.some((c) => c.text === "会社情報")).toBe(true);
    expect(pages[0].cells.some((c) => c.text === "列見出し")).toBe(true);

    expect(pages[1].cells.some((c) => c.text === "会社情報")).toBe(false);
    expect(pages[1].cells.some((c) => c.text === "列見出し")).toBe(true);

    expect(pages[2].cells.some((c) => c.text === "会社情報")).toBe(false);
    expect(pages[2].cells.some((c) => c.text === "列見出し")).toBe(true);
    expect(pages[2].cells.some((c) => c.text === "フッター")).toBe(true);

    expect(pages[0].cells.some((c) => c.text === "フッター")).toBe(false);
    expect(pages[1].cells.some((c) => c.text === "フッター")).toBe(false);
  });

  it("全ページの明細セルを合計すると元の件数と一致し、重複・欠落が無い", () => {
    const layout = buildPaginatedLayout();
    const items = Array.from({ length: 5 }, (_, i) => ({ name: `品目${i + 1}` }));
    const pages = computeRenderPages(layout, {}, items);
    const itemCells = pages.flatMap((p) => p.cells.filter((c) => c.text.startsWith("品目")));
    expect(itemCells.map((c) => c.text).sort()).toEqual(
      items.map((i) => i.name).sort(),
    );
  });

  it("1ページに収まる件数の場合は1ページのみになる(従来の単一ページ実装と同じ結果)", () => {
    const layout = buildPaginatedLayout();
    const items = [{ name: "品目1" }];
    const pages = computeRenderPages(layout, {}, items);
    expect(pages.length).toBe(1);
    expect(pages[0].cells.some((c) => c.text === "ヘッダー")).toBe(true);
    expect(pages[0].cells.some((c) => c.text === "フッター")).toBe(true);
  });
});
