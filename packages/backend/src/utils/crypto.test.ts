import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./crypto";
import { legacyHash } from "../../test/support/legacy-password-hash";

describe("パスワードのハッシュ化と照合(BUG-021)", () => {
  it("ユーザーごとの乱数ソルトを使うため、同じパスワードでも毎回違う値になり、どちらも照合できる", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await verifyPassword("same-password", a)).toEqual({ ok: true, needsRehash: false });
    expect((await verifyPassword("same-password", b)).ok).toBe(true);
  });

  it("違うパスワード・保存値そのもの・空の保存値は一致しない", async () => {
    const stored = await hashPassword("correct-password");
    expect((await verifyPassword("wrong-password", stored)).ok).toBe(false);
    expect((await verifyPassword(stored, stored)).ok).toBe(false);
    expect((await verifyPassword("x", null)).ok).toBe(false);
    expect((await verifyPassword("x", "")).ok).toBe(false);
  });

  it("以前の形(固定ソルト)は照合でき、書き換えが必要と返す。その値を入力しても一致しない", async () => {
    const legacy = await legacyHash("old-password");
    expect(await verifyPassword("old-password", legacy)).toEqual({ ok: true, needsRehash: true });
    expect((await verifyPassword("wrong", legacy)).ok).toBe(false);
    expect((await verifyPassword(legacy, legacy)).ok).toBe(false);
  });

  it("平文のまま保存された値は、同じ文字を入力しても一致しない(平文との比較は廃止)", async () => {
    expect((await verifyPassword("plain-password", "plain-password")).ok).toBe(false);
  });

  it("形式が壊れた保存値は一致しない", async () => {
    expect((await verifyPassword("x", "pbkdf2-sha256$abc$zz$00")).ok).toBe(false);
    expect((await verifyPassword("x", "pbkdf2-sha256$999999999$00$00")).ok).toBe(false);
  });
});
