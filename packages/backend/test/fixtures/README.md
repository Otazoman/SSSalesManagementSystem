# テストデータ(CSVフィクスチャ)

テストの前提データをCSVで用意する仕組みです。業務担当者もExcel等で編集できます。データの種類で置き場所が2つあります。

| 種類 | 置き場所 | 投入方法 |
|---|---|---|
| ユーザー・ロール・部署・承認フローなど(画面のCSV取込が無いもの) | `test/fixtures/<シナリオ名>/<テーブル名>.csv`(このフォルダ) | `seedFixtures(db, "<シナリオ名>")`(DBへ直接INSERT。速い) |
| 取引先・商品・単位・倉庫・見積・受注など(画面のCSV取込があるもの) | リポジトリ直下の `sampledata/`(画面の取込と同じ形式) | `await importSampleCsv("partners_import_sample.csv")`(本番と同じ取込APIを通す) |

## どちらを使うか(書き分けのルール)
- **全ケースで同じ固定の前提データ**(例: 申請者・承認者・承認フロー一式) → CSV(シナリオ or `importSampleCsv`)。
- **そのテストの検証対象になる値**(例: 承認フローの金額レンジ・ステップ構成、取引先の与信限度額) → テスト内のコードで指定する。CSVに移すと、何を検証しているかがテストから読み取れなくなる。
- 迷ったら、まず共有セットだけCSVにして、ケースごとの差は `overrides` かコードで足す。既存テストを一括で置き換えることはしない(触るテストから順に)。

## 1. このフォルダのCSV(`seedFixtures`)

- ファイル名 = DBテーブル名(例: `user_roles.csv`)。
- ヘッダーは**日本語名でも英字(Drizzleのプロパティ名)でも書ける**(混在可)。日本語名の一覧は `test/support/fixtures.ts` の `FIXTURE_LABELS`。
  例: `社員番号` = `employeeNumber`、`有効` = `isActive`。同じ列を両方の名前で書くとエラー。
- 値の書き方
  - 真偽値: `はい` / `いいえ`(`true` / `false`、`1` / `0` も可)
  - 日時: `2026-01-01` または `2026-01-01T09:00:00Z`(ISO8601)
  - 空欄 = 未指定(DBの既定値、無ければNULL)。必須列が空欄だと「ファイル名:行番号」つきでエラーになる
- 対応テーブルと投入順(親→子)は `fixtures.ts` の `FIXTURE_TABLES`。テーブルを増やす時はここと `FIXTURE_LABELS` に追加する。
- 1つのテストだけ値を変えたい時は、CSVを書き換えず `seedFixtures(db, name, { overrides })` で行を加工する。
  例: `overrides: { approval_flows: (rows) => rows.map((r) => ({ ...r, maxAmount: 500 })) }`
- 実在の会社・個人の情報、パスワードのハッシュ等の秘密は入れない。
- Excelで編集する場合: 保存は「CSV UTF-8」。先頭が0の値(社員番号など)が消えないよう、列を文字列にする。
- `test/fixtures-consistency.test.ts` が、全CSVのヘッダー・型・外部キーを検証する(schemaが変わって古くなると失敗する)。

### シナリオ
| 名前 | 内容 | 使うテスト |
|---|---|---|
| `inventory-approval` | 申請者`applicant-1`・承認者`approver-1`(ロール`approver_role`)、承認フロー2本(`inventory_stock` / `inventory_audit`、金額0〜999,999,999、1段) | 在庫の承認ワークフロー(`inventory/*/*-workflow-lifecycle.test.ts` 5本) |

## 2. sampledata/ のCSV(`importSampleCsv`)

- `test/support/csv-import.ts`。CSVごとの取込先は `IMPORT_ENDPOINTS`(E2Eで同じCSVを取り込む時の対応表にもなる)。
- 取込に失敗した時や、一部の行が黙って読み飛ばされた時は**例外**にする(前提データの失敗に気付かず後続のテストが進むのを防ぐ)。
- 前提の順序(単位→勘定科目→…)は `sampledata/README.md` の推奨取込順。全CSVの取込と内容は `test/sampledata-import.test.ts` が検証する。
- `sampledata/` の編集には明示的な指示が必要(CLAUDE.md #7)。テスト専用のデータが必要な場合は、`sampledata/` を書き換えず、このフォルダのシナリオにする(対応テーブルの追加は上記 `FIXTURE_TABLES`)。
