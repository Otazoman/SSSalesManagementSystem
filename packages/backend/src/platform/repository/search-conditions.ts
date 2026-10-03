import { and, type SQL } from "drizzle-orm";

/**
 * 動的に組み立てたWHERE条件の配列を1つのSQL条件へ結合する。
 * 各Repositoryで重複していた「conditions.length > 0 ? and(...conditions) : undefined」
 * (条件が1つもなければWHERE句なし=全件取得、1つ以上あればandで結合)を共通化したもの。
 */
export function combineConditions(
  conditions: Array<SQL | undefined>,
): SQL | undefined {
  return conditions.length > 0 ? and(...conditions) : undefined;
}
