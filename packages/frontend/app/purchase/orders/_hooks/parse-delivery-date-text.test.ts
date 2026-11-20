import { describe, it, expect } from "vitest";
import { parseDeliveryDateText, applyDeliveryDateTextToItems, withRequestedDeliveryDate } from "./parse-delivery-date-text";

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
      // REQ-020: 受注とつながらない明細は、回答納期にも同じ日付が入る
      { requestedDeliveryDate: "2026-11-10", answeredDeliveryDate: "2026-11-10" },
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
      { requestedDeliveryDate: null, answeredDeliveryDate: null },
      { requestedDeliveryDate: "2026-12-01" },
    ]);
  });

  it("日付として読めない値どうしの変更では明細を変えない", () => {
    const items = [{ requestedDeliveryDate: null }];
    expect(applyDeliveryDateTextToItems(items, "約2週", "約2週間")).toBe(items);
  });
});

// REQ-020: 受注とつながらない明細は、希望納期を回答納期に展開する(修正できる)
describe("withRequestedDeliveryDate", () => {
  it("受注なしの明細で希望を入れると回答も入り、希望を変えると回答も追従する", () => {
    expect(withRequestedDeliveryDate({}, "2026-11-20")).toEqual({
      requestedDeliveryDate: "2026-11-20",
      answeredDeliveryDate: "2026-11-20",
    });
    expect(
      withRequestedDeliveryDate({ requestedDeliveryDate: "2026-11-20", answeredDeliveryDate: "2026-11-20" }, "2026-11-25"),
    ).toEqual({ requestedDeliveryDate: "2026-11-25", answeredDeliveryDate: "2026-11-25" });
  });

  it("回答を手で別の日にした後は、希望を変えても回答を上書きしない", () => {
    expect(
      withRequestedDeliveryDate({ requestedDeliveryDate: "2026-11-20", answeredDeliveryDate: "2026-11-30" }, "2026-11-25"),
    ).toEqual({ requestedDeliveryDate: "2026-11-25" });
  });

  it("受注とつながる明細は回答に入れない(仕入先の回答を入れて受注の納期へ反映するため)", () => {
    expect(withRequestedDeliveryDate({ salesOrderItemId: "SOI-1" }, "2026-11-20")).toEqual({
      requestedDeliveryDate: "2026-11-20",
    });
  });
});
