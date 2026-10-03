// 商談の一括書き込み(CSV取込)が消費するD1の書き込み文数の見積り。
//
// Cloudflare無料プランは「1回のWorker呼び出しあたりD1クエリ50本」で、db.batch()内の各文も
// 1本ずつ数えられる(developers.cloudflare.com/d1/platform/limits、2026-09-21確認)。
// 1文あたりのバインド変数も100個までのため、複数行INSERTは列数に応じた行数に分けて発行する。
// 取込では参照先の検索・採番確認・操作者取得・監査ログで10本前後を使うため、書き込みは30本までに抑える。
// 数値は変わり得るので、変更する際は上記ページを再確認すること。
export const MAX_WRITE_STATEMENTS = 30;

// 1文に詰める行数(バインド変数100個以内): 商談14列・面談者7列・タスク8列・見積紐づけ5列
export const DEALS_PER_STATEMENT = 7;
export const ATTENDEES_PER_STATEMENT = 14;
export const TASKS_PER_STATEMENT = 12;
export const QUOTES_PER_STATEMENT = 20;
// 既存商談の従属行を消すDELETE(dealIdのIN句)は、1文に80件まで
export const DELETE_IDS_PER_STATEMENT = 80;

export interface WriteVolume {
  deals: number;
  /** 既存商談の置き換え件数(従属行のDELETEが必要な商談数) */
  updates: number;
  attendees: number;
  tasks: number;
  quotes: number;
}

const chunks = (count: number, perStatement: number) => Math.ceil(count / perStatement);

export function estimateWriteStatements(v: WriteVolume): number {
  const deletes = v.updates > 0 ? 3 * chunks(v.updates, DELETE_IDS_PER_STATEMENT) : 0;
  return (
    chunks(v.deals, DEALS_PER_STATEMENT) +
    deletes +
    chunks(v.attendees, ATTENDEES_PER_STATEMENT) +
    chunks(v.tasks, TASKS_PER_STATEMENT) +
    chunks(v.quotes, QUOTES_PER_STATEMENT)
  );
}
