import { describe, it, expect } from "vitest";
import { syncAttachments, ExistingAttachment, AttachmentWriteData } from "./sync-attachments";

// 2026-10-18(BUG-068): 伝票の保存で添付の行を保ったまま保存内容に合わせる共通処理のテスト
function setup(existing: ExistingAttachment[], files: Record<string, File> = {}) {
  const updates: Array<{ id: string; data: Partial<AttachmentWriteData> }> = [];
  const inserts: Array<AttachmentWriteData & { id: string }> = [];
  const deletes: string[][] = [];
  const puts: string[] = [];
  const formData = new FormData();
  for (const [name, file] of Object.entries(files)) formData.append(`files[${name}]`, file);
  const bucket = {
    put: async (key: string) => {
      puts.push(key);
      return null;
    },
  } as unknown as R2Bucket;
  const run = (incoming: Parameters<typeof syncAttachments>[0]["incoming"], hasFileType = true) =>
    syncAttachments({
      existing,
      incoming,
      formData,
      bucket,
      keyPrefix: "docs/D-1",
      operatorId: "E-NEW",
      hasFileType,
      update: async (id, data) => {
        updates.push({ id, data });
      },
      insert: async (data) => {
        inserts.push(data);
      },
      deleteByIds: async (ids) => {
        deletes.push(ids);
      },
    });
  return { run, updates, inserts, deletes, puts };
}

const pdf: ExistingAttachment = {
  id: "A-PDF",
  fileName: "見積書.pdf",
  storageType: "R2",
  attachmentR2Path: "docs/D-1/q.pdf",
  externalUrl: null,
  fileType: "PDF",
};
const link: ExistingAttachment = {
  id: "A-LINK",
  fileName: "仕様書",
  storageType: "GOOGLE_DRIVE",
  attachmentR2Path: null,
  externalUrl: "https://example.com/spec",
  fileType: "OTHER",
};

describe("syncAttachments", () => {
  it("IDで対応付いた添付は行を保ったまま更新し、種類が送られなければ既存の種類を使う", async () => {
    const t = setup([pdf, link]);
    const { keptR2Paths } = await t.run([
      { id: "A-PDF", fileName: "見積書.pdf", storageType: "R2" },
      { id: "A-LINK", fileName: "仕様書(改)", storageType: "GOOGLE_DRIVE", externalUrl: "https://example.com/v2" },
    ]);
    expect(t.inserts).toHaveLength(0);
    expect(t.deletes).toHaveLength(0);
    expect(t.updates).toEqual([
      { id: "A-PDF", data: { fileName: "見積書.pdf", attachmentR2Path: "docs/D-1/q.pdf", externalUrl: null, fileType: "PDF" } },
      {
        id: "A-LINK",
        data: { fileName: "仕様書(改)", attachmentR2Path: null, externalUrl: "https://example.com/v2", fileType: "OTHER" },
      },
    ]);
    // パスを送らずIDで対応付いた添付の実ファイルも、残るパスとして返す(不要ファイルとして消さないため)
    expect(keptR2Paths).toEqual(["docs/D-1/q.pdf"]);
  });

  it("IDが無くても、R2のパス・共有リンクとファイル名で対応付ける", async () => {
    const t = setup([pdf, link]);
    await t.run([
      { fileName: "見積書.pdf", storageType: "R2", attachmentR2Path: "docs/D-1/q.pdf" },
      { fileName: "仕様書", storageType: "GOOGLE_DRIVE", externalUrl: "https://example.com/spec" },
    ]);
    expect(t.updates.map((u) => u.id)).toEqual(["A-PDF", "A-LINK"]);
    expect(t.inserts).toHaveLength(0);
  });

  it("送られなかった既存の添付は削除し、新しい添付は登録者・登録日時付きで追加する", async () => {
    const t = setup([pdf, link]);
    await t.run([{ fileName: "図面", storageType: "GOOGLE_DRIVE", externalUrl: "https://example.com/drawing" }]);
    expect(t.deletes).toEqual([["A-PDF", "A-LINK"]]);
    expect(t.inserts).toHaveLength(1);
    expect(t.inserts[0]).toMatchObject({
      fileName: "図面",
      storageType: "GOOGLE_DRIVE",
      externalUrl: "https://example.com/drawing",
      fileType: "OTHER",
      uploadedById: "E-NEW",
    });
  });

  it("既存の添付に新しいファイルを選び直した場合は、R2へ保存し、パス・登録者を更新する", async () => {
    const t = setup([pdf], { "見積書.pdf": new File(["x"], "見積書.pdf", { type: "application/pdf" }) });
    const { keptR2Paths } = await t.run([{ id: "A-PDF", fileName: "見積書.pdf", storageType: "R2" }]);
    expect(t.puts).toHaveLength(1);
    expect(t.updates[0].data.attachmentR2Path).toBe(t.puts[0]);
    expect(t.updates[0].data.uploadedById).toBe("E-NEW");
    expect(keptR2Paths).toEqual([t.puts[0]]);
  });

  it("種類の列が無い表(hasFileType: false)では種類を書き込まない", async () => {
    const t = setup([link]);
    await t.run(
      [
        { id: "A-LINK", fileName: "仕様書", storageType: "GOOGLE_DRIVE", externalUrl: "https://example.com/spec" },
        { fileName: "新規", storageType: "GOOGLE_DRIVE", externalUrl: "https://example.com/new" },
      ],
      false,
    );
    expect("fileType" in t.updates[0].data).toBe(false);
    expect("fileType" in t.inserts[0]).toBe(false);
  });

  it("1つの既存の添付は1回しか対応付けない(同じ名前の添付が2つ送られたら2つ目は追加)", async () => {
    const t = setup([link]);
    await t.run([
      { fileName: "仕様書", storageType: "GOOGLE_DRIVE", externalUrl: "https://example.com/spec" },
      { fileName: "仕様書", storageType: "GOOGLE_DRIVE", externalUrl: "https://example.com/spec" },
    ]);
    expect(t.updates).toHaveLength(1);
    expect(t.inserts).toHaveLength(1);
  });
});
