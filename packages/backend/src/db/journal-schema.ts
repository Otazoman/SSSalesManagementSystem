import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// 仕訳データ(別DB: DB_JOURNAL側へデプロイする隔離スキーマ)。
// audit-schema.ts(DB_LOG) / otp-schema.ts(DB_OTP)と同じ「隔離スキーマ」方式。
//
// メインDBと分ける理由:
//   仕訳は伝票データとは性格が異なる(訂正ではなく反対仕訳で修正する、会計期間で締める、
//   外部会計ソフトへ引き渡す、保存年限が伝票と異なる)ため、影響範囲と運用を独立させる。
//
// D1はDB跨ぎのFK・JOIN・トランザクションが張れないため、以下の方針を採る:
//   - accounts/tax_categoriesへのFKは張らず、転記時点の値をスナップショット保存する
//     (後日の科目改称・税率改正が過去仕訳を書き換えないため、会計上もこちらが正しい)
//   - メインDB側の伝票更新と同一トランザクションでは書けないため、伝票更新と同じリクエスト内で
//     メインDBへ起票イベント(journal_posting_events)を1行書いたうえで、続けてここへ転記する
//     (2026-09-09ユーザー確認済み: 「同時ではなく、アクションを起こしたタイミングで処理を行う」)。
//   - 転記に失敗した場合、Cron等による自動再試行は行わない(バッチ処理にはしない方針、
//     ユーザー確認済み)。journal_posting_eventsにFAILEDのまま残し、人が再転記操作を
//     行った時(=そのユーザー操作というアクション)にのみ再試行する

// 仕訳バッチ: 1つの会計事象 = 1バッチ。貸借合計が一致する単位。
// 消費税を分けると借方2行・貸方1行のような多行仕訳になるため、
// 単一借方/単一貸方の1行型ではなくヘッダー+明細の複式構造にしている
export const journalBatches = sqliteTable(
  "journal_batches",
  {
    id: text("id").primaryKey(), // UUID
    // 計上日。伝票日付ではなく会計上の認識日(前払なら支払日、仕入なら検収日)
    entryDate: integer("entry_date", { mode: "timestamp" }).notNull(),
    description: text("description").notNull(), // 摘要

    // 転記元のトレーサビリティ。この3つ組が冪等キーになる(二重転記の防止)
    // sourceType: 'purchase_order' | 'sales_order' | 'sales_invoice' | 'purchase_recognition'
    //           | 'payment_receipt'(入金消込) | 'payment_disbursement'(支払消込) 等
    sourceType: text("source_type").notNull(),
    sourceRefId: text("source_ref_id").notNull(), // 元伝票ID(発注番号・受注番号等)
    // eventType: 'PREPAYMENT'(前払) | 'PURCHASE'(仕入計上)
    //          | 'ADVANCE_RECEIPT'(前受) | 'SALES'(売上計上)
    //          | 'RECEIPT'(入金) | 'DISBURSEMENT'(支払)
    eventType: text("event_type").notNull(),

    // 貸借合計。明細から算出できるが、検算と一覧表示のために冗長に保持する
    totalDebitAmount: integer("total_debit_amount").notNull(),
    totalCreditAmount: integer("total_credit_amount").notNull(),

    // 反対仕訳による取消。取消仕訳はこの列に取消対象バッチIDを持つ
    // (仕訳は物理削除・更新をせず、必ず反対仕訳で打ち消す)
    reversalOfBatchId: text("reversal_of_batch_id"),

    // K-6: 訂正仕訳(勘定科目・摘要のみ変更した新バッチ)による連鎖追跡。訂正仕訳はこの列に
    // 訂正対象(元バッチ、または前回の訂正仕訳)のバッチIDを持つ。reversalOfBatchIdとは異なる列
    // にする理由: このバッチ自体は取消(反対仕訳)ではなく新規の正規仕訳のため、意味を混同しない
    correctionOfBatchId: text("correction_of_batch_id"),

    // Item11-1: 仕訳データ出力でのプロジェクト別集計用。勘定科目と同じく転記時点のスナップショット
    // (別DBのためprojects.idへのFKは張れない。後日のプロジェクト名変更・削除で過去仕訳が
    // 書き換わらないようにするため)。ヘッダー(伝票)単位の値のためjournalLinesではなくこちらへ持たせる
    projectId: text("project_id"),
    projectName: text("project_name"),

    memo: text("memo"),
    postedById: text("posted_by_id").notNull(), // employeeNumber(別DBのためFKは張らない)
    postedAt: integer("posted_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // 同じ会計事象を二重に転記しないための冪等キー。
    // 転記処理はこの制約に依存して「既に転記済みなら何もしない」を判定する
    uniqueIndex("journal_batches_source_unique").on(
      table.sourceType,
      table.sourceRefId,
      table.eventType,
    ),
    // 会計期間での締め・出力用
    index("journal_batches_entry_date_idx").on(table.entryDate),
  ],
);

// 仕訳明細: バッチ内の借方行・貸方行。side別に合計するとバッチの貸借合計に一致する
export const journalLines = sqliteTable(
  "journal_lines",
  {
    id: text("id").primaryKey(), // UUID
    batchId: text("batch_id")
      .notNull()
      .references(() => journalBatches.id, { onDelete: "cascade" }), // 同一DB内なのでFKを張れる
    lineNo: integer("line_no").notNull(), // バッチ内の表示順(1始まり)

    // 'DEBIT'(借方) | 'CREDIT'(貸方)
    side: text("side", { enum: ["DEBIT", "CREDIT"] }).notNull(),

    // 勘定科目は転記時点のスナップショット(別DBのためaccounts.codeへのFKは張れない)。
    // externalMappingCodeも併せて写すことで、外部会計ソフト出力を過去分も再現できる
    accountCode: text("account_code").notNull(),
    accountName: text("account_name").notNull(),
    externalMappingCode: text("external_mapping_code"),

    amount: integer("amount").notNull(),

    // 消費税区分も転記時点のスナップショット(税改正で過去仕訳の税率が変わらないため)
    taxCategoryCode: text("tax_category_code"),
    taxRate: real("tax_rate"),

    // 補助情報。品目別の集計や、元伝票明細への遡及に使う
    itemId: text("item_id"),
    itemName: text("item_name"),
    sourceRefItemId: text("source_ref_item_id"), // 元伝票の明細ID

    memo: text("memo"),
  },
  (table) => [index("journal_lines_batch_id_idx").on(table.batchId)],
);
