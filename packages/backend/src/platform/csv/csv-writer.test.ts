import { describe, it, expect } from "vitest";
import {
  csvField,
  buildCsvContent,
  withBom,
  toCsvBytes,
  CRLF,
} from "./csv-writer";

describe("csvField", () => {
  it("空文字・null・undefinedを空のダブルクォートに変換する", () => {
    expect(csvField("")).toBe('""');
    expect(csvField(null)).toBe('""');
    expect(csvField(undefined)).toBe('""');
  });

  it("通常の文字列をダブルクォートで囲む", () => {
    expect(csvField("abc")).toBe('"abc"');
  });

  it("内部のダブルクォートを二重にエスケープする", () => {
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("数値も文字列化してダブルクォートで囲む", () => {
    expect(csvField(123)).toBe('"123"');
  });
});

describe("buildCsvContent", () => {
  it("ヘッダーはクォートせずカンマ結合し、行はデフォルトで\\nで連結する", () => {
    const result = buildCsvContent(
      ["code", "name"],
      ['"A001","Sample"', '"A002","Other"'],
    );
    expect(result).toBe('code,name\n"A001","Sample"\n"A002","Other"');
  });

  it("rowsが空の場合はヘッダーのみを返す", () => {
    expect(buildCsvContent(["a", "b"], [])).toBe("a,b");
  });

  it("lineBreakを指定した場合はその改行コードで連結する(productsのCRLF仕様)", () => {
    const result = buildCsvContent(["a"], ["1", "2"], CRLF);
    expect(result).toBe("a" + CRLF + "1" + CRLF + "2");
    expect(result).toBe("a\r\n1\r\n2");
  });
});

describe("withBom", () => {
  it("先頭にBOM文字(U+FEFF)を1文字だけ付与する", () => {
    const result = withBom("code,name");
    expect(result.charCodeAt(0)).toBe(0xfeff);
    expect(result.slice(1)).toBe("code,name");
    expect(result.length).toBe("code,name".length + 1);
  });
});

describe("toCsvBytes", () => {
  it("先頭にUTF-8 BOMバイト列(EF BB BF)を付与したUint8Arrayを返す", () => {
    const bytes = toCsvBytes("ab");
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    // "ab" の UTF-8 バイト列
    expect(bytes[3]).toBe(0x61);
    expect(bytes[4]).toBe(0x62);
    expect(bytes.length).toBe(5);
  });

  it("マルチバイト文字(日本語)を含む内容も正しくエンコードする", () => {
    const bytes = toCsvBytes("あ");
    const decoded = new TextDecoder().decode(bytes.slice(3));
    expect(decoded).toBe("あ");
  });
});

// BUG-028: Excel で開いた時に数式として動く値の対策
describe("csvField の数式対策(BUG-028)", () => {
  it("=・+・-・@・タブ・CR で始まる値は、先頭に ' を付ける", () => {
    expect(csvField("=HYPERLINK(\"http://evil\",\"x\")")).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvField("+81-3-1234-5678")).toBe(`"'+81-3-1234-5678"`);
    expect(csvField("-1+2")).toBe(`"'-1+2"`);
    expect(csvField("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvField("\tcmd")).toBe(`"'\tcmd"`);
    expect(csvField("\rcmd")).toBe(`"'\rcmd"`);
  });

  it("数値(マイナス・小数・桁区切りを含む)には付けない", () => {
    expect(csvField(-100)).toBe(`"-100"`);
    expect(csvField("-100")).toBe(`"-100"`);
    expect(csvField("-12.5")).toBe(`"-12.5"`);
    expect(csvField("+3")).toBe(`"+3"`);
    expect(csvField("-1,000")).toBe(`"-1,000"`);
  });

  it("途中に = などがある値や、普通の値はそのまま", () => {
    expect(csvField("A=B")).toBe(`"A=B"`);
    expect(csvField("2026-09-28")).toBe(`"2026-09-28"`);
    expect(csvField("")).toBe(`""`);
  });
});
