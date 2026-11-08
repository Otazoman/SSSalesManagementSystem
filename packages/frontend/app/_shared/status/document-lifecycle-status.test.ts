import { describe, it, expect } from "vitest";
import { getDocumentLifecycleStatus } from "./document-lifecycle-status";

// BUG-080: 承認機能が無効の伝票では、一覧・入力画面とも APPROVED を「確定」と表示する(入力画面の選択肢「下書き/確定」と合わせる)
describe("getDocumentLifecycleStatus", () => {
  it("承認機能が無効なら、承認済みを「確定」と表示する", () => {
    expect(getDocumentLifecycleStatus("APPROVED", { approvalEnabled: false }).label).toBe("🟢 確定");
  });

  it("承認機能が有効、または指定が無ければ「承認済み」", () => {
    expect(getDocumentLifecycleStatus("APPROVED", { approvalEnabled: true }).label).toBe("🟢 承認済み");
    expect(getDocumentLifecycleStatus("APPROVED").label).toBe("🟢 承認済み");
  });

  it("承認済み以外の状態は、承認機能の有無で変えない", () => {
    expect(getDocumentLifecycleStatus("DRAFT", { approvalEnabled: false }).label).toBe("⚪ 下書き");
  });
});
