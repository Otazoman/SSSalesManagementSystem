import { describe, it, expect } from "vitest";
import { computeRenderInstructions } from "./compute-render-instructions";
import { CompiledLayout } from "./types";

function buildLayout(overrides: Partial<CompiledLayout> = {}): CompiledLayout {
  return {
    version: 1,
    pageMarginsPt: { top: 36, bottom: 36, left: 36, right: 36 },
    itemTemplateRow: 2,
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
        text: "{{quote_no}}",
        placeholders: ["quote_no"],
        fontSizePt: 12,
        bold: true,
        align: "left",
        border: { top: false, bottom: false, left: false, right: false },
      },
      {
        row: 2,
        col: 1,
        rowSpan: 1,
        colSpan: 1,
        xPt: 0,
        yPt: 30,
        widthPt: 150,
        heightPt: 20,
        text: "{{item.name}}",
        placeholders: ["item.name"],
        fontSizePt: 10,
        bold: false,
        align: "left",
        border: { top: true, bottom: true, left: true, right: true },
      },
      {
        row: 2,
        col: 2,
        rowSpan: 1,
        colSpan: 1,
        xPt: 150,
        yPt: 30,
        widthPt: 50,
        heightPt: 20,
        text: "{{item.qty}}",
        placeholders: ["item.qty"],
        fontSizePt: 10,
        bold: false,
        align: "right",
        border: { top: true, bottom: true, left: false, right: true },
      },
      {
        row: 3,
        col: 1,
        rowSpan: 1,
        colSpan: 1,
        xPt: 0,
        yPt: 55,
        widthPt: 200,
        heightPt: 20,
        text: "小計: {{subtotal}}",
        placeholders: ["subtotal"],
        fontSizePt: 10,
        bold: false,
        align: "left",
        border: { top: false, bottom: false, left: false, right: false },
      },
    ],
    ...overrides,
  };
}

