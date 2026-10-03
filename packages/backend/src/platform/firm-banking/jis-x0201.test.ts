import { describe, it, expect } from "vitest";
import { encodeHalfWidth, padField } from "./jis-x0201";

describe("encodeHalfWidth", () => {
  it("ASCII可視域はそのままの値でエンコードする", () => {
    const { bytes, unsupportedChars } = encodeHalfWidth("ABC123");
    expect(Array.from(bytes)).toEqual([0x41, 0x42, 0x43, 0x31, 0x32, 0x33]);
    expect(unsupportedChars).toEqual([]);
  });

  it("半角カナをJIS X0201(0xA1-0xDF)へ変換する", () => {
    // "ｶ)ｻﾝﾌﾟﾙ" の各文字を検証(先頭の"ｶ"=U+FF76→0xB6、"ｰ"(長音)=U+FF70→0xB0)
    const { bytes, unsupportedChars } = encodeHalfWidth("ｶ");
    expect(bytes[0]).toBe(0xb6);
    expect(unsupportedChars).toEqual([]);

    const long = encodeHalfWidth("ｰ");
    expect(long.bytes[0]).toBe(0xb0);
  });

  it("全角文字が混じっている場合はスペースに置換し、unsupportedCharsに記録する", () => {
    const { bytes, unsupportedChars } = encodeHalfWidth("ABC漢字");
    expect(Array.from(bytes)).toEqual([0x41, 0x42, 0x43, 0x20, 0x20]);
    expect(unsupportedChars).toEqual(["漢", "字"]);
  });
});

describe("padField", () => {
  it("left指定で右側をスペースパディングする", () => {
    expect(padField("ABC", 6, "left")).toBe("ABC   ");
  });

  it("right指定で左側を0パディングする", () => {
    expect(padField("123", 6, "right")).toBe("000123");
  });

  it("バイト数を超える場合は切り詰める", () => {
    expect(padField("ABCDEFG", 5, "left")).toBe("ABCDE");
  });
});
