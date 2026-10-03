import { and, eq, lte, or, gte, isNull } from "drizzle-orm";
import * as schema from "../db/schema";

/**
 * 💡 部署コード(id) から、指定日時点（デフォルトは現在）で有効な部署レコードを1件取得する
 * 主にフロントから送られてくる「人間用の部署コード」をサロゲートIDに変換する際に使用します
 */
export async function getActiveDepartmentById(
  db: any,
  departmentId: string,
  targetDate: Date = new Date(),
) {
  const cleanId = departmentId.trim();

  const results = await db
    .select()
    .from(schema.departments)
    .where(
      and(
        eq(schema.departments.id, cleanId),
        lte(schema.departments.validFrom, targetDate),
        or(
          isNull(schema.departments.validTo),
          gte(schema.departments.validTo, targetDate),
        ),
      ),
    )
    .limit(1);

  return results[0] || null;
}

/**
 * 💡 サロゲートID(surrogateId) から、指定日時点で有効な部署レコードを1件取得する
 * 厳密に1行を特定したい操作（PUTやDELETEなど）の事前存在チェックなどに使用します
 */
export async function getActiveDepartmentBySurrogateId(
  db: any,
  surrogateId: string,
  targetDate: Date = new Date(),
) {
  const results = await db
    .select()
    .from(schema.departments)
    .where(
      and(
        eq(schema.departments.surrogateId, surrogateId),
        lte(schema.departments.validFrom, targetDate),
        or(
          isNull(schema.departments.validTo),
          gte(schema.departments.validTo, targetDate),
        ),
      ),
    )
    .limit(1);

  return results[0] || null;
}
