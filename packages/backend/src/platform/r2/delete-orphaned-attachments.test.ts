import { describe, it, expect, vi } from "vitest";
import { deleteOrphanedR2Attachments } from "./delete-orphaned-attachments";

function createFakeBucket(deleteImpl?: (key: string) => Promise<void>) {
  return {
    delete: vi.fn(deleteImpl ?? (async () => {})),
  } as unknown as R2Bucket;
}

describe("deleteOrphanedR2Attachments", () => {
  it("新しい一覧に残っていないR2添付ファイルのみ削除する", async () => {
    const bucket = createFakeBucket();
    const oldAttachments = [
      { storageType: "R2", attachmentR2Path: "partners/keep.png" },
      { storageType: "R2", attachmentR2Path: "partners/remove.png" },
    ];

    await deleteOrphanedR2Attachments(bucket, oldAttachments, [
      "partners/keep.png",
    ]);

    expect(bucket.delete).toHaveBeenCalledTimes(1);
    expect(bucket.delete).toHaveBeenCalledWith("partners/remove.png");
  });

  it("storageTypeがR2以外(externalUrl等)は削除対象にしない", async () => {
    const bucket = createFakeBucket();
    const oldAttachments = [
      { storageType: "URL", attachmentR2Path: null },
    ];

    await deleteOrphanedR2Attachments(bucket, oldAttachments, []);

    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("新しい一覧が空の場合はすべてのR2添付ファイルを削除する", async () => {
    const bucket = createFakeBucket();
    const oldAttachments = [
      { storageType: "R2", attachmentR2Path: "warehouses/a.png" },
      { storageType: "R2", attachmentR2Path: "warehouses/b.png" },
    ];

    await deleteOrphanedR2Attachments(bucket, oldAttachments, []);

    expect(bucket.delete).toHaveBeenCalledTimes(2);
  });

  it("削除に失敗しても例外を投げない(console.errorのみ)", async () => {
    const bucket = createFakeBucket(async () => {
      throw new Error("R2 delete failed");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const oldAttachments = [
      { storageType: "R2", attachmentR2Path: "quotes/x.png" },
    ];

    await expect(
      deleteOrphanedR2Attachments(bucket, oldAttachments, []),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
