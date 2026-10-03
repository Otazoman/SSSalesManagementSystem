/**
 * 業務エラー(利用者に理由を伝えるエラー)の統一表現。
 * 投げると、ルーターの respondError(error-handler.ts)が、そのステータスと`{ success: false, message }`で返す
 * (BUG-041。ルールは docs/architecture/backend.md の「4-1. エラー処理のルール」)。
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, code?: string) {
    super(400, message, code);
    this.name = "BadRequestError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string, code?: string) {
    super(404, message, code);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, code?: string) {
    super(409, message, code);
    this.name = "ConflictError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string, code?: string) {
    super(403, message, code);
    this.name = "ForbiddenError";
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

/**
 * SQLite/D1のFOREIGN KEY制約違反かどうかを判定する。
 * 既存実装では accounts.service.ts / units.service.ts / partners/index.ts / partner-contacts/index.ts /
 * roles.service.ts 等、少なくとも6箇所でそれぞれ微妙に異なる部分文字列(CONSTRAINT/foreign/FOREIGN_KEY、
 * 大小文字混在)による判定が個別実装されている。判定条件をここに集約する。
 *
 * Drizzleの`DrizzleQueryError`はメッセージを "Failed query: ..." に差し替え、実際のドライバの
 * エラー内容(例: "FOREIGN KEY constraint failed")は `.cause` 側に格納する。そのため message だけでなく
 * `.cause` チェーンも辿って判定する(最大5階層。循環参照時の無限ループ防止のため上限を設ける)。
 */
export function isForeignKeyConstraintError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const raw = current instanceof Error ? current.message : String(current);
    const lower = raw.toLowerCase();
    if (
      lower.includes("constraint") ||
      lower.includes("foreign key") ||
      lower.includes("foreign_key")
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}
