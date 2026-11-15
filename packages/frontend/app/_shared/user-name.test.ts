import { describe, it, expect } from "vitest";
import { displayUserName } from "./user-name";

// BUG-093: 履歴の作成者を氏名で出す
describe("displayUserName", () => {
  const users = [{ employeeNumber: "E001", name: "在庫太郎" }];
  it("従業員番号から氏名を引く", () => {
    expect(displayUserName(users, "E001")).toBe("在庫太郎");
  });
  it("引けない時は従業員番号のまま、空なら空", () => {
    expect(displayUserName(users, "E999")).toBe("E999");
    expect(displayUserName(users, null)).toBe("");
  });
});
