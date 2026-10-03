import * as v from "valibot";
import { requiredTrimmedString } from "../../../platform/validation/common-schema";

// 💡 DEDUP-BE-09で発見した抜け穴の修正: trimしてから空文字チェックする順序に統一
//    (旧: 空文字チェック→trim だと、空白のみの入力が必須チェックを一旦通過してしまっていた)

// 新規登録用ボディ
export const createUnitSchema = v.object({
  code: v.pipe(
    v.string(),
    v.transform((val) => val.trim()),
    v.nonEmpty("単位コードは必須です。"),
    v.transform((val) => val.toUpperCase()),
  ),
  name: requiredTrimmedString("単位名は必須です。"),
});

// 更新用ボディ
export const updateUnitSchema = v.object({
  name: requiredTrimmedString("単位名は必須です。"),
  status: requiredTrimmedString("ステータスは必須です。"),
});

export type CreateUnitInput = v.InferOutput<typeof createUnitSchema>;
export type UpdateUnitInput = v.InferOutput<typeof updateUnitSchema>;
