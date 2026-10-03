// BUG-028: 出力の時に数式対策で付けた先頭の ' (csv-writer の escapeFormulaCell)を、取込の時に外す。
// ' の次が数式として動く文字(=・+・-・@・タブ・CR)の時だけ外す(「'」で始まる普通の値はそのまま)
const ESCAPED_FORMULA = /^'[=+\-@\t\r]/;
export function unescapeFormulaCell(cell: string): string {
  return ESCAPED_FORMULA.test(cell) ? cell.slice(1) : cell;
}

/**
 * CSVテキストを行×列の二次元配列にパースする。
 * ダブルクォートで囲まれたフィールド内のカンマ・改行を正しく扱い、
 * `""` によるダブルクォートのエスケープも正しく復元する(quotes/unitsで使われていた実装を共通化したもの)。
 * BOM付きテキスト・CRLF/CR混在改行にも対応する。空行はスキップする。
 */
export function parseCsv(csvText: string): string[][] {
  // 先頭のUTF-8 BOM(U+FEFF)を除去する(文字コード比較でチェックし、ソース中にBOM自体を埋め込まない)
  const withoutBom =
    csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  const cleanText = withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const rows: string[][] = [];
  const csvTokenRegex = /"([^"]*(?:""[^"]*)*)"|([^",\n]+)|(?<=,|^)(?=,|$)/g;

  for (const line of cleanText.split("\n")) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let match;
    const lineRegex = new RegExp(csvTokenRegex);
    while ((match = lineRegex.exec(line)) !== null) {
      if (match[1] !== undefined) row.push(unescapeFormulaCell(match[1].replace(/""/g, '"')));
      else if (match[2] !== undefined) row.push(unescapeFormulaCell(match[2]));
      else row.push("");
      if (match.index === lineRegex.lastIndex) lineRegex.lastIndex++;
    }
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

export interface CsvRecord {
  fields: string[];
  /** レコードが始まる物理行番号(1始まり)。引用符内の改行があっても、エラー表示に使える */
  line: number;
}

/**
 * ダブルクォート内の改行を含むCSV(RFC 4180)を、レコード単位でパースする。
 * `parseCsv`は先に行分割するため、改行を含むフィールドを扱えない。メモ等の複数行テキストを
 * 「出力→再取込」する用途向けに追加した(`parseCsv`の挙動は変えていない)。
 * BOM・CRLF/CR改行に対応し、空行はスキップする。引用符が閉じていない場合はErrorを投げる。
 */
export function parseCsvRecords(csvText: string): CsvRecord[] {
  const text = (csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  // フィールドの先頭で開いた引用符のみ「引用符つきフィールド」として扱う(途中の"は文字として残す)
  let fieldStarted = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    fields.push(unescapeFormulaCell(field));
    field = "";
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    // 空行(空のフィールド1つだけ)はレコードとして扱わない
    if (!(fields.length === 1 && fields[0] === "")) records.push({ fields, line: recordLine });
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted && field === "") {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new Error(`CSVの引用符(")が閉じられていません(${recordLine}行目から)`);
  if (field !== "" || fields.length > 0) endRecord();
  return records;
}
