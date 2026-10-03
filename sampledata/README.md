# sampledata(取込用サンプルCSV)

各画面のCSV一括取込に使えるサンプルデータです。**全て架空のデータ**で、実在の企業・個人・住所・電話番号・法人番号とは関係ありません
(社名は「サンプル〇〇」、メールは `example.com`、電話番号は局番 `0000`、郵便番号は `000-0000` 台、
適格請求書発行事業者番号・法人番号は先頭が `0` の実在しない番号)。

- 全ファイルが同じマスタ(取引先・品目・倉庫・社員など)を参照しており、**下の順に取り込む**と、ID・金額・数量が矛盾なく揃います。
- 文字コードは UTF-8(BOM付き)、改行は CRLF、全項目を二重引用符で囲んでいます(Excelで開いて保存し直しても取込できます)。
- **CSVは `generate_sampledata.py` から生成しています**(`python sampledata/generate_sampledata.py`。標準ライブラリのみで動作)。
  内容を変えるときはCSVを直接編集せず、このスクリプトのデータ定義を直して再生成してください
  (全ファイルが同じマスタを参照するため、ID・金額・数量の整合をスクリプトで保っています。権限CSVは画面マスタ `screens.ts` から作るため、画面の追加・削除時も再生成が必要です)。
- `packages/backend/test/sampledata-import.test.ts` が、このフォルダの全CSVを下の順に実際のAPIで取り込み、
  取込後の在庫数量・伝票の状態・消込状況まで確認しています(`npm test`)。CSVを追加・変更したら、このテストも更新してください。

## 前提(サンプルに含まれないもの)
- **システム管理者**と、**標準権限枠**(画面 × 5操作)は、初期セットアップ/権限管理画面で作成済みであること。
- **税区分マスタ**(`TAX_10` / `TAX_8_REDUCED` / `TAX_EXEMPT` / `TAX_VARIABLE`)は、マイグレーションで初期投入されるため取込は不要です(CSV取込の機能もありません)。

## 取込順

| 順 | ファイル | 取込先 | 内容・注意 |
|---|---|---|---|
| 1 | `units_import_sample.csv` | 単位マスタ | 個・KG・セットなど10件 |
| 2 | `accounts_import_sample.csv` | 勘定科目マスタ | 17件(利用停止の科目を1件含む) |
| 3 | `departments_import.csv` | 部署マスタ | 11件(親子関係、有効期間が終了した部署を1件含む) |
| 4 | `roles_import.csv` | ロール管理 | 8件 |
| 5 | `role_permissions_import_sample.csv` | 権限管理(ロール×権限) | ロールごとの権限。事前に標準権限枠が必要 |
| 6 | `users_import.csv` | ユーザー管理 | 12名(兼務=同じ社員番号の2行目を1名含む)。初期パスワードは全員 `Sample#2026` |
| 7 | `warehouses_import_sample.csv` | 倉庫マスタ | 自社2・外部委託1・利用停止1 |
| 8 | `locations_import_sample.csv` | ロケーションマスタ | 倉庫ごとの棚 |
| 9 | `partners_import_sample.csv` | 取引先マスタ | 得意先5・仕入先5・兼用1・見込み客2(適格請求書番号・法人番号の列つき) |
| 10 | `partner_contacts_import_sample.csv` | 取引先担当者マスタ | 見込み客の担当者も含む(商談の面談者に使う) |
| 11 | `projects_import_sample.csv` | プロジェクトマスタ | 4件 |
| 12 | `products_import_sample.csv` | 商品マスタ | 原材料・部品・製品・商品・サービス13件(標準単価も同時に作られる) |
| 13 | `product_prices_import_sample.csv` | 商品単価マスタ | 得意先別・数量別の販売単価、仕入先別の仕入単価 |
| 14 | `products_bom_import_sample.csv` | 部品構成(BOM)マスタ | 製品の構成 |
| 15 | `item_reorder_settings_import_sample.csv` | 発注点・安全在庫 | |
| 16 | `approval_flows_import_sample.csv` | 承認フロー | 上記のロール・部署を使う |
| 17 | `stock_receipts_import_sample.csv` | 入庫 | 在庫の元になる(入荷・完成品) |
| 18 | `stock_shipments_import_sample.csv` | 出庫 | 入庫した在庫から出す |
| 19 | `stock_audits_import_sample.csv` | 棚卸 | 差異のある行を1件含む |
| 20 | `stock_disposals_import_sample.csv` | 廃棄 | |
| 21 | `stock_returns_import_sample.csv` | 返品 | 仕入先へ返品・得意先から返品受入 |
| 22 | `quotes_import_sample.csv` | 見積 | 5件(見込み客宛てを含む) |
| 23 | `sales_orders_import_sample.csv` | 受注 | 見積からの受注3件・直接受注1件。承認済みの受注は在庫を引き当てるため、入庫より後に取り込む |
| 24 | `sales_invoices_import_sample.csv` | 売上 | 通常・分納・値引(赤伝)・下書き |
| 25 | `billing_import_sample.csv` | 請求 | 請求済みの売上を束ねる |
| 26 | `billing_payment_receipts_import_sample.csv` | 請求の入金(消込) | 入金の記録を追加する取込。**同じファイルを2回取り込むとエラー**(既存と同じ入金・CSV内の重複・存在しない請求・不正な日付/金額があれば、1件も登録しない) |
| 27 | `purchase_requisitions_import_sample.csv` | 購買申請 | 通常・前払 |
| 28 | `purchase_orders_import_sample.csv` | 発注 | 購買申請経由・直接・前払・下書き |
| 29 | `purchase_recognitions_import_sample.csv` | 仕入 | 通常・返品(赤伝)・下書き |
| 30 | `purchase_payments_import_sample.csv` | 支払 | 仕入を束ねる |
| 31 | `purchase_payment_disbursements_import_sample.csv` | 支払の消込 | 支払消込の記録を追加する取込。**同じファイルを2回取り込むとエラー**(入金消込と同じ検証) |
| 32 | `sales_deals_import_sample.csv` | 商談管理 | 1商談を複数行で表現(詳しくは商談画面の「CSVインポートの書き方」)。面談者は取引先担当者・社員・自由記入 |
| 33 | `progress_stage_owners_import_sample.csv` | 進捗確認:工程ごとの担当設定 | 全12工程。部門+ロール(`DEPT_ROLE`)は**部署コード**(部署マスタのid)で `0041:manager` のように指定します(内部IDも可) |

## 補足
- **在庫系のCSV(入庫・出庫・棚卸・廃棄・返品)は、取り込むたびに新しい伝票・在庫移動として登録されます**(エラーにはならない)。
  同じファイルを何度も取り込むと在庫数量が重複して増減するため、取り込み直す場合は先にデータを初期化してください。
- 伝票の金額(合計・消費税)は、明細から計算した値を入れています(税率ごとに小計から消費税を切り捨て)。
- 承認申請中(`PENDING_APPROVAL`)の伝票は、承認ワークフローの申請データが伴わないと処理が止まるため、サンプルには含めていません
  (下書き `DRAFT` と承認済み `APPROVED` のみ)。
- 見込客用の担当者(商談画面でその場で登録するもの)はCSV取込の対象外です。サンプルの商談は、取引先担当者マスタに登録した担当者を面談者にしています。
