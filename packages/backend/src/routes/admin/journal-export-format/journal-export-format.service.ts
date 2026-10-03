import { Context } from "hono";
import { JournalExportFormatRepository } from "./journal-export-format.repository";
import {
  JournalExportFormat,
  JOURNAL_EXPORT_COLUMN_KEYS,
  JOURNAL_EXPORT_OPTIONAL_COLUMN_KEYS,
} from "./journal-export-format.schema";
import { BadRequestError } from "../../../platform/http/http-error";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";

const RESOURCE_KEY = "accounting_journal_export_format";

// Item11-1で固定していた列構成・見出し名をそのまま初期値にする(未設定時は従来と同じ出力になる)
const DEFAULT_LABELS: Record<(typeof JOURNAL_EXPORT_COLUMN_KEYS)[number], string> = {
  batchId: "仕訳バッチID",
  entryDate: "計上日",
  description: "摘要",
  classification: "区分",
  sourceType: "起票元種別",
  sourceRefId: "元伝票番号",
  eventType: "会計事象",
  side: "貸借区分",
  accountCode: "勘定科目コード",
  accountName: "勘定科目名",
  externalMappingCode: "外部マッピングコード",
  amount: "金額",
  taxCategoryCode: "税区分コード",
  taxRate: "税率",
  itemId: "品目ID",
  itemName: "品目名",
  sourceRefItemId: "元伝票明細ID",
  projectId: "プロジェクトID",
  projectName: "プロジェクト名",
  department: "部署",
  lineMemo: "明細メモ",
  batchMemo: "バッチメモ",
  postedById: "起票者",
  postedAt: "起票日時",
  originalBatchId: "訂正元仕訳バッチID",
  baseSourceRefId: "元伝票番号(基底)",
  debitAccountCode: "借方勘定科目コード",
  debitAccountName: "借方勘定科目名",
  debitExternalMappingCode: "借方外部マッピングコード",
  debitAmount: "借方金額",
  debitTaxCategoryCode: "借方税区分コード",
  debitTaxRate: "借方税率",
  creditAccountCode: "貸方勘定科目コード",
  creditAccountName: "貸方勘定科目名",
  creditExternalMappingCode: "貸方外部マッピングコード",
  creditAmount: "貸方金額",
  creditTaxCategoryCode: "貸方税区分コード",
  creditTaxRate: "貸方税率",
};

export const DEFAULT_JOURNAL_EXPORT_FORMAT: JournalExportFormat = {
  columns: JOURNAL_EXPORT_COLUMN_KEYS.map((key) => ({
    key,
    label: DEFAULT_LABELS[key],
    enabled: !JOURNAL_EXPORT_OPTIONAL_COLUMN_KEYS.has(key),
  })),
  delimiter: ",",
  dateFormat: "YYYY-MM-DD",
  includeHeaderRow: true,
  layout: "LINE",
};

export class JournalExportFormatService {
  private repo: JournalExportFormatRepository;

  constructor(env: Env) {
    this.repo = new JournalExportFormatRepository(env);
  }

  async getFormat(): Promise<JournalExportFormat> {
    const kvData = await this.repo.getConfig();
    if (!kvData) return DEFAULT_JOURNAL_EXPORT_FORMAT;
    return this.fillMissingColumns(JSON.parse(kvData) as JournalExportFormat);
  }

  // Item11-3以降に追加された列が保存済みフォーマットに無い場合、末尾に既定OFFで補完する
  // (これをしないと、画面が保存済みの列一覧をそのまま送り返した時にvalidateColumnCoverageで弾かれる)
  private fillMissingColumns(format: JournalExportFormat): JournalExportFormat {
    const present = new Set(format.columns.map((c) => c.key));
    const missing = JOURNAL_EXPORT_COLUMN_KEYS.filter((k) => !present.has(k));
    // V-5より前に保存したフォーマットには layout が無い(従来の1行=片側の形)
    const layout = format.layout ?? "LINE";
    if (missing.length === 0) return { ...format, layout };
    return {
      ...format,
      layout,
      columns: [
        ...format.columns,
        ...missing.map((key) => ({
          key,
          label: DEFAULT_LABELS[key],
          enabled: !JOURNAL_EXPORT_OPTIONAL_COLUMN_KEYS.has(key),
        })),
      ],
    };
  }

  // 保存前に「固定の列キー全てをちょうど1回ずつ含む」ことを検証する(値の型自体はスキーマ側で保証済み)。
  // 列の追加削除は想定しない設計(出力できるデータの種類は固定)のため、ここで弾く
  private validateColumnCoverage(format: JournalExportFormat) {
    const keys = format.columns.map((c) => c.key);
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      throw new BadRequestError("同じ列を複数回指定することはできません");
    }
    const missing = JOURNAL_EXPORT_COLUMN_KEYS.filter((k) => !uniqueKeys.has(k));
    if (missing.length > 0) {
      throw new BadRequestError(`列が不足しています: ${missing.join(", ")}`);
    }
  }

  async updateFormat(c: Context<{ Bindings: Env }>, format: JournalExportFormat) {
    this.validateColumnCoverage(format);

    const oldFormat = await this.getFormat();
    await this.repo.saveConfig(JSON.stringify(format));

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_JOURNAL_EXPORT_FORMAT", RESOURCE_KEY, "GLOBAL_CONFIG", oldFormat, format),
    );

    return { success: true, message: "仕訳CSV出力フォーマットを保存しました" };
  }
}
