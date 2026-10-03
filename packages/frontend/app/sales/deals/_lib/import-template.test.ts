import { describe, it, expect } from "vitest";
import { DEALS_IMPORT_HEADERS, buildDealsImportTemplate } from "./import-template";

// backendのdeals-csv-import.service.ts(DEALS_CSV_HEADERS)と同じ並びであること。
// 一方だけ変えるとインポートが「ヘッダー書式が正しくありません」で失敗するため、ここで固定する
const EXPECTED_HEADER =
  "groupKey,dealId,partnerId,title,dealDate,startTime,endTime,location,memo,status,ownerEmployeeNumber,quoteIds,attendeeKind,attendeeValue,attendeeNote,taskTitle,taskDueDate,taskAssigneeEmployeeNumber,taskIsDone";

describe("buildDealsImportTemplate", () => {
  it("ヘッダーはbackendが要求する並びと一致する", () => {
    expect(DEALS_IMPORT_HEADERS.join(",")).toBe(EXPECTED_HEADER);
  });

  it("BOM付き・CRLFで、ヘッダー+記入例3行を出力し、各行の列数はヘッダーと同じ", () => {
    const text = buildDealsImportTemplate();

    expect(text.startsWith("\uFEFF")).toBe(true);
    const lines = text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(EXPECTED_HEADER);
    expect(lines).toHaveLength(4);
    for (const line of lines.slice(1)) {
      expect(line.split('","').length).toBe(DEALS_IMPORT_HEADERS.length);
    }
  });

  it("記入例は同じgroupKeyの3行で1商談を表す(2行目以降の商談本体の項目は空欄)", () => {
    const rows = buildDealsImportTemplate().slice(1).trimEnd().split("\r\n").slice(1);

    expect(rows.every((r) => r.startsWith('"1",'))).toBe(true);
    expect(rows[1]).toContain('"","","","","","","","","","","",');
  });
});
