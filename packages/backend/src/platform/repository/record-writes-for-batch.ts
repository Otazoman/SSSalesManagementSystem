// BUG-049: リポジトリの書き込み(insert・update・delete)を、その場で実行せずに記録し、commit() で1回の batch にまとめて実行する。
// D1 は db.batch() でまとめた書き込みだけが、途中で失敗した時にまとめて取り消される。
//
// 使い方(伝票の保存など、1つの操作で複数の表に書き込む処理):
//   const tx = recordWritesForBatch(this.repo);
//   await tx.repo.updateQuote(id, {...});      // ← 記録されるだけ(まだ書き込まない)
//   await tx.repo.deleteQuoteItems(id);        // ← 中の select はその場で実行され、delete は記録される
//   await tx.commit();                         // ← ここで1回の batch として書き込む
//
// 注意:
// - 記録中の書き込みは、commit() まで DB に反映されない。記録中に、記録した書き込みの結果を読み取ってはいけない。
// - 書き込みの結果(meta.changes など)は受け取れない(undefined になる)。結果を使う書き込みは記録に含めない。
// - R2 など DB 以外の処理はその場で実行される。消す処理は commit() が成功した後に行う。
// - リポジトリの中で db.batch([...]) を使っている書き込みも、その中身を記録する(記録中は実行しない)。
// - 同じ D1 を使う別のリポジトリの書き込みも、tx.include(otherRepo) で同じ batch に加えられる(在庫の引当など)。

type AnyDb = { batch: (statements: [any, ...any[]]) => Promise<unknown>; [key: string]: any };

const WRITE_METHODS = new Set(["insert", "update", "delete"]);

export function recordWritesForBatch<T extends object>(
  repo: T,
): { repo: T; include: <U extends object>(other: U) => U; commit: () => Promise<void> } {
  const realDb = (repo as unknown as { db: AnyDb }).db;
  if (!realDb) throw new Error("recordWritesForBatch: repository has no db");
  const statements: unknown[] = [];
  const targetOf = new WeakMap<object, unknown>();

  // 書き込みの組み立て(insert(...).values(...).where(...) など)を包み、await された時点で記録する
  const wrap = (builder: any): any => {
    const proxy: any = new Proxy(builder, {
      get(target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => {
            statements.push(target);
            resolve(undefined);
          };
        }
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return result && typeof result === "object" ? wrap(result) : result;
        };
      },
    });
    targetOf.set(proxy, builder);
    return proxy;
  };

  const recordingDbOf = (db: AnyDb) => new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof prop === "string" && WRITE_METHODS.has(prop) && typeof value === "function") {
        return (...args: unknown[]) => wrap(value.apply(target, args));
      }
      if (prop === "batch") {
        return async (list: unknown[]) => {
          for (const item of list) statements.push(targetOf.get(item as object) ?? item);
          return [];
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const recordingRepoOf = <U extends object>(target: U): U => {
    const db = (target as unknown as { db: AnyDb }).db;
    if (!db) throw new Error("recordWritesForBatch: repository has no db");
    const clone = Object.create(Object.getPrototypeOf(target)) as U;
    Object.assign(clone, target, { db: recordingDbOf(db) });
    return clone;
  };

  return {
    repo: recordingRepoOf(repo),
    include: recordingRepoOf,
    async commit() {
      if (statements.length === 0) return;
      await realDb.batch(statements as [unknown, ...unknown[]]);
      statements.length = 0;
    },
  };
}
