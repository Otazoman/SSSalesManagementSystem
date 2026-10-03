/**
 * KV(COMPANY_SETTINGS)の"config"キーを取得し、JSONとしてパースして返す。
 * 各機能でほぼ同一のまま重複実装されていたKV取得+パース処理を共通化したもの。
 * キーが存在しない・空文字の場合はnullを返す(未設定時の挙動は呼び出し側に委ねる)。
 * 値がJSONとして不正な場合はJSON.parseの例外をそのまま呼び出し側へ伝播する。
 */
// 戻り値の型はJSON.parseの結果と同じくRecord<string, any>のまま返す。
// 各呼び出し元がsnake_caseのプロパティへ動的にアクセスする既存の書き方を変えないための措置。
export async function getCompanySettings(
  kv: KVNamespace,
): Promise<Record<string, any> | null> {
  const raw = await kv.get("config");
  if (!raw || raw.trim() === "") return null;
  return JSON.parse(raw);
}
