import { describe, it, expect } from "vitest";
import { formatDirectShipmentPlace, splitDirectShipmentPlace } from "./direct-shipment-place";

// REQ-005: 直送の発注の納品場所(直送先)の組み立て
describe("formatDirectShipmentPlace", () => {
  const partner = { name: "得意先A", postalCode: "100-0001", address: "東京都千代田区1-1" };

  it("受注で納品先を選んでいれば、得意先名と納品先の名前・住所にする", () => {
    expect(
      formatDirectShipmentPlace(partner, { name: "大阪倉庫", postalCode: "530-0001", address: "大阪市北区1-1" }, "自由入力"),
    ).toBe("直送: 得意先A 大阪倉庫 〒530-0001 大阪市北区1-1");
  });

  it("納品先が無ければ受注の納品場所、それも無ければ得意先の住所にする", () => {
    expect(formatDirectShipmentPlace(partner, null, "現場事務所")).toBe("直送: 得意先A 現場事務所");
    expect(formatDirectShipmentPlace(partner, null, null)).toBe("直送: 得意先A 〒100-0001 東京都千代田区1-1");
  });

  it("何も取得できなければ「直送」だけにする", () => {
    expect(formatDirectShipmentPlace(null, null, null)).toBe("直送");
  });
});

// REQ-009: 納品場所を名称と所在地に分ける
describe("splitDirectShipmentPlace", () => {
  const partner = { name: "得意先A", postalCode: "100-0001", address: "東京都千代田区1-1" };
  it("納品先があれば、名称は「直送: 得意先名 納品先名」、所在地は納品先の住所", () => {
    expect(splitDirectShipmentPlace(partner, { name: "大阪倉庫", postalCode: "530-0001", address: "大阪市北区1-1" }, "自由入力")).toEqual({
      name: "直送: 得意先A 大阪倉庫",
      address: "〒530-0001 大阪市北区1-1",
    });
  });
  it("納品先が無ければ所在地は受注の納品場所、それも無ければ得意先の住所", () => {
    expect(splitDirectShipmentPlace(partner, null, "現場事務所")).toEqual({ name: "直送: 得意先A", address: "現場事務所" });
    expect(splitDirectShipmentPlace(partner, null, null)).toEqual({ name: "直送: 得意先A", address: "〒100-0001 東京都千代田区1-1" });
    expect(splitDirectShipmentPlace(null, null, null)).toEqual({ name: "直送", address: "" });
  });
});
