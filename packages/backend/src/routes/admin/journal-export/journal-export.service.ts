import { Context } from "hono";
import { JournalExportRepository } from "./journal-export.repository";
import { JournalExportQuery } from "./journal-export.schema";
import { withBom, csvField } from "../../../platform/csv/csv-writer";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { JournalExportFormat, JournalExportColumnKey } from "../journal-export-format/journal-export-format.schema";
import { pairJournalLines } from "../../../platform/journal/pair-journal-lines";

const RESOURCE_KEY = "accounting_journal";

function classifyBatch(batch: { reversalOfBatchId: string | null; correctionOfBatchId: string | null }) {
  if (batch.reversalOfBatchId) return "REVERSAL";
  if (batch.correctionOfBatchId) return "CORRECTION";
  return "ORIGINAL";
}

const CLASSIFICATION_RANK: Record<string, number> = { ORIGINAL: 0, REVERSAL: 1, CORRECTION: 2 };

// Item11-3: 訂正チェーン(元仕訳→反対仕訳→訂正仕訳、訂正仕訳が再訂正された場合はその続き)を
// 連続した行に並べる。グループ同士は先頭バッチ(出力対象内で最も遡れる祖先)の計上日順、
// グループ内は計上日順で、同時刻の場合は元→反対→訂正の順に固定する。
// 期間指定等で祖先が出力対象に含まれない場合は、含まれる中で最上位のバッチを先頭として扱う
export function orderBatchesByCorrectionChain<
  T extends {
    id: string;
    entryDate: unknown;
    reversalOfBatchId: string | null;
    correctionOfBatchId: string | null;
  },
