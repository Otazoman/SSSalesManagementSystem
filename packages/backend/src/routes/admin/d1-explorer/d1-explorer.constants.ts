import { Env } from "../../../types/env";

// Item13-b: D1参照・編集機能で扱えるD1バインディングの一覧。
// DB_OTPはOTPコード(平文)を保持する機微DBのため意図的に含めない。
// writable=false のDBは閲覧のみ: ログDBは監査ログの改ざん防止、仕訳DBは仕訳編集(K-6の
// 反対仕訳+訂正仕訳)という正規の訂正経路を迂回させないため。変更する場合はここを書き換える
export const D1_DATABASE_REGISTRY = [
  { key: "main", label: "メインDB(伝票・マスタ)", binding: "DB", writable: true },
  { key: "log", label: "ログDB(監査ログ・メールログ等)", binding: "DB_LOG", writable: false },
  { key: "journal", label: "仕訳DB", binding: "DB_JOURNAL", writable: false },
  // 商談管理(追加要望M-1)。当初は閲覧のみだったが、ユーザー要望(2026-09-21)で編集・削除を許可。
  // 変更は監査ログに記録される。添付ファイル(R2)の実体は連動して消えないため、削除時は添付行との整合に注意
  { key: "deals", label: "商談DB", binding: "DB_DEALS", writable: true },
  // お知らせ・画面説明・ユーザー表示設定(2026-09-21)。管理画面を介さず直す必要が出得るため編集可
  { key: "ui", label: "表示設定DB(お知らせ・画面説明・ユーザー設定)", binding: "DB_UI", writable: true },
] as const;

// 書き込み(更新・削除)を禁止するテーブル(マイグレーション管理テーブル)
export const WRITE_PROTECTED_TABLES: ReadonlySet<string> = new Set(["d1_migrations", "__drizzle_migrations"]);

export type D1DatabaseKey = (typeof D1_DATABASE_REGISTRY)[number]["key"];
export const D1_DATABASE_KEYS = D1_DATABASE_REGISTRY.map((d) => d.key) as [D1DatabaseKey, ...D1DatabaseKey[]];

export function resolveD1(env: Env, key: string): D1Database | undefined {
  const entry = D1_DATABASE_REGISTRY.find((d) => d.key === key);
  if (!entry) return undefined;
  return env[entry.binding] as D1Database | undefined;
}

// 値をマスクする列名のパターン(パスワードハッシュ・トークン・秘密鍵・OTPコード等)
export const MASKED_COLUMN_PATTERN = /password|hash|secret|token|otp_code/i;

// 1ページの最大行数・許容する最大オフセット(D1無料プランの日次読み取り行数を画面操作で
// 使い切らないためのガードレール。OFFSETはスキップした行も読み取り行数に計上される)
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_OFFSET = 10000;

// セル値の最大文字数(巨大なJSON/テキスト列でレスポンスが肥大化しないよう切り詰める)
export const MAX_CELL_LENGTH = 500;
