import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { getTargetAdapter } from "./registry";

// BUG-089: マスタの変更申請は、変更後の内容を退避データに持つ(承認待ちの間、今の行は変更前のまま)。
// プレビューは、退避した変更後の内容を新しい内容、今の行を変更前の内容として出す

const db = drizzle(env.DB, { schema });
const now = new Date();

beforeEach(async () => {
  await db.delete(schema.masterApprovalContexts);
  await db.delete(schema.masterApprovalRequests);
  await db.delete(schema.units);
  await db.insert(schema.units).values({
    code: "PCS",
    name: "個",
    status: "temporary",
    createdBy: "E001",
    createdAt: now,
    updatedBy: "E001",
    updatedAt: now,
  });
  await db.insert(schema.masterApprovalRequests).values({
    id: "REQ-1",
    targetType: "master_units",
    targetId: "PCS",
    requestType: "UPDATE",
    status: "PENDING",
    applicantId: "user-1",
    createdAt: now,
    updatedAt: now,
  });
});

describe("マスタの変更申請のプレビュー(BUG-089)", () => {
  it("退避した変更後の内容を新しい内容、今の行を変更前の内容として返す", async () => {
    await db.insert(schema.masterApprovalContexts).values({
      id: "CTX-1",
      requestId: "REQ-1",
      generalMemo: JSON.stringify({ name: "ピース", status: "active" }),
      createdBy: "E001",
      createdAt: now,
      updatedBy: "E001",
      updatedAt: now,
    });
    const adapter = getTargetAdapter("master_units")!;

    const task = await adapter.getTaskPreview!({ db, requestId: "REQ-1", targetId: "PCS" });
    expect(task.previewData).toMatchObject({ code: "PCS", name: "ピース", status: "active" });

    const history = await adapter.getHistoryPreview!({ db, requestId: "REQ-1", targetId: "PCS", requestType: "UPDATE" });
    expect(history.snapshotNew).toMatchObject({ code: "PCS", name: "ピース" });
    expect(history.snapshotOld).toMatchObject({ code: "PCS", name: "個" });
  });

  it("新規の申請では変更前の内容を出さない。退避データが無ければ今の行を出す(以前と同じ)", async () => {
    const adapter = getTargetAdapter("master_units")!;
    const history = await adapter.getHistoryPreview!({ db, requestId: "REQ-1", targetId: "PCS", requestType: "REGISTER" });
    expect(history.snapshotNew).toMatchObject({ code: "PCS", name: "個" });
    expect(history.snapshotOld).toBeNull();
  });
});
