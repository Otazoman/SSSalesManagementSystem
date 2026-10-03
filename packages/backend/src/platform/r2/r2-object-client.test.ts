import { describe, it, expect, vi } from "vitest";
import { R2ObjectClient } from "./r2-object-client";

function createFakeBucket() {
  return {
    put: vi.fn().mockResolvedValue({ key: "fake" }),
    get: vi.fn().mockResolvedValue({ key: "fake", body: "stream" }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe("R2ObjectClient", () => {
  it("putは内部のbucket.putへそのまま委譲する", async () => {
    const bucket = createFakeBucket();
    const client = new R2ObjectClient(bucket as unknown as R2Bucket);

    await client.put("path/to/file.pdf", "content", {
      httpMetadata: { contentType: "application/pdf" },
    });

    expect(bucket.put).toHaveBeenCalledWith("path/to/file.pdf", "content", {
      httpMetadata: { contentType: "application/pdf" },
    });
  });

  it("getは内部のbucket.getへそのまま委譲する", async () => {
    const bucket = createFakeBucket();
    const client = new R2ObjectClient(bucket as unknown as R2Bucket);

    const result = await client.get("path/to/file.pdf");

    expect(bucket.get).toHaveBeenCalledWith("path/to/file.pdf");
    expect(result).toEqual({ key: "fake", body: "stream" });
  });

  it("deleteは内部のbucket.deleteへそのまま委譲する", async () => {
    const bucket = createFakeBucket();
    const client = new R2ObjectClient(bucket as unknown as R2Bucket);

    await client.delete("path/to/file.pdf");

    expect(bucket.delete).toHaveBeenCalledWith("path/to/file.pdf");
  });
});
