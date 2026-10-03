// Drizzle のスキーマ定義(TypeScript のソース)から、テーブル・項目のコメントと項目の種類(日時・真偽値など)を読み取る。
// TypeScript を実行せずにテキストとして解析する(スナップショットには無い「説明」と「mode」を補うためだけに使う)。

/** 文字列・コメントを飛ばしながら、text[openIndex] の "{" に対応する "}" の位置を返す。見つからなければ -1 */
export function findMatchingBrace(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// コメントの先頭に付いている作業履歴の札(「Item9 Phase5:」「追加要望L-3-a:」「新規要望(2026-09-23):」「#14-2①:」など)
const HISTORY_TAG = /^(?:[^:：。、]{0,40}?(?:Item\s*\d|要望|Phase|#\d|\b[A-Z]{1,2}-\d|\d{4}-\d{2}-\d{2}|フォローアップ|残課題)[^:：。]{0,40}[:：])\s*/;
// 文中の確認履歴の括弧書き(「(2026-08-13ユーザー確認済み)」など)
const HISTORY_PAREN = /[(（][^()（）]*(?:\d{4}-\d{2}-\d{2}|ユーザー(?:確認|指示|決定|許可)|確認済み)[^()（）]*[)）]/g;

/** コメントから作業履歴の札・確認履歴を取り除き、説明として読みやすい形(最大2文)にする */
export function cleanComment(raw) {
  let text = raw.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3 && HISTORY_TAG.test(text); i++) text = text.replace(HISTORY_TAG, "");
  text = text.replace(HISTORY_PAREN, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentences = text.match(/[^。]+。?/g) ?? [text];
  let result = sentences.slice(0, 2).join("");
  if (result.length > 160) result = `${result.slice(0, 157)}…`;
  return result.replace(/\|/g, "／");
}

/** 行末の // コメント(文字列の中の // は除く)。無ければ空文字 */
export function trailingComment(line) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < line.length && line[i] !== ch; i++) if (line[i] === "\\") i++;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") return line.slice(i + 2).trim();
  }
  return "";
}

// 改行を LF にそろえる。Windows で Git が CRLF で取り出したソースでは、行末の "\r" のせいで
// コメント行の判定(/^\s*\/\/\s?(.*)$/ の "." は "\r" に一致しない)が外れ、説明が落ちるため
const toLf = (source) => source.replace(/\r\n?/g, "\n");

/** 直前の連続した // コメント行を取り出す(空行・コメント以外の行で止まる) */
function precedingComments(lines, index) {
  const out = [];
  for (let i = index - 1; i >= 0; i--) {
    const m = /^\s*\/\/\s?(.*)$/.exec(lines[i]);
    if (!m) break;
    out.unshift(m[1]);
  }
  return out.join(" ");
}

/**
 * 共通定義のヘルパー(例: withAuditColumns() の created_at)から、項目名 → mode("timestamp" など)を返す。
 * テーブルの定義の中で展開(...withAuditColumns())される項目は parseSchemaSource では読めないため、これで補う
 */
export function parseHelperModes(rawSource) {
  const source = toLf(rawSource);
  const modes = {};
  const pattern = /[A-Za-z0-9_]+\s*:\s*[A-Za-z]+\(\s*"([A-Za-z0-9_]+)"\s*,\s*\{[^}]*mode:\s*"([a-z_]+)"/g;
  let match;
  while ((match = pattern.exec(source))) modes[match[1]] = match[2];
  return modes;
}

/**
 * スキーマのソースから、テーブルごとの { comment, columns: { 列名: { comment, mode } } } を返す。
 * 列名は DB 上の名前(例: created_at)。
 */
export function parseSchemaSource(rawSource) {
  const source = toLf(rawSource);
  const tables = {};
  const tablePattern = /sqliteTable\(\s*"([A-Za-z0-9_]+)"\s*,\s*\{/g;
  let match;
  while ((match = tablePattern.exec(source))) {
    const tableName = match[1];
    const openIndex = source.indexOf("{", match.index + match[0].length - 1);
    const closeIndex = findMatchingBrace(source, openIndex);
    if (closeIndex < 0) continue;

    // テーブルのコメント: "export const xxx = sqliteTable(" の行の直前のコメント
    const before = source.slice(0, match.index);
    const beforeLines = before.split("\n");
    const tableComment = precedingComments(beforeLines, beforeLines.length - 1);

    const bodyLines = source.slice(openIndex + 1, closeIndex).split("\n");
    const columns = {};
    let pending = [];
    for (const line of bodyLines) {
      const comment = /^\s*\/\/\s?(.*)$/.exec(line);
      if (comment) {
        pending.push(comment[1]);
        continue;
      }
      const column = /^\s*[A-Za-z0-9_]+\s*:\s*[A-Za-z]+\(\s*"([A-Za-z0-9_]+)"/.exec(line);
      if (column) {
        const trailing = trailingComment(line);
        const mode = /mode:\s*"([a-z]+)"/.exec(line)?.[1] ?? null;
        columns[column[1]] = {
          comment: cleanComment([...pending, trailing].join(" ")),
          mode,
        };
        pending = [];
      } else if (line.trim() === "") {
        pending = [];
      }
    }
    tables[tableName] = { comment: cleanComment(tableComment), columns };
  }
  return tables;
}
