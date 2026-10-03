# DB 構造

> このファイルは `packages/backend/scripts/db-docs/generate-db-docs.mjs` で自動生成しています。直接編集しないでください(更新方法は下の「更新方法」)。

販売管理システムのデータベース(Cloudflare D1)の構造です。性格の違うデータを6つの DB に分けています。
全体の構成は [全体設計](../architecture/overview.md) を参照してください。

## DB の一覧

| バインディング | 本番の DB 名 | 内容 | テーブル数 | 最新の migration |
|---|---|---|---:|---|
| `DB` | `my-erp-db` | 業務データ | 96 | `0094_amazing_blue_blade` |
| `DB_LOG` | `my-erp-log-db` | 監査ログ・メール送信ログ | 2 | `0002_wealthy_smasher` |
| `DB_OTP` | `my-erp-otp-db` | OTP | 1 | `0000_complex_plazm` |
| `DB_JOURNAL` | `my-erp-journal-db` | 仕訳データ | 2 | `0002_lame_piledriver` |
| `DB_DEALS` | `my-erp-deals-db` | 商談 | 6 | `0000_greedy_dust` |
| `DB_UI` | `my-erp-ui-db` | お知らせ・画面説明・表示設定 | 3 | `0000_flashy_nebula` |

> Staging では、`DB` 以外の5つを1つの物理 DB(`my-erp-shared-db-staging`)にまとめています。テーブル名は重複していません。

## 業務の領域ごとのドキュメント

各ドキュメントに、ER 図とテーブル・項目の説明があります。

| 領域 | 内容 | テーブル数 |
|---|---|---:|
| [システム管理](system.md) | ユーザー・部署・ロール・権限と、メール送信・帳票の設定 | 8 |
| [承認ワークフロー](workflow.md) | 承認フロー・承認権限・承認申請と、その履歴 | 6 |
| [業務マスタ](master.md) | 取引先・商品・単位・勘定科目・倉庫・ロケーションなどのマスタ | 23 |
| [販売](sales.md) | 見積・受注・売上・請求・入金 | 18 |
| [購買](purchase.md) | 購買申請・発注・仕入・支払 | 14 |
| [在庫](inventory.md) | 在庫・入出庫・入出荷指示・棚卸・品質区分の変更・廃棄・返品・引当 | 19 |
| [会計(仕訳)](accounting.md) | 仕訳ルール・仕訳の起票イベントと、仕訳データ(DB_JOURNAL) | 6 |
| [進捗管理](progress.md) | 進捗確認の工程の担当と、完了/進行中の手動設定 | 4 |
| [商談](deals.md) | 商談・面談者・タスク・見込み客の担当者(DB_DEALS) | 6 |
| [ログ・OTP・画面表示](logs-otp-ui.md) | 監査ログ・メール送信ログ(DB_LOG)、OTP(DB_OTP)、お知らせ・画面説明・表示設定(DB_UI) | 6 |

## テーブルの索引