>(batches: T[]): T[] {
  const byId = new Map(batches.map((b) => [b.id, b]));
  const time = (b: T) => new Date(b.entryDate as string).getTime();
  const headOf = (b: T): T => {
    let current = b;
    const seen = new Set<string>();
    while (!seen.has(current.id)) {
      seen.add(current.id);
      const parentId = current.reversalOfBatchId ?? current.correctionOfBatchId;
      const parent = parentId ? byId.get(parentId) : undefined;
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const heads = new Map(batches.map((b) => [b.id, headOf(b)]));

  return [...batches].sort((a, b) => {
    const headA = heads.get(a.id)!;
    const headB = heads.get(b.id)!;
    if (headA.id !== headB.id) {
      return (
        time(headA) - time(headB) ||
        CLASSIFICATION_RANK[classifyBatch(headA)] - CLASSIFICATION_RANK[classifyBatch(headB)] ||
        headA.id.localeCompare(headB.id)
      );
    }
    return (
      time(a) - time(b) ||
      CLASSIFICATION_RANK[classifyBatch(a)] - CLASSIFICATION_RANK[classifyBatch(b)] ||
      a.id.localeCompare(b.id)
    );
  });
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  ORIGINAL: "元仕訳",
  REVERSAL: "反対仕訳",
  CORRECTION: "訂正仕訳",
};

// 会計ソフト側での数値インポートを妨げないよう、数値列はダブルクォートで囲まない
// (数値は区切り文字やダブルクォート自体を含み得ないため、無引用でも安全)
const NUMERIC_COLUMN_KEYS: ReadonlySet<JournalExportColumnKey> = new Set([
  "amount",
  "taxRate",
  "debitAmount",
  "debitTaxRate",
  "creditAmount",
  "creditTaxRate",
]);

// Item11-2: entryDate/postedAtの日付部分をフォーマット設定(YYYY-MM-DD等)に合わせて整形する
function formatDateByPattern(d: unknown, pattern: JournalExportFormat["dateFormat"]): string {
  if (!d) return "";
  const date = new Date(d as string);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  switch (pattern) {
    case "YYYY/MM/DD":
      return `${yyyy}/${mm}/${dd}`;
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD":
    default:
      return `${yyyy}-${mm}-${dd}`;
  }
}

function formatTime(d: unknown): string {
  if (!d) return "";
  const date = new Date(d as string);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mi}:${ss}`;
}

type ExportLine = {
  side: "DEBIT" | "CREDIT";
  accountCode: string;
  accountName: string;
  externalMappingCode: string | null;
  amount: number;
  taxCategoryCode: string | null;
  taxRate: number | null;
  itemId: string | null;
  itemName: string | null;
  sourceRefItemId: string | null;
  memo: string | null;
};

// CSVの1行。layout=LINE は明細1行(借方か貸方の片側)、layout=PAIR は「借方〇〇/貸方〇〇」の組
type ExportRow = {
  batch: {
    id: string;
    entryDate: unknown;
    description: string;
    sourceType: string;
    sourceRefId: string;
    eventType: string;
    projectId: string | null;
    projectName: string | null;
    memo: string | null;
    postedById: string;
    postedAt: unknown;
    reversalOfBatchId: string | null;
    correctionOfBatchId: string | null;
  };
  amount: number;
  // layout=LINE のときだけ(借方・貸方の列は、この行の側だけ値を入れる)
  line: ExportLine | null;
  debit: ExportLine | null;
  credit: ExportLine | null;
  departmentName: string;
};

const numberOrBlank = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

// Item11-1/11-2: 会計ソフト取込用の汎用フォーマットCSV出力(1明細行=1行のフラット形式。V-5で「借方/貸方の組=1行」も選べる)。
// 出力する列・見出し名・区切り文字・日付形式はjournal-export-format(11-2)の設定に従う
export class JournalExportService {
  private repo: JournalExportRepository;

  constructor(repo: JournalExportRepository) {
    this.repo = repo;
  }

  private buildFieldValue(key: JournalExportColumnKey, row: ExportRow, dateFormat: JournalExportFormat["dateFormat"]): string {
    const { batch, line, debit, credit, departmentName } = row;
    // 品目・税区分など、組のどちらかの側にだけある情報(layout=LINE はその行の値)
    const either = <K extends keyof ExportLine>(k: K): ExportLine[K] | null =>
      line ? line[k] : (debit?.[k] ?? credit?.[k] ?? null);
    switch (key) {
      case "batchId":
        return batch.id;
      case "entryDate":
        return formatDateByPattern(batch.entryDate, dateFormat);
      case "description":
        return batch.description;
      case "classification":
        return CLASSIFICATION_LABEL[classifyBatch(batch)];
      case "sourceType":
        return batch.sourceType;
      case "sourceRefId":
        return batch.sourceRefId;
      case "eventType":
        return batch.eventType;
      case "side":
        return line ? (line.side === "DEBIT" ? "借方" : "貸方") : "";
      case "accountCode":
        return line?.accountCode ?? "";
      case "accountName":
        return line?.accountName ?? "";
      case "externalMappingCode":
        return line?.externalMappingCode ?? "";
      case "amount":
        return String(row.amount);
      case "taxCategoryCode":
        return either("taxCategoryCode") ?? "";
      case "taxRate":
        return numberOrBlank(either("taxRate"));
      case "itemId":
        return either("itemId") ?? "";
      case "itemName":
        return either("itemName") ?? "";
      case "sourceRefItemId":
        return either("sourceRefItemId") ?? "";
      case "debitAccountCode":
        return debit?.accountCode ?? "";
      case "debitAccountName":
        return debit?.accountName ?? "";
      case "debitExternalMappingCode":
        return debit?.externalMappingCode ?? "";
      case "debitAmount":
        return debit ? String(row.amount) : "";
      case "debitTaxCategoryCode":
        return debit?.taxCategoryCode ?? "";
      case "debitTaxRate":
        return numberOrBlank(debit?.taxRate);
      case "creditAccountCode":
        return credit?.accountCode ?? "";
      case "creditAccountName":
        return credit?.accountName ?? "";
      case "creditExternalMappingCode":
        return credit?.externalMappingCode ?? "";
      case "creditAmount":
        return credit ? String(row.amount) : "";
      case "creditTaxCategoryCode":
        return credit?.taxCategoryCode ?? "";
      case "creditTaxRate":
        return numberOrBlank(credit?.taxRate);
      case "projectId":
        return batch.projectId ?? "";
      case "projectName":
        return batch.projectName ?? "";
      case "department":
        return departmentName;
      case "lineMemo":
        return either("memo") ?? "";
      case "batchMemo":
        return batch.memo ?? "";
      case "postedById":
        return batch.postedById;
      case "postedAt":
        return `${formatDateByPattern(batch.postedAt, dateFormat)} ${formatTime(batch.postedAt)}`;
      case "originalBatchId":
        return batch.reversalOfBatchId ?? batch.correctionOfBatchId ?? "";
      case "baseSourceRefId":
        return batch.sourceRefId.split("#")[0];
      default:
        return "";
    }
  }

  async exportCsv(c: Context, query: JournalExportQuery, format: JournalExportFormat) {
    const batches = orderBatchesByCorrectionChain(await this.repo.findBatchesForExport(query));
    const lines = await this.repo.findLinesByBatchIds(batches.map((b) => b.id));
    const departmentNameByKey = await this.repo.resolveDepartmentNames(batches);

    const linesByBatchId = new Map<string, typeof lines>();
    for (const line of lines) {
      if (!linesByBatchId.has(line.batchId)) linesByBatchId.set(line.batchId, []);
      linesByBatchId.get(line.batchId)!.push(line);
    }

    const activeColumns = format.columns.filter((col) => col.enabled);

    const csvLines: string[] = [];
    if (format.includeHeaderRow) {
      csvLines.push(activeColumns.map((col) => csvField(col.label)).join(format.delimiter));
    }

    let rowCount = 0;
    for (const batch of batches) {
      const batchLines = linesByBatchId.get(batch.id) ?? [];
      const baseSourceRefId = batch.sourceRefId.split("#")[0];
      const departmentName = departmentNameByKey.get(`${batch.sourceType}::${baseSourceRefId}`) ?? "";

      const rows: ExportRow[] =
        format.layout === "PAIR"
          ? pairJournalLines(batchLines).map((p) => ({
              batch,
              amount: p.amount,
              line: null,
              debit: p.debit,
              credit: p.credit,
              departmentName,
            }))
          : batchLines.map((line) => ({
              batch,
              amount: line.amount,
              line,
              debit: line.side === "DEBIT" ? line : null,
              credit: line.side === "CREDIT" ? line : null,
              departmentName,
            }));

      for (const row of rows) {
        csvLines.push(
          activeColumns
            .map((col) => {
              const value = this.buildFieldValue(col.key, row, format.dateFormat);
              return NUMERIC_COLUMN_KEYS.has(col.key) ? value : csvField(value);
            })
            .join(format.delimiter),
        );
        rowCount++;
      }
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_JOURNAL_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        searchConditions: { ...query },
        batchCount: batches.length,
        lineCount: rowCount,
      }),
    );

    return withBom(csvLines.join("\n"));
  }
}
