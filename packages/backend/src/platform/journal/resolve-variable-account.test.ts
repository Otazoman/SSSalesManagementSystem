import { describe, it, expect } from "vitest";
import { resolveVariableAccount } from "./resolve-variable-account";

describe("resolveVariableAccount: ITEM_MASTER_FIRST(品目マスタ優先)", () => {
  it("品目マスタ・ヘッダー両方に値があれば品目マスタを採用する", () => {
    const result = resolveVariableAccount({
      priority: "ITEM_MASTER_FIRST",
      itemAccountCode: "5101",
      headerAccountCode: "5199",
      fallbackAccountCode: "5100",
    });
    expect(result).toEqual({ accountCode: "5101", source: "ITEM_MASTER" });
  });

  it("品目マスタが未設定ならヘッダーへフォールバックする", () => {
    const result = resolveVariableAccount({
      priority: "ITEM_MASTER_FIRST",
      itemAccountCode: null,
      headerAccountCode: "5199",
      fallbackAccountCode: "5100",
    });
    expect(result).toEqual({ accountCode: "5199", source: "HEADER" });
  });

  it("品目マスタ・ヘッダー両方未設定ならルールマスタの既定科目を使う", () => {
    const result = resolveVariableAccount({
      priority: "ITEM_MASTER_FIRST",
      itemAccountCode: null,
      headerAccountCode: null,
      fallbackAccountCode: "5100",
    });
    expect(result).toEqual({ accountCode: "5100", source: "FALLBACK" });
  });

  it("どこにも科目が無ければnull(呼び出し元でスキップ/エラー扱い)を返す", () => {
    const result = resolveVariableAccount({
      priority: "ITEM_MASTER_FIRST",
      itemAccountCode: null,
      headerAccountCode: null,
      fallbackAccountCode: null,
    });
    expect(result).toEqual({ accountCode: null, source: "NONE" });
  });
});

describe("resolveVariableAccount: HEADER_FIRST(伝票ヘッダー優先)", () => {
  it("品目マスタ・ヘッダー両方に値があればヘッダーを採用する", () => {
    const result = resolveVariableAccount({
      priority: "HEADER_FIRST",
      itemAccountCode: "5101",
      headerAccountCode: "5199",
      fallbackAccountCode: "5100",
    });
    expect(result).toEqual({ accountCode: "5199", source: "HEADER" });
  });

  it("ヘッダーが未設定なら品目マスタへフォールバックする", () => {
    const result = resolveVariableAccount({
      priority: "HEADER_FIRST",
      itemAccountCode: "5101",
      headerAccountCode: null,
      fallbackAccountCode: "5100",
    });
    expect(result).toEqual({ accountCode: "5101", source: "ITEM_MASTER" });
  });

  it("受注系のようにヘッダー科目の概念が無い場合(常にnull)は、実質ITEM_MASTER_FIRSTと同じ挙動になる", () => {
    const result = resolveVariableAccount({
      priority: "HEADER_FIRST",
      itemAccountCode: "4101",
      headerAccountCode: null,
      fallbackAccountCode: "4100",
    });
    expect(result).toEqual({ accountCode: "4101", source: "ITEM_MASTER" });
  });

  it("品目マスタ・ヘッダー両方未設定ならルールマスタの既定科目を使う", () => {
    const result = resolveVariableAccount({
      priority: "HEADER_FIRST",
      itemAccountCode: null,
      headerAccountCode: null,
      fallbackAccountCode: "5100",
    });
    expect(result).toEqual({ accountCode: "5100", source: "FALLBACK" });
  });
});
