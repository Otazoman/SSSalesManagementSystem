export interface AttachmentLike {
  storageType: string;
  attachmentR2Path: string | null;
}

/**
 * 更新後に残っていない(=削除された)R2添付ファイルをバケットから削除する。
 * 各機能(partners/warehouses/quotes/products)で重複していた「新しい添付ファイル一覧との差分検出→
 * 参照されなくなったR2オブジェクトの削除」ロジックを共通化したもの。
 * 個々の削除失敗はconsole.errorに記録するのみで例外を投げない(既存の挙動を踏襲)。
 */
export async function deleteOrphanedR2Attachments(
  bucket: R2Bucket,
  oldAttachments: AttachmentLike[],
  newAttachmentPaths: Iterable<string | null | undefined>,
  // 追加要望L-3-a: バケット分離前に保存された既存ファイルは旧バケットにあるため、そちらからも削除する
  legacyBucket?: R2Bucket,
): Promise<void> {
  const stillReferenced = new Set(
    Array.from(newAttachmentPaths).filter((p): p is string => Boolean(p)),
  );

  for (const oldAtt of oldAttachments) {
    if (oldAtt.storageType === "R2" && oldAtt.attachmentR2Path) {
      if (!stillReferenced.has(oldAtt.attachmentR2Path)) {
        try {
          await bucket.delete(oldAtt.attachmentR2Path);
          if (legacyBucket) await legacyBucket.delete(oldAtt.attachmentR2Path);
        } catch (err) {
          console.error("R2ファイル削除失敗", err);
        }
      }
    }
  }
}
