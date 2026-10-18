import { describe, it, expect } from "vitest";
import { parseDeliveryDateText, applyDeliveryDateTextToItems } from "./parse-delivery-date-text";

describe("parseDeliveryDateText", () => {
  it("日付として読める値をYYYY-MM-DDにし、文言や存在しない日付はnullにする", () => {
    expect(parseDeliveryDateText("2026-11-10")).toBe("2026-11-10");
    expect(parseDeliveryDateText(" 2026/1/5 ")).toBe("2026-01-05");
    expect(parseDeliveryDateText("発注確定後、約2週間")).toBeNull();
    expect(parseDeliveryDateText("2026-02-30")).toBeNull();
    expect(parseDeliveryDateText("")).toBeNull();
  });
});

describe("applyDeliveryDateTextToItems", () => {
  it("希望納期が空欄の明細にだけセットし、明細ごとに入れた希望納期は上書きしない", () => {
    const items = [{ requestedDeliveryDate: null }, { requestedDeliveryDate: "2026-12-01" }];
    expect(applyDeliveryDateTextToItems(items, "", "2026/11/10")).toEqual([
      { requestedDeliveryDate: "2026-11-10" },
      { requestedDeliveryDate: "2026-12-01" },
    ]);
  });

  it("入力途中で一度セットされた日付は、続けて入力した日付に追従する", () => {
    const afterFirst = applyDeliveryDateTextToItems([{ requestedDeliveryDate: null }], "", "2026/11/1");
    expect(afterFirst[0].requestedDeliveryDate).toBe("2026-11-01");
    const afterSecond = applyDeliveryDateTextToItems(afterFirst, "2026/11/1", "2026/11/10");
    expect(afterSecond[0].requestedDeliveryDate).toBe("2026-11-10");
  });

  it("文言に変えると、自動でセットされた日付は空欄に戻り、手で入れた日付は残る", () => {
    const items = [{ requestedDeliveryDate: "2026-11-10" }, { requestedDeliveryDate: "2026-12-01" }];
    expect(applyDeliveryDateTextToItems(items, "2026-11-10", "発注確定後、約2週間")).toEqual([
      { requestedDeliveryDate: null },
      { requestedDeliveryDate: "2026-12-01" },
    ]);
  });

  it("日付として読めない値どうしの変更では明細を変えない", () => {
    const items = [{ requestedDeliveryDate: null }];
    expect(applyDeliveryDateTextToItems(items, "約2週", "約2週間")).toBe(items);
  });
});
