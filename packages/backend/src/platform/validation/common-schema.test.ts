import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { requiredString, requiredTrimmedString } from "./common-schema";

describe("requiredString", () => {
  const schema = v.object({ name: requiredString("名前は必須です") });

  it("空文字でない文字列は許可する", () => {
    const result = v.safeParse(schema, { name: "テスト" });
    expect(result.success).toBe(true);
  });

  it("空文字は指定したメッセージで拒否する", () => {
    const result = v.safeParse(schema, { name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0].message).toBe("名前は必須です");
    }
  });

  it("trimは行わない(空白のみの文字列はそのまま通す、既存の非trim版と同じ挙動)", () => {
    const result = v.safeParse(schema, { name: "  " });
    expect(result.success).toBe(true);
  });

  it("文字列以外の型は拒否する", () => {
    const result = v.safeParse(schema, { name: 123 });
    expect(result.success).toBe(false);
  });
});

describe("requiredTrimmedString", () => {
  const schema = v.object({ name: requiredTrimmedString("名前は必須です") });

  it("前後の空白を除去した文字列を返す", () => {
    const result = v.safeParse(schema, { name: "  テスト  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.name).toBe("テスト");
    }
  });

  it("空文字は拒否する", () => {
    const result = v.safeParse(schema, { name: "" });
    expect(result.success).toBe(false);
  });

  it("空白のみの文字列はtrim後に空文字となるため拒否する(DEDUP-BE-09で発見した抜け穴の修正)", () => {
    const result = v.safeParse(schema, { name: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0].message).toBe("名前は必須です");
    }
  });
});
