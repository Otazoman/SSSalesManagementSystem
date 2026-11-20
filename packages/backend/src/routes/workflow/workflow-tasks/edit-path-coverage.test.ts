import { describe, it, expect } from "vitest";
import { listTargetTypes } from "../../../workflow-engine/target-adapters/registry";
import { WorkflowTasksApprovalService } from "./workflow-tasks-approval.service";

// REQ-016: 承認のプレビューの「伝票を開く」と「修正して再申請」は、申請の種類から画面のパスを解決する。
// 1つの種類に複数の画面がある種類(入出庫・指示)はデータを見て解決するため、ここでは対象外(別のテストで確かめている)。
const RESOLVED_BY_DATA = ["inventory_stock", "inventory_instructions"];

describe("申請の種類から画面のパスを解決する(REQ-016)", () => {
  for (const targetType of listTargetTypes().filter((t) => !RESOLVED_BY_DATA.includes(t))) {
    it(`${targetType}: 画面のパスが見つかる`, async () => {
      const path = await WorkflowTasksApprovalService.resolveEditPath(null, targetType, "ID-1");
      expect(path).toMatch(/^\//);
    });
  }
});
