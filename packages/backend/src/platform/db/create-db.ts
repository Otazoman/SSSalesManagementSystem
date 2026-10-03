import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * D1Databaseバインディングからアプリ共通のDrizzleインスタンスを生成する。
 * Route層が`drizzle`/`schema`を直接importして都度組み立てる代わりに使う共通ヘルパー。
 */
export function createDb(d1: D1Database): AppDb {
  return drizzle(d1, { schema });
}
