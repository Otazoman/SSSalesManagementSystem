import { describe, it, expect } from "vitest";
import {
  HttpError,
  BadRequestError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  isHttpError,
  isForeignKeyConstraintError,
} from "./http-error";

describe("HttpError系クラス", () => {
  it("HttpErrorはstatus/code/messageを保持する", () => {
    const err = new HttpError(422, "不正な入力です", "INVALID_INPUT");
    expect(err.status).toBe(422);
    expect(err.message).toBe("不正な入力です");
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.name).toBe("HttpError");
    expect(err).toBeInstanceOf(Error);
  });

  it("BadRequestErrorはstatus 400を持つ", () => {
    const err = new BadRequestError("必須項目です");
    expect(err.status).toBe(400);
    expect(err.name).toBe("BadRequestError");
  });

  it("NotFoundErrorはstatus 404を持つ", () => {
    const err = new NotFoundError("見つかりません");
    expect(err.status).toBe(404);
    expect(err.name).toBe("NotFoundError");
  });

  it("ConflictErrorはstatus 409を持つ", () => {
    const err = new ConflictError("既に使用中です");
    expect(err.status).toBe(409);
    expect(err.name).toBe("ConflictError");
  });

  it("ForbiddenErrorはstatus 403を持つ", () => {
    const err = new ForbiddenError("この操作をする権限がありません");
    expect(err.status).toBe(403);
    expect(err.name).toBe("ForbiddenError");
  });
});

describe("isHttpError", () => {
  it("HttpErrorのインスタンスに対してtrueを返す", () => {
    expect(isHttpError(new NotFoundError("x"))).toBe(true);
  });

  it("通常のErrorや非Errorに対してfalseを返す", () => {
    expect(isHttpError(new Error("x"))).toBe(false);
    expect(isHttpError("plain string")).toBe(false);
    expect(isHttpError(null)).toBe(false);
  });
});

describe("isForeignKeyConstraintError", () => {
  it("CONSTRAINT/foreign key/FOREIGN_KEYを含むメッセージ(大小混在)を検出する", () => {
    expect(
      isForeignKeyConstraintError(new Error("SQLITE_CONSTRAINT: FOREIGN KEY constraint failed")),
    ).toBe(true);
    expect(isForeignKeyConstraintError(new Error("foreign key mismatch"))).toBe(true);
    expect(isForeignKeyConstraintError(new Error("FOREIGN_KEY violation"))).toBe(true);
  });

  it("制約違反と無関係なエラーはfalseを返す", () => {
    expect(isForeignKeyConstraintError(new Error("network timeout"))).toBe(false);
  });

  it("Errorインスタンスでない値も文字列化して判定する", () => {
    expect(isForeignKeyConstraintError("has CONSTRAINT in it")).toBe(true);
  });

  it("Drizzleのように.causeに実際のエラーが格納されているケースも検出する(最大5階層)", () => {
    const rawDriverError = new Error("FOREIGN KEY constraint failed");
    const drizzleWrapped = new Error("Failed query: delete from units where...", {
      cause: rawDriverError,
    });
    expect(isForeignKeyConstraintError(drizzleWrapped)).toBe(true);
  });

  it("6階層以上ネストした.causeは検出しない(上限を超えるため)", () => {
    let err: Error = new Error("FOREIGN KEY constraint failed");
    for (let i = 0; i < 6; i++) {
      err = new Error(`wrapper level ${i}`, { cause: err });
    }
    expect(isForeignKeyConstraintError(err)).toBe(false);
  });
});
