// #14-2③: deals.repository.ts・progress.repository.tsに、D1の1クエリあたりの
// バインド変数上限(100個)対策としてIN句をチャンク分割する処理(inChunks)が、
// コメント含めて完全に同一のまま重複実装されていたため共通化する。

// D1は1クエリあたりのバインド変数が100個までのため、IN句は余裕を見てこの件数ずつ分割する
export const IN_CHUNK_SIZE = 80;

export async function fetchInChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const unique = [...new Set(ids.filter((id) => !!id))];
  const result: T[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK_SIZE) {
    result.push(...(await fetchChunk(unique.slice(i, i + IN_CHUNK_SIZE))));
  }
  return result;
}