| テーブル | 名前 | 領域 | DB |
|---|---|---|---|
| [accounts](master.md#accounts) | 勘定科目 | 業務マスタ | `DB` |
| [announcements](logs-otp-ui.md#announcements) | お知らせ | ログ・OTP・画面表示 | `DB_UI` |
| [approval_authorities](workflow.md#approval_authorities) | 承認権限 | 承認ワークフロー | `DB` |
| [approval_flow_steps](workflow.md#approval_flow_steps) | 承認フローの段 | 承認ワークフロー | `DB` |
| [approval_flows](workflow.md#approval_flows) | 承認フロー | 承認ワークフロー | `DB` |
| [audit_logs](logs-otp-ui.md#audit_logs) | 監査ログ | ログ・OTP・画面表示 | `DB_LOG` |
| [billing_headers](sales.md#billing_headers) | 請求 | 販売 | `DB` |
| [billing_items](sales.md#billing_items) | 請求明細 | 販売 | `DB` |
| [business_locations](master.md#business_locations) | 営業拠点 | 業務マスタ | `DB` |
| [cash_receipt_advance_applications](sales.md#cash_receipt_advance_applications) | 前受金の充当 | 販売 | `DB` |
| [cash_receipts](sales.md#cash_receipts) | 入金(単体) | 販売 | `DB` |
| [deal_attachments](deals.md#deal_attachments) | 商談の添付ファイル | 商談 | `DB_DEALS` |
| [deal_attendees](deals.md#deal_attendees) | 面談者 | 商談 | `DB_DEALS` |
| [deal_quotes](deals.md#deal_quotes) | 商談と見積の紐づけ | 商談 | `DB_DEALS` |
| [deal_tasks](deals.md#deal_tasks) | 商談のタスク | 商談 | `DB_DEALS` |
| [deals](deals.md#deals) | 商談 | 商談 | `DB_DEALS` |
| [departments](system.md#departments) | 部署 | システム管理 | `DB` |
| [document_completion_overrides](progress.md#document_completion_overrides) | 伝票の完了設定 | 進捗管理 | `DB` |
| [item_attachments](master.md#item_attachments) | 商品の添付ファイル | 業務マスタ | `DB` |
| [item_prices](master.md#item_prices) | 商品単価 | 業務マスタ | `DB` |
| [item_receipt_attachments](inventory.md#item_receipt_attachments) | 入庫の添付ファイル | 在庫 | `DB` |
| [item_receipt_headers](inventory.md#item_receipt_headers) | 入庫 | 在庫 | `DB` |
| [item_receipt_instruction_items](inventory.md#item_receipt_instruction_items) | 入荷指示明細 | 在庫 | `DB` |
| [item_receipt_instructions](inventory.md#item_receipt_instructions) | 入荷指示 | 在庫 | `DB` |
| [item_receipt_items](inventory.md#item_receipt_items) | 入庫明細 | 在庫 | `DB` |
| [item_reorder_settings](master.md#item_reorder_settings) | 発注点 | 業務マスタ | `DB` |
| [item_shipment_headers](inventory.md#item_shipment_headers) | 出庫 | 在庫 | `DB` |
| [item_shipment_instruction_items](inventory.md#item_shipment_instruction_items) | 出荷指示明細 | 在庫 | `DB` |
| [item_shipment_instructions](inventory.md#item_shipment_instructions) | 出荷指示 | 在庫 | `DB` |
| [item_shipment_items](inventory.md#item_shipment_items) | 出庫明細 | 在庫 | `DB` |
| [item_stock_reservations](inventory.md#item_stock_reservations) | 在庫の引当(商品単位) | 在庫 | `DB` |
| [item_structures](master.md#item_structures) | 商品構成 | 業務マスタ | `DB` |
| [items](master.md#items) | 商品(品目) | 業務マスタ | `DB` |
| [journal_batches](accounting.md#journal_batches) | 仕訳バッチ | 会計(仕訳) | `DB_JOURNAL` |
| [journal_entries](accounting.md#journal_entries) | 仕訳(旧) | 会計(仕訳) | `DB` |
| [journal_lines](accounting.md#journal_lines) | 仕訳明細 | 会計(仕訳) | `DB_JOURNAL` |
| [journal_posting_events](accounting.md#journal_posting_events) | 仕訳の起票イベント | 会計(仕訳) | `DB` |
| [journal_posting_patterns](accounting.md#journal_posting_patterns) | 仕訳パターン | 会計(仕訳) | `DB` |
| [journal_posting_rules](accounting.md#journal_posting_rules) | 仕訳ルール | 会計(仕訳) | `DB` |
| [locations](master.md#locations) | ロケーション | 業務マスタ | `DB` |
| [mail_delivery_logs](logs-otp-ui.md#mail_delivery_logs) | メール送信ログ・送信待ち | ログ・OTP・画面表示 | `DB_LOG` |
| [mail_template_settings](system.md#mail_template_settings) | メール送信・帳票の設定 | システム管理 | `DB` |
| [master_approval_contexts](workflow.md#master_approval_contexts) | 承認申請の審査情報 | 承認ワークフロー | `DB` |
| [master_approval_requests](workflow.md#master_approval_requests) | 承認申請 | 承認ワークフロー | `DB` |
| [order_attachments](purchase.md#order_attachments) | 発注の添付ファイル | 購買 | `DB` |
| [order_items](purchase.md#order_items) | 発注明細 | 購買 | `DB` |
| [orders](purchase.md#orders) | 発注 | 購買 | `DB` |
| [otp_challenges](logs-otp-ui.md#otp_challenges) | OTP | ログ・OTP・画面表示 | `DB_OTP` |
| [partner_attachments](master.md#partner_attachments) | 取引先の添付ファイル | 業務マスタ | `DB` |
| [partner_bank_accounts](master.md#partner_bank_accounts) | 取引先の振込先口座 | 業務マスタ | `DB` |
| [partner_contact_document_types](master.md#partner_contact_document_types) | 取引先担当者の送付帳票 | 業務マスタ | `DB` |
| [partner_contacts](master.md#partner_contacts) | 取引先担当者 | 業務マスタ | `DB` |
| [partner_delivery_destinations](master.md#partner_delivery_destinations) | 取引先の納品先 | 業務マスタ | `DB` |
| [partners](master.md#partners) | 取引先 | 業務マスタ | `DB` |
| [payment_disbursements](purchase.md#payment_disbursements) | 支払実績(支払の消込) | 購買 | `DB` |
| [payment_header_items](purchase.md#payment_header_items) | 支払明細 | 購買 | `DB` |
| [payment_headers](purchase.md#payment_headers) | 支払 | 購買 | `DB` |
| [payment_receipts](sales.md#payment_receipts) | 入金(請求の消込) | 販売 | `DB` |
| [permissions](system.md#permissions) | 権限 | システム管理 | `DB` |
| [progress_case_assignments](progress.md#progress_case_assignments) | 案件の工程の担当 | 進捗管理 | `DB` |
| [progress_case_stage_overrides](progress.md#progress_case_stage_overrides) | 案件の工程の完了設定 | 進捗管理 | `DB` |
| [progress_stage_owners](progress.md#progress_stage_owners) | 工程の既定の担当 | 進捗管理 | `DB` |
| [projects](master.md#projects) | プロジェクト | 業務マスタ | `DB` |
| [prospect_contacts](deals.md#prospect_contacts) | 見込み客の担当者 | 商談 | `DB_DEALS` |
| [purchase_recognition_attachments](purchase.md#purchase_recognition_attachments) | 仕入の添付ファイル | 購買 | `DB` |
| [purchase_recognition_history_logs](purchase.md#purchase_recognition_history_logs) | 仕入の変更履歴 | 購買 | `DB` |
| [purchase_recognition_items](purchase.md#purchase_recognition_items) | 仕入明細 | 購買 | `DB` |
| [purchase_recognition_receipts](purchase.md#purchase_recognition_receipts) | 仕入と検収の紐づけ | 購買 | `DB` |
| [purchase_recognitions](purchase.md#purchase_recognitions) | 仕入 | 購買 | `DB` |
| [purchase_request_attachments](purchase.md#purchase_request_attachments) | 購買申請の添付ファイル | 購買 | `DB` |
| [purchase_request_items](purchase.md#purchase_request_items) | 購買申請明細 | 購買 | `DB` |
| [purchase_requests](purchase.md#purchase_requests) | 購買申請 | 購買 | `DB` |
| [quote_attachments](sales.md#quote_attachments) | 見積の添付ファイル | 販売 | `DB` |
| [quote_history_logs](sales.md#quote_history_logs) | 見積の変更履歴 | 販売 | `DB` |
| [quote_items](sales.md#quote_items) | 見積明細 | 販売 | `DB` |
| [quotes](sales.md#quotes) | 見積 | 販売 | `DB` |
| [receipt_instruction_attachments](inventory.md#receipt_instruction_attachments) | 入荷指示書 | 在庫 | `DB` |
| [role_permissions](system.md#role_permissions) | ロールの権限 | システム管理 | `DB` |
| [roles](system.md#roles) | ロール | システム管理 | `DB` |
| [sales_invoice_attachments](sales.md#sales_invoice_attachments) | 売上の添付ファイル | 販売 | `DB` |
| [sales_invoice_history_logs](sales.md#sales_invoice_history_logs) | 売上の変更履歴 | 販売 | `DB` |
| [sales_invoice_items](sales.md#sales_invoice_items) | 売上明細 | 販売 | `DB` |
| [sales_invoices](sales.md#sales_invoices) | 売上 | 販売 | `DB` |
| [sales_order_attachments](sales.md#sales_order_attachments) | 受注の添付ファイル | 販売 | `DB` |
| [sales_order_history_logs](sales.md#sales_order_history_logs) | 受注の変更履歴 | 販売 | `DB` |
| [sales_order_item_reservations](sales.md#sales_order_item_reservations) | 受注明細の引当実績 | 販売 | `DB` |
| [sales_order_items](sales.md#sales_order_items) | 受注明細 | 販売 | `DB` |
| [sales_orders](sales.md#sales_orders) | 受注 | 販売 | `DB` |
| [screen_descriptions](logs-otp-ui.md#screen_descriptions) | 画面説明 | ログ・OTP・画面表示 | `DB_UI` |
| [shipment_instruction_attachments](inventory.md#shipment_instruction_attachments) | 出荷指示書 | 在庫 | `DB` |
| [stock_audits](inventory.md#stock_audits) | 棚卸 | 在庫 | `DB` |
| [stock_disposals](inventory.md#stock_disposals) | 廃棄 | 在庫 | `DB` |
| [stock_reclassifications](inventory.md#stock_reclassifications) | 品質区分の変更 | 在庫 | `DB` |
| [stock_returns](inventory.md#stock_returns) | 返品 | 在庫 | `DB` |
| [stock_transactions](inventory.md#stock_transactions) | 在庫の増減履歴 | 在庫 | `DB` |
| [stocks](inventory.md#stocks) | 在庫 | 在庫 | `DB` |
| [tax_categories](master.md#tax_categories) | 消費税区分 | 業務マスタ | `DB` |
| [unit_conversions](master.md#unit_conversions) | 単位の換算 | 業務マスタ | `DB` |
| [units](master.md#units) | 単位 | 業務マスタ | `DB` |
| [user_login_states](system.md#user_login_states) | ログインの状態 | システム管理 | `DB` |
| [user_preferences](logs-otp-ui.md#user_preferences) | ユーザーの表示設定 | ログ・OTP・画面表示 | `DB_UI` |
| [user_roles](system.md#user_roles) | ユーザーの所属 | システム管理 | `DB` |
| [users](system.md#users) | ユーザー | システム管理 | `DB` |
| [warehouse_attachments](master.md#warehouse_attachments) | 倉庫の添付ファイル | 業務マスタ | `DB` |
| [warehouse_available_days](master.md#warehouse_available_days) | 倉庫の稼働日 | 業務マスタ | `DB` |
| [warehouse_contact_document_types](master.md#warehouse_contact_document_types) | 倉庫担当者の送付帳票 | 業務マスタ | `DB` |
| [warehouse_contacts](master.md#warehouse_contacts) | 倉庫担当者 | 業務マスタ | `DB` |
| [warehouse_stock_reservations](inventory.md#warehouse_stock_reservations) | 在庫の引当(倉庫単位) | 在庫 | `DB` |
| [warehouses](master.md#warehouses) | 倉庫 | 業務マスタ | `DB` |
| [workflow_logs](workflow.md#workflow_logs) | 承認の履歴 | 承認ワークフロー | `DB` |

## 共通のきまり

- **日時**は Unix 時刻(秒)の整数で保存しています(Drizzle の `mode: "timestamp"`)。表の型が「日時」の項目です。
- **真偽値**は 0 / 1 の整数で保存しています(Drizzle の `mode: "boolean"`)。
- **作成者・更新者**(`created_by`・`updated_by`)は、多くのテーブルで従業員番号を保存しています。
- **状態**(`status`)は、マスタでは `temporary`(仮登録)・`active`(有効)・`suspended`(無効)、伝票では `UNAPPROVED`(承認申請中)・`APPROVED`(承認済み)・`REMANDED`(差戻し)などを使います。
- **添付ファイル**の実体は R2 に保存し、テーブルには保存先のキー(`*_r2_path`)を持ちます。
- 別の DB にあるテーブル(例: 商談から見積)への参照には、外部キーを付けていません。

## 更新方法

DB のスキーマ(`packages/backend/src/db/`)を変更し、migration を生成した後に、次のコマンドでこのドキュメントを作り直します。

```bash
# リポジトリのルートで
node packages/backend/scripts/db-docs/generate-db-docs.mjs          # docs/database/ を作り直す
node packages/backend/scripts/db-docs/generate-db-docs.mjs --check  # 最新かどうかの確認だけ
```

- テーブルを追加したときは、`packages/backend/scripts/db-docs/catalog.mjs` の `TABLES` に、日本語名・説明・領域を1行追加します(無いとエラーになります)。
- 項目の説明は、スキーマのソースで項目の直前(または同じ行)に書いたコメントが使われます。コメントが無い項目は、`catalog.mjs` の `COLUMN_DICTIONARY` の共通の説明が使われます。
- スクリプトのテスト: `node --test packages/backend/scripts/db-docs/generate-db-docs.test.mjs`
