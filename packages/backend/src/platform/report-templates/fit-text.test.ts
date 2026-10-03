import { describe, it, expect } from "vitest";
import { fitTextToWidth } from "./fit-text";

// 実際のフォント計測を模した単純な線形近似(1文字あたりsizeの半分の幅)
const measureWidth = (text: string, size: number) => text.length * size * 0.5;

describe("fitTextToWidth", () => {
  it("幅に収まる場合はそのまま返す", () => {
    const result = fitTextToWidth(measureWidth, "短い", 10, 200);
    expect(result.text).toBe("短い");
    expect(result.size).toBe(10);
  });

  it("幅を超える場合はフォントサイズを縮小する(縮小後も最小サイズ以上に収まる場合)", () => {
    // "12345678" は8文字、size10なら幅40。maxWidth=30(cellWidth=34)に収めるにはsize7.5まで縮小すれば足りる
    const result = fitTextToWidth(measureWidth, "12345678", 10, 34);
    expect(result.text).toBe("12345678"); // 文字自体は省略されない
    expect(result.size).toBeCloseTo(7.5, 5);
    expect(result.width).toBeLessThanOrEqual(30 + 1e-9); // maxWidth = cellWidth - padding*2 = 34-4=30
  });

  it("最小フォントサイズでも収まらない場合は末尾を省略記号に置き換える", () => {
    const veryLongText = "あ".repeat(100);
    const result = fitTextToWidth(measureWidth, veryLongText, 10, 30);
    expect(result.text.endsWith("...")).toBe(true);
    expect(result.text.length).toBeLessThan(veryLongText.length);
    expect(result.size).toBeGreaterThanOrEqual(6); // MIN_FONT_SIZE_PT
  });

  it("セル幅が0以下の場合は元のテキストをそのまま返す(安全側)", () => {
    const result = fitTextToWidth(measureWidth, "テキスト", 10, 0);
    expect(result.text).toBe("テキスト");
  });

  it("縮小後の幅再計算が浮動小数点誤差でmaxWidthをごく僅かに超えても切り詰めない", () => {
    // 実際のpdf-lib計測で「338.00000000000006 > 338」のようなsub-pt誤差が発生し、
    // 不要な省略記号が付与される不具合があった(実測値を再現するため測定関数に微小ノイズを混入)
    const measureWidthWithNoise = (text: string, size: number) =>
      text.length * size * 0.5 + 1e-9;
    const result = fitTextToWidth(measureWidthWithNoise, "12345678", 10, 34);
    expect(result.text).toBe("12345678");
    expect(result.text.endsWith("...")).toBe(false);
  });
});
