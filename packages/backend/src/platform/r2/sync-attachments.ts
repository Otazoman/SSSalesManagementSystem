import { generateAttachmentKey } from "./generate-attachment-key";

// 2026-10-18(BUG-068): 伝票の保存で、添付を全件削除して入れ直すのをやめ、既存の行を保ったまま保存内容に合わせる共通処理。
// 以前は保存のたびに添付IDが変わり(取引先へメールしたダウンロードリンクが無効になる)、登録者・登録日時・
// 明細とのつながりも失われていた。発注・見積・購買申請・受注・売上・仕入の更新処理で使う。
//
// - 保存内容の添付を、id → R2のパス →(共有リンクは)リンクとファイル名 →(R2でパスが無い場合)ファイル名 の順で既存の行と対応付ける
// - 対応した行は、ID・種類(送られなければ既存の値)・登録者・登録日時・明細とのつながりを保ったまま、
//   ファイル名・リンクだけ更新する。新しいファイルを選び直した場合だけ、R2のパス・登録者・登録日時も更新する
// - 対応しない添付は新しい行として追加し、保存内容に無い既存の行だけ削除する
// - R2へのアップロードはその場で行い、DBの書き込みは渡された関数(recordWritesForBatch の tx.repo のメソッド)で行う
// - 戻り値の keptR2Paths は保存後に残るR2のパス。不要ファイルの削除(deleteOrphanedR2Attachments)の判定に使う
//   (画面から送られたパスで判定すると、パスを送らずIDで対応付いた添付の実ファイルを消してしまうため)

export interface ExistingAttachment {
  id: string;
  fileName: string;
  storageType: string;
  attachmentR2Path: string | null;
  externalUrl: string | null;
  fileType?: string | null;
}

export interface IncomingAttachment {
  id?: string | null;
  fileName: string;
  storageType?: string | null;
  attachmentR2Path?: string | null;
  externalUrl?: string | null;
  fileType?: string | null;
}

export interface AttachmentWriteData {
  fileName: string;
  storageType: string;
  attachmentR2Path: string | null;
  externalUrl: string | null;
  // 種類の列が無い表(購買申請)では hasFileType: false とし、含めない
  fileType?: string;
  uploadedById: string;
  uploadedAt: Date;
}

export async function syncAttachments(params: {
  existing: ExistingAttachment[];
  incoming: IncomingAttachment[];
  formData: FormData;
  bucket: R2Bucket;
  keyPrefix: string;
  operatorId: string;
  hasFileType: boolean;
  update: (attachmentId: string, data: Partial<AttachmentWriteData>) => Promise<void>;
  insert: (data: AttachmentWriteData & { id: string }) => Promise<void>;
  deleteByIds: (attachmentIds: string[]) => Promise<void>;
}): Promise<{ keptR2Paths: Array<string | null> }> {
  const { existing, incoming, formData, bucket, keyPrefix, operatorId, hasFileType } = params;
  const unmatched = new Map(existing.map((ea) => [ea.id, ea]));
  const takeMatch = (predicate: (ea: ExistingAttachment) => boolean) => {
    for (const ea of unmatched.values()) {
      if (predicate(ea)) {
        unmatched.delete(ea.id);
        return ea;
      }
    }
    return null;
  };
  const keptR2Paths: Array<string | null> = [];

  for (const att of incoming) {
    const storageType = att.storageType || "R2";
    const matched =
      (att.id ? takeMatch((ea) => ea.id === att.id) : null) ??
      (storageType === "R2" && att.attachmentR2Path
        ? takeMatch((ea) => ea.storageType === "R2" && ea.attachmentR2Path === att.attachmentR2Path)
        : null) ??
      (storageType !== "R2"
        ? takeMatch(
            (ea) =>
              ea.storageType === storageType &&
              ea.externalUrl === (att.externalUrl || null) &&
              ea.fileName === att.fileName,
          )
        : null) ??
      (storageType === "R2" && !att.attachmentR2Path
        ? takeMatch((ea) => ea.storageType === "R2" && ea.fileName === att.fileName)
        : null);

    let r2Path = matched?.attachmentR2Path ?? att.attachmentR2Path ?? null;
    let externalUrl: string | null = null;
    let isNewUpload = false;

    if (storageType === "R2") {
      const fileObj = formData.get(`files[${att.fileName}]`) as File | null;
      if (fileObj) {
        r2Path = generateAttachmentKey(keyPrefix, fileObj.name);
        await bucket.put(r2Path, fileObj.stream(), {
          httpMetadata: { contentType: fileObj.type },
        });
        isNewUpload = true;
      }
    } else {
      externalUrl = att.externalUrl || null;
    }

    if (matched) {
      if (storageType === "R2") keptR2Paths.push(r2Path);
      await params.update(matched.id, {
        fileName: att.fileName,
        attachmentR2Path: storageType === "R2" ? r2Path : null,
        externalUrl,
        ...(hasFileType ? { fileType: att.fileType || matched.fileType || "OTHER" } : {}),
        ...(isNewUpload ? { uploadedById: operatorId, uploadedAt: new Date() } : {}),
      });
    } else if (r2Path || externalUrl) {
      if (storageType === "R2") keptR2Paths.push(r2Path);
      await params.insert({
        id: crypto.randomUUID(),
        fileName: att.fileName,
        storageType,
        attachmentR2Path: r2Path,
        externalUrl,
        ...(hasFileType ? { fileType: att.fileType || "OTHER" } : {}),
        uploadedById: operatorId,
        uploadedAt: new Date(),
      });
    }
  }

  if (unmatched.size > 0) {
    await params.deleteByIds([...unmatched.keys()]);
  }
  return { keptR2Paths };
}
