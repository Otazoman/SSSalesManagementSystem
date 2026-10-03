import * as v from "valibot";

/**
 * 必須(空文字不可)の文字列バリデーション。
 * `v.pipe(v.string(), v.nonEmpty(message))`という形で各機能のschemaファイルに
 * 重複実装されていたものを共通化したもの(trim等の変換は行わない、既存の非trim版のみ対象)。
 */
export function requiredString(message: string) {
  return v.pipe(v.string(), v.nonEmpty(message));
}

/**
 * 必須(trim後に空文字不可)の文字列バリデーション。
 * 先にtrimしてから空文字チェックを行うため、空白のみの入力("  "等)を正しく拒否する。
 * (発見事項: 一部の機能では逆順=「空文字チェック→trim」になっており、空白のみの入力が
 * 「必須」チェックを一旦通過した後にtrimで空文字になってしまう潜在的な抜け穴があった。
 * このプリミティブはその抜け穴を修正した正しい順序を実装したもの。DEDUP-BE-09参照)
 */
export function requiredTrimmedString(message: string) {
  return v.pipe(
    v.string(),
    v.transform((val) => val.trim()),
    v.nonEmpty(message),
  );
}
