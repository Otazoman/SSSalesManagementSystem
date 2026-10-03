import { describe, it, expect } from "vitest";
import { getTargetAdapter } from "./registry";

describe("getTargetAdapter", () => {
  it("master_partnersに対して4つのメソッドを備えたadapterを返す", () => {
    const adapter = getTargetAdapter("master_partners");
    expect(adapter).toBeDefined();
    expect(typeof adapter?.resolveAmount).toBe("function");
    expect(typeof adapter?.applyApproved).toBe("function");
    expect(typeof adapter?.getTaskPreview).toBe("function");
    expect(typeof adapter?.getHistoryPreview).toBe("function");
  });

  it("master_structuresに対してapplyApproved/getTaskPreview/getHistoryPreviewを備えたadapterを返す(Phase6)", () => {
    const adapter = getTargetAdapter("master_structures");
    expect(adapter).toBeDefined();
    expect(typeof adapter?.applyApproved).toBe("function");
    expect(typeof adapter?.getTaskPreview).toBe("function");
    expect(typeof adapter?.getHistoryPreview).toBe("function");
  });

  it("未登録のtargetTypeに対してはundefinedを返す(=汎用エンジンのみ動作し、実マスタへの反映は行われない)", () => {
    // 💡 消費税マスタは承認ワークフロー対象外(ユーザー決定)のため、恒久的に未登録のまま。
    expect(getTargetAdapter("master_tax_categories")).toBeUndefined();
    expect(getTargetAdapter("unknown_type")).toBeUndefined();
  });
});
