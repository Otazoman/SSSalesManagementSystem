// 追加要望L-3-a: モジュール別にR2バケットを分離する際の「新バケット→旧バケット」フォールバック。
// 既存のファイルは旧バケット(見積と共用していた QUATES_BUCKET 等)に残したまま移さず、
// 新規の保存は新バケットへ、読み取りは新バケットを先に見て無ければ旧バケットを見る。
// DBには保存先バケットを持たない(attachmentR2Path等のキーのみ)ため、この順序で解決する。
export interface BucketPair {
  primary: R2Bucket; // 新バケット(書き込み先)
  legacy?: R2Bucket; // 旧バケット(既存ファイルの読み取り・削除用)
}

export async function getWithFallback(pair: BucketPair, key: string): Promise<R2ObjectBody | null> {
  const fromPrimary = await pair.primary.get(key);
  if (fromPrimary) return fromPrimary;
  return pair.legacy ? await pair.legacy.get(key) : null;
}

export async function headWithFallback(pair: BucketPair, key: string): Promise<R2Object | null> {
  const fromPrimary = await pair.primary.head(key);
  if (fromPrimary) return fromPrimary;
  return pair.legacy ? await pair.legacy.head(key) : null;
}

// キーがどちらのバケットにあるか分からないため両方から削除する(存在しないキーの削除はエラーにならない)
export async function deleteFromPair(pair: BucketPair, key: string): Promise<void> {
  await pair.primary.delete(key);
  if (pair.legacy) await pair.legacy.delete(key);
}
