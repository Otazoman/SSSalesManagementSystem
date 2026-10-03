import { describe, it, expect } from "vitest";
import { generateAttachmentKey } from "./generate-attachment-key";

describe("generateAttachmentKey", () => {
  it("prefix/UUID_ファイル名 の形式でキーを生成する", () => {
    const key = generateAttachmentKey("partners", "契約書.pdf");
    expect(key).toMatch(
      /^partners\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_契約書\.pdf$/,
    );
  });

  it("呼び出すたびに異なるキーを返す(衝突しないランダム性)", () => {
    const key1 = generateAttachmentKey("warehouses", "photo.png");
    const key2 = generateAttachmentKey("warehouses", "photo.png");
    expect(key1).not.toBe(key2);
  });
});