describe("computeRenderInstructions", () => {
  it("非明細セルのプレースホルダーを解決する", () => {
    const layout = buildLayout();
    const resolved = computeRenderInstructions(
      layout,
      { quote_no: "QT-0001", subtotal: "¥15,000" },
      [],
    );
    const titleCell = resolved.find((c) => c.text === "QT-0001");
    expect(titleCell).toBeDefined();
    const footerCell = resolved.find((c) => c.text.includes("¥15,000"));
    expect(footerCell?.text).toBe("小計: ¥15,000");
  });

  it("明細ひな形行を件数分だけ複製し、行高さ分だけ縦にずらす", () => {
    const layout = buildLayout();
    const items = [
      { name: "品目A", qty: "1" },
      { name: "品目B", qty: "2" },
      { name: "品目C", qty: "3" },
    ];
    const resolved = computeRenderInstructions(layout, {}, items);

    const nameCells = resolved.filter((c) =>
      ["品目A", "品目B", "品目C"].includes(c.text),
    );
    expect(nameCells).toHaveLength(3);
    // ひな形行(row=2)のyPtは30、行高さ20ptなので、0件目=30, 1件目=50, 2件目=70
    expect(nameCells.map((c) => c.topYPt).sort((a, b) => a - b)).toEqual([30, 50, 70]);
  });

  it("フッター(ひな形行より下の行)を明細件数に応じてシフトする", () => {
    const layout = buildLayout();
    const items = [
      { name: "品目A", qty: "1" },
      { name: "品目B", qty: "2" },
      { name: "品目C", qty: "3" },
    ];
    const resolved = computeRenderInstructions(layout, { subtotal: "¥30,000" }, items);

    const footerCell = resolved.find((c) => c.text.includes("¥30,000"));
    // 元のyPt=55、ひな形1行が2行分追加された(3件-1件=2件分、行高さ20pt)ので 55 + 40 = 95
    expect(footerCell?.topYPt).toBe(95);
  });

  it("明細0件の場合はフッターが1行分上にシフトする", () => {
    const layout = buildLayout();
    const resolved = computeRenderInstructions(layout, { subtotal: "¥0" }, []);

    const footerCell = resolved.find((c) => c.text.includes("¥0"));
    // 元のyPt=55、ひな形1行ぶんが引かれる(0件-1件=-1件分、行高さ20pt)ので 55 - 20 = 35
    expect(footerCell?.topYPt).toBe(35);

    const nameCells = resolved.filter((c) => c.text === "");
    // 明細0件でもitem行自体は描画されない(ループが回らないため)
    expect(nameCells.every((c) => c.topYPt !== 30)).toBe(true);
  });

  it("item.*以外のプレースホルダーがひな形行に混在しても正しく解決する", () => {
    const layout = buildLayout();
    const items = [{ name: "品目A", qty: "5" }];
    const resolved = computeRenderInstructions(layout, {}, items);

    const qtyCell = resolved.find((c) => c.text === "5");
    expect(qtyCell).toBeDefined();
    expect(qtyCell?.align).toBe("right");
  });

  it("1ページに収まらないレイアウトはエラーを投げる", () => {
    const layout = buildLayout({
      itemTemplateRow: null,
      cells: [
        {
          row: 1,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 2000,
          widthPt: 100,
          heightPt: 20,
          text: "はみ出す行",
          placeholders: [],
          fontSizePt: 10,
          bold: false,
          align: "left",
          border: { top: false, bottom: false, left: false, right: false },
        },
      ],
    });

    expect(() => computeRenderInstructions(layout, {}, [])).toThrow(
      /1ページに収まりません/,
    );
  });

  it("未解決のプレースホルダー(valuesに存在しないキー)は空文字になる", () => {
    const layout = buildLayout();
    const resolved = computeRenderInstructions(layout, {}, []);
    const titleCell = resolved.find((c) => c.xPt === 0 && c.topYPt === 0);
    expect(titleCell?.text).toBe("");
  });

  it("同じ行の右隣が空セルの場合、textMaxWidthPtがそこまで拡張される(Excelのテキストはみ出し再現)", () => {
    // row1のセルはcol1のみで、右隣(col2以降)は何もない行にする
    const layout = buildLayout({
      cells: [
        {
          row: 1,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 0,
          widthPt: 50,
          heightPt: 20,
          text: "{{quote_no}}",
          placeholders: ["quote_no"],
          fontSizePt: 12,
          bold: true,
          align: "left",
          border: { top: false, bottom: false, left: false, right: false },
        },
      ],
      itemTemplateRow: null,
    });
    const resolved = computeRenderInstructions(layout, { quote_no: "QT-0001" }, []);
    // 右隣に何もセルが無いため、表全体の右端(自セル自身の右端=50)までしか広がらない
    expect(resolved[0].widthPt).toBe(50);
    expect(resolved[0].textMaxWidthPt).toBe(50);
  });

  it("同じ行の右隣に別セルがある場合、そのセルの左端までtextMaxWidthPtが拡張される", () => {
    const layout = buildLayout({
      cells: [
        {
          row: 1,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 0,
          widthPt: 50,
          heightPt: 20,
          text: "長い注記テキスト",
          placeholders: [],
          fontSizePt: 12,
          bold: false,
          align: "left",
          border: { top: false, bottom: false, left: false, right: false },
        },
        {
          row: 1,
          col: 3,
          rowSpan: 1,
          colSpan: 1,
          xPt: 150,
          yPt: 0,
          widthPt: 40,
          heightPt: 20,
          text: "次の項目",
          placeholders: [],
          fontSizePt: 12,
          bold: false,
          align: "left",
          border: { top: false, bottom: false, left: false, right: false },
        },
      ],
      itemTemplateRow: null,
    });
    const resolved = computeRenderInstructions(layout, {}, []);
    const noteCell = resolved.find((c) => c.text === "長い注記テキスト");
    // 自セルの幅(50)は変えず、右隣セル(col3, xPt=150)の手前まではみ出せる
    expect(noteCell?.widthPt).toBe(50);
    expect(noteCell?.textMaxWidthPt).toBe(150);
  });

  it("右揃えのセルはtextMaxWidthPtを拡張しない(自身の幅のまま)", () => {
    const layout = buildLayout({
      cells: [
        {
          row: 1,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          xPt: 0,
          yPt: 0,
          widthPt: 50,
          heightPt: 20,
          text: "金額",
          placeholders: [],
          fontSizePt: 12,
          bold: false,
          align: "right",
          border: { top: false, bottom: false, left: false, right: false },
        },
      ],
      itemTemplateRow: null,
    });
    const resolved = computeRenderInstructions(layout, {}, []);
    expect(resolved[0].textMaxWidthPt).toBe(resolved[0].widthPt);
  });
});
