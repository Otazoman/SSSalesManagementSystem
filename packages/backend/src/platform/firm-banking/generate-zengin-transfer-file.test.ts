import { describe, it, expect } from "vitest";
import {
  generateZenginTransferFile,
  ZenginTransferHeaderInput,
  ZenginTransferLineInput,
} from "./generate-zengin-transfer-file";

const HEADER: ZenginTransferHeaderInput = {
  committerCode: "1234567890",
  committerName: "ｶﾌﾞｼｷｶﾞｲｼｬｻﾝﾌﾟﾙ",
  transferDate: new Date(2026, 8, 15), // 2026-09-15(monthは0始まり)
  bankCode: "0001",
  bankName: "ﾐｽﾞﾎ",
  branchCode: "001",
  branchName: "ﾎﾝﾃﾝ",
  accountType: "ORDINARY",
  accountNumber: "1234567",
};

const LINE: ZenginTransferLineInput = {
  partnerId: "P-1",
  bankCode: "0009",
  bankName: "ﾐﾂｲｽﾐﾄﾓ",
  branchCode: "123",
  branchName: "ｼﾃﾝ",
  accountType: "ORDINARY",
  accountNumber: "7654321",
  accountHolderName: "ｶ)ﾃｽﾄｼｮｳｼﾞ",
  amount: 110000,
};

function decodeRecords(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString("latin1"); // JIS X0201は1バイト/文字なのでlatin1で桁数検証に使える
  return text.split("\r\n").filter((r) => r.length > 0);
}

describe("generateZenginTransferFile", () => {
  it("ヘッダー+データ1件+トレーラー+エンドの4レコード、各120バイトで生成する", () => {
    const result = generateZenginTransferFile(HEADER, [LINE]);
    const records = decodeRecords(result.bytes);

    expect(records).toHaveLength(4);
    for (const r of records) {
      expect(r.length).toBe(120);
    }
    expect(records[0][0]).toBe("1"); // ヘッダー
    expect(records[1][0]).toBe("2"); // データ
    expect(records[2][0]).toBe("8"); // トレーラー
    expect(records[3][0]).toBe("9"); // エンド
  });

  it("ヘッダーレコードに種別コード21・取組日MMDDが正しく埋め込まれる", () => {
    const result = generateZenginTransferFile(HEADER, [LINE]);
    const records = decodeRecords(result.bytes);
    const headerRecord = records[0];
    expect(headerRecord.slice(1, 3)).toBe("21");
    expect(headerRecord.slice(3, 4)).toBe("0");
    expect(headerRecord.slice(4, 14)).toBe("1234567890");
    // 取組日(MMDD): 委託者コード(10)の後、委託者名(40)の後の4桁
    const mmddStart = 4 + 10 + 40;
    expect(headerRecord.slice(mmddStart, mmddStart + 4)).toBe("0915");
  });

  it("データレコードに振込金額が右詰め0パディングで埋め込まれる", () => {
    const result = generateZenginTransferFile(HEADER, [LINE]);
    const records = decodeRecords(result.bytes);
    const dataRecord = records[1];
    // 金額欄: レコード区分(1)+被仕向銀行番号(4)+被仕向銀行名(15)+手形交換所(4)+支店番号(3)
    // +支店名(15)+預金種目(1)+口座番号(7)+受取人名(30) = 80 の次の10桁
    const amountStart = 1 + 4 + 15 + 4 + 3 + 15 + 1 + 7 + 30;
    expect(dataRecord.slice(amountStart, amountStart + 10)).toBe("0000110000");
  });

  it("合計件数・合計金額がトレーラーレコードに正しく集計される", () => {
    const line2 = { ...LINE, partnerId: "P-2", amount: 55000 };
    const result = generateZenginTransferFile(HEADER, [LINE, line2]);
    expect(result.recordCount).toBe(2);
    expect(result.totalAmount).toBe(165000);

    const records = decodeRecords(result.bytes);
    const trailerRecord = records[3]; // ヘッダー1+データ2件の次(index 3)
    expect(trailerRecord[0]).toBe("8");
    expect(trailerRecord.slice(1, 7)).toBe("000002");
    expect(trailerRecord.slice(7, 19)).toBe("000000165000");
  });

  it("全角文字が混じっている場合はwarningsに記録しつつ生成は継続する", () => {
    const result = generateZenginTransferFile(HEADER, [
      { ...LINE, accountHolderName: "株式会社テスト" },
    ]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("データレコード");
  });

  it("明細が0件だとエラーを投げる", () => {
    expect(() => generateZenginTransferFile(HEADER, [])).toThrow(
      "振込対象の明細が1件もありません",
    );
  });

  it("振込金額が0以下だとエラーを投げる", () => {
    expect(() =>
      generateZenginTransferFile(HEADER, [{ ...LINE, amount: 0 }]),
    ).toThrow("振込金額が不正です");
  });
});
