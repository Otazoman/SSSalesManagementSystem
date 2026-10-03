import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords } from "./csv-parser";

describe("parseCsv", () => {
  it("単純なCSVをヘッダー行含む行×列の配列にパースする", () => {
    const result = parseCsv("code,name\nA001,Sample\nA002,Other");
    expect(result).toEqual([
      ["code", "name"],
      ["A001", "Sample"],
      ["A002", "Other"],
    ]);
  });

  it("先頭のUTF-8 BOM文字を除去する", () => {
    const bom = String.fromCharCode(0xfeff);
    const result = parseCsv(bom + "code,name\nA001,Sample");
    expect(result[0]).toEqual(["code", "name"]);
  });

  it("CRLF改行を正しく行区切りとして扱う", () => {
    const result = parseCsv("code,name\r\nA001,Sample\r\nA002,Other");
    expect(result).toEqual([
      ["code", "name"],
      ["A001", "Sample"],
      ["A002", "Other"],
    ]);
  });

  it("ダブルクォートで囲まれたフィールド内のカンマを列区切りと誤認しない", () => {
    const result = parseCsv('id,name\nA001,"Sample, Inc."');
    expect(result[1]).toEqual(["A001", "Sample, Inc."]);
  });

  it('二重ダブルクォート("")を1つのダブルクォートとして復元する', () => {
    const result = parseCsv('id,memo\nA001,"He said ""hi"""');
    expect(result[1]).toEqual(["A001", 'He said "hi"']);
  });

  it("空行は結果に含めずスキップする", () => {
    const result = parseCsv("id,name\nA001,Sample\n\nA002,Other\n");
    expect(result).toEqual([
      ["id", "name"],
      ["A001", "Sample"],
      ["A002", "Other"],
    ]);
  });

  it("末尾が空フィールドの行も正しく1カラムとして扱う(department等のtrailing memoが空のケース)", () => {
    const result = parseCsv("code,name,memo\nA001,Plain,");
    expect(result[1]).toEqual(["A001", "Plain", ""]);
  });

  it("空文字列を渡した場合は空配列を返す", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("ヘッダーのみ(データ行なし)の場合はヘッダー行のみの配列を返す", () => {
    expect(parseCsv("id,name")).toEqual([["id", "name"]]);
  });
});

describe("parseCsvRecords", () => {
  it("引用符内の改行・カンマ・二重引用符を含むフィールドを1レコードとして読む", () => {
    const records = parseCsvRecords('a,b,c\n"1行目\n2行目, カンマ","""引用""",z\n');

    expect(records.map((r) => r.fields)).toEqual([
      ["a", "b", "c"],
      ["1行目\n2行目, カンマ", '"引用"', "z"],
    ]);
  });

  it("レコードの開始行番号を返す(引用符内の改行と空行を数える)", () => {
    const records = parseCsvRecords('h1,h2\n\n"x\ny",1\nlast,2');

    expect(records.map((r) => r.line)).toEqual([1, 3, 5]);
  });

  it("BOM・CRLF・空フィールド・末尾に改行の無い最終行を扱える", () => {
    const bom = String.fromCharCode(0xfeff);
    const crlf = String.fromCharCode(13) + String.fromCharCode(10);
    const records = parseCsvRecords(bom + ["a,b,c", "1,,3", ",,", "x,y,z"].join(crlf));

    expect(records.map((r) => r.fields)).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
      ["", "", ""],
      ["x", "y", "z"],
    ]);
  });

  it("フィールド途中の二重引用符は文字として残す", () => {
    expect(parseCsvRecords('5" pipe,ok')[0].fields).toEqual(['5" pipe', "ok"]);
  });

  it("引用符が閉じていない場合はエラーにする", () => {
    expect(() => parseCsvRecords('a,"未終了\nb,c')).toThrow("引用符");
  });
});

// BUG-028: 出力の時に付けた先頭の ' を、取込の時に外す(出力→取込で値が変わらないように)
describe("取込での数式対策の ' の除去(BUG-028)", () => {
  it("parseCsv・parseCsvRecords とも、' の次が =・+・-・@ の時だけ外す", () => {
    const csv = `"'=SUM(A1)","'+81-3","'-1+2","'@x","'普通の値","-100"\n`;
    const expected = ["=SUM(A1)", "+81-3", "-1+2", "@x", "'普通の値", "-100"];
    expect(parseCsv(csv)[0]).toEqual(expected);
    expect(parseCsvRecords(csv)[0].fields).toEqual(expected);
  });

  it("csvField で出力した値は、取込で元に戻る", async () => {
    const { csvField } = await import("./csv-writer");
    const values = ["=cmd|' /C calc'!A0", "+81-3-1234", "-1+2", "@SUM(1)", "-100", "A=B", "'quoted"];
    const line = values.map((v) => csvField(v)).join(",");
    expect(parseCsvRecords(line)[0].fields).toEqual(values);
    expect(parseCsv(line)[0]).toEqual(values);
  });
});
