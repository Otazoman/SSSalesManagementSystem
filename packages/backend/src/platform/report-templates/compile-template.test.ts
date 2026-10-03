import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { compileTemplateLayout } from "./compile-template";

async function buildSampleWorkbook(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");

  sheet.mergeCells("A1:D1");
  const title = sheet.getCell("A1");
  title.value = "見　積　書";
  title.font = { size: 20, bold: true };
  title.alignment = { horizontal: "center" };

  const label = sheet.getCell("A2");
  label.value = "件名";
  label.border = {
    top: { style: "thin" },
    bottom: { style: "thin" },
    left: { style: "thin" },
    right: { style: "thin" },
  };

  const partnerCell = sheet.getCell("A3");
  partnerCell.value = "{{partner_name}} 御中";

  // 明細ひな形行(item.*プレースホルダーを含む)
  const nameCell = sheet.getCell("A5");
  nameCell.value = "{{item.name}}";
  const qtyCell = sheet.getCell("B5");
  qtyCell.value = "{{item.qty}}";

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

describe("compileTemplateLayout", () => {
  it("結合セル・プレースホルダー・静的テキストを正しく抽出する", async () => {
    const buffer = await buildSampleWorkbook();
    const layout = await compileTemplateLayout(buffer);

    expect(layout.version).toBe(1);

    const titleCell = layout.cells.find((c) => c.row === 1 && c.col === 1);
    expect(titleCell).toBeDefined();
    expect(titleCell?.text).toBe("見　積　書");
    expect(titleCell?.placeholders).toEqual([]);
    expect(titleCell?.colSpan).toBe(4);
    expect(titleCell?.rowSpan).toBe(1);
    expect(titleCell?.fontSizePt).toBe(20);
    expect(titleCell?.bold).toBe(true);
    expect(titleCell?.align).toBe("center");

    const labelCell = layout.cells.find((c) => c.row === 2 && c.col === 1);
    expect(labelCell?.border).toEqual({
      top: true,
      bottom: true,
      left: true,
      right: true,
    });

    const partnerCell = layout.cells.find((c) => c.row === 3 && c.col === 1);
    expect(partnerCell?.text).toBe("{{partner_name}} 御中");
    expect(partnerCell?.placeholders).toEqual(["partner_name"]);
  });

  it("item.*プレースホルダーを含む行を明細ひな形行として検出する", async () => {
    const buffer = await buildSampleWorkbook();
    const layout = await compileTemplateLayout(buffer);

    expect(layout.itemTemplateRow).toBe(5);

    const nameCell = layout.cells.find((c) => c.row === 5 && c.col === 1);
    expect(nameCell?.placeholders).toEqual(["item.name"]);
    const qtyCell = layout.cells.find((c) => c.row === 5 && c.col === 2);
    expect(qtyCell?.placeholders).toEqual(["item.qty"]);
  });

  it("空セルは結果に含まれない", async () => {
    const buffer = await buildSampleWorkbook();
    const layout = await compileTemplateLayout(buffer);

    const emptyCell = layout.cells.find((c) => c.row === 10 && c.col === 1);
    expect(emptyCell).toBeUndefined();
  });

  it("文字が空でも罫線があるセルは装飾目的として結果に含まれる(備考欄の枠を複数列に渡って伸ばす等)", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    const cell = sheet.getCell("B1");
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const layout = await compileTemplateLayout(buffer);
    const resolved = layout.cells.find((c) => c.row === 1 && c.col === 2);
    expect(resolved).toBeDefined();
    expect(resolved?.text).toBe("");
    expect(resolved?.border).toEqual({ top: true, bottom: true, left: true, right: true });
  });

  it("文字が空でも塗りつぶしがあるセルは装飾目的として結果に含まれる", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    const cell = sheet.getCell("B1");
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFCCCCCC" },
    };
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const layout = await compileTemplateLayout(buffer);
    const resolved = layout.cells.find((c) => c.row === 1 && c.col === 2);
    expect(resolved).toBeDefined();
    expect(resolved?.text).toBe("");
    expect(resolved?.fillColor).toBe("CCCCCC");
  });

  it("プレースホルダーの無いテンプレートではitemTemplateRowがnullになる", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.getCell("A1").value = "静的テキストのみ";
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const layout = await compileTemplateLayout(buffer);
    expect(layout.itemTemplateRow).toBeNull();
  });

  it("Excel数式が残ったセルがあると明確なエラーを投げる(置換漏れの検出)", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.getCell("A1").value = 100000;
    sheet.getCell("A2").value = 20000;
    sheet.getCell("A3").value = { formula: "A1+A2", result: 120000 };
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    await expect(compileTemplateLayout(buffer)).rejects.toThrow(/A3.*数式/);
  });

  it("単色塗りつぶし(ARGB直接指定)のセル背景色を抽出する", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    const cell = sheet.getCell("A1");
    cell.value = "見出し";
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF363636" },
    };
    cell.font = { color: { argb: "FFFFFFFF" } };
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const layout = await compileTemplateLayout(buffer);
    const resolved = layout.cells.find((c) => c.row === 1 && c.col === 1);
    expect(resolved?.fillColor).toBe("363636");
    expect(resolved?.fontColor).toBe("FFFFFF");
  });

  it("テーマカラー指定(theme index)のセル背景色をOffice既定パレットで解決する", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    const cell = sheet.getCell("A1");
    cell.value = "見出し";
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { theme: 1 }, // dk1 = 黒
    };
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const layout = await compileTemplateLayout(buffer);
    const resolved = layout.cells.find((c) => c.row === 1 && c.col === 1);
    expect(resolved?.fillColor).toBe("000000");
  });

  it("色指定の無いセルはfillColor=null・既定のfontColorになる", async () => {
    const buffer = await buildSampleWorkbook();
    const layout = await compileTemplateLayout(buffer);
    const titleCell = layout.cells.find((c) => c.row === 1 && c.col === 1);
    expect(titleCell?.fillColor).toBeNull();
    expect(titleCell?.fontColor).toBe("1A1A1A");
  });

  it("Excelに貼り込まれた画像をpt単位の位置・サイズで抽出する(セルの使用範囲外に配置されていても既定幅/高さで算出する)", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    // 意図的に列幅を1列(A列)しか使わないシートにする(画像はB〜D列にまたがって配置)
    sheet.getCell("A1").value = "テスト";
    // 1x1の透明PNG(テスト用ダミー画像)
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const imageId = workbook.addImage({ base64: `data:image/png;base64,${pngBase64}`, extension: "png" });
    sheet.addImage(imageId, {
      tl: { col: 1, row: 1 },
      br: { col: 3, row: 3 },
    });
    const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const layout = await compileTemplateLayout(buffer);
    expect(layout.images).toHaveLength(1);
    expect(layout.images[0].extension).toBe("png");
    expect(layout.images[0].base64.length).toBeGreaterThan(0);
    expect(layout.images[0].widthPt).toBeGreaterThan(0);
    expect(layout.images[0].heightPt).toBeGreaterThan(0);
  });
});
