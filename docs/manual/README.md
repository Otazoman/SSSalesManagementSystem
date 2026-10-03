# 使用マニュアル

販売管理システムの画面の使い方です。画面のキャプチャは、架空のサンプルデータ(「株式会社サンプル商事」)で撮影しています。
カテゴリは、画面の左側のメニューの見出しと同じです。

- **対象**: 「全員」= 権限があれば誰でも使う画面、「管理者」= システム管理者(ロール `admin`)向けの画面

## はじめに

| ページ | 内容 | 対象 |
|---|---|---|
| [ログイン・ログアウト・パスワード](basics/login.md) | ログイン、パスワードを忘れた場合、ログアウト、最初の管理者の作成 | 全員 |
| [画面の見方](basics/screen-layout.md) | ダッシュボード、メニュー、スマートフォンでの使い方、プロフィール(通知・表示の設定) | 全員 |
| [共通の操作](basics/common-operations.md) | 一覧の絞り込み・検索・並び替え、登録・変更・無効化、CSV の取込・出力、承認機能、添付ファイル | 全員 |

## 申請・承認

| 画面 | 内容 | 対象 |
|---|---|---|
| [申請から承認までの流れ](workflow/approval-flow.md) | 申請 → 承認・差戻し → 再申請の流れ(見積の例、実際の操作の画面付き) | 全員 |
| [承認タスク管理(未処理・判定)](workflow/tasks.md) | 自分が承認する申請の承認・差戻し、一括承認 | 全員 |
| [申請履歴・進捗一覧](workflow/histories.md) | 自分が出した申請の状況 | 全員 |

## 日常業務

| 画面 | 内容 | 対象 |
|---|---|---|
| [進捗確認(見積〜支払)](sales/progress.md) | 案件ごとの、見積から支払までの進み具合 | 全員 |
| [商談管理](sales/deals.md) | 見込み客・得意先との商談の記録、次のタスク | 全員 |
| [見積管理](sales/quotes.md) | 見積の作成、見積書の PDF・メール送信 | 全員 |
| [受注管理](sales/orders.md) | 受注の登録、在庫の引当、注文請書 | 全員 |
| [売上管理](sales/invoices.md) | 売上の計上、赤伝(返品・値引) | 全員 |
| [出荷](inventory/shipping.md) | 出荷指示、出庫(スマートフォンでのスキャン)、納品書 | 全員 |
| [請求管理](sales/billing.md) | 請求書の作成、入金の消込 | 全員 |
| [購買申請](purchase/requisitions.md) | 購買の申請 | 全員 |
| [発注管理](purchase/orders.md) | 発注、発注書の PDF・メール送信 | 全員 |
| [入荷](inventory/receiving.md) | 入荷指示、入庫(スマートフォンでのスキャン)、検収書 | 全員 |
| [仕入管理](purchase/receipts.md) | 仕入の計上 | 全員 |
| [支払管理](purchase/payment.md) | 支払の作成、支払の消込、振込ファイル | 全員 |
| [在庫・棚卸管理](inventory/audit.md) | 在庫の照会、棚卸、品質区分の変更、廃棄、返品 | 全員 |

## 経理・統制

| 画面 | 内容 | 対象 |
|---|---|---|
| [仕訳データ出力](accounting/journal.md) | 伝票から作った仕訳の確認と、会計ソフト向けの出力 | 全員 |
| [仕訳ルールマスタ](accounting/journal-rules.md) | 取引ごとに使う勘定科目の設定 | 全員 |
| [仕訳CSV出力フォーマット設定](accounting/journal-export-format.md) | 会計ソフトに合わせた出力の形式 | 全員 |
| [仕訳編集](accounting/journal-edit.md) | 仕訳の訂正 | 全員 |

## 業務マスタ設定

| 画面 | 内容 | 対象 |
|---|---|---|
| [取引先マスタ](master/partners.md) | 得意先・仕入先・見込み客、決済条件、振込先口座、納品先 | 全員 |
| [取引先担当者マスタ](master/partner-contacts.md) | 取引先の担当者と、メールで送る帳票 | 全員 |
| [品目マスタ](master/products.md) | 商品・製品・原材料・部品・サービス、標準単価、バーコードのラベル | 全員 |
| [品目単価マスタ](master/product-prices.md) | 取引先別・数量別の単価(特価) | 全員 |
| [品目構成マスタ](master/product-structures.md) | 製品の部品構成(BOM)と積算原価 | 全員 |
| [単位マスタ](master/units.md) | 個・kg・箱などの単位 | 全員 |
| [勘定科目マスタ](master/accounts.md) | 勘定科目と、会計ソフト側のコード | 全員 |
| [倉庫マスタ](master/warehouses.md) | 自社倉庫・外部倉庫、外部倉庫の担当者 | 全員 |
| [ロケーションマスタ](master/locations.md) | 倉庫の中の棚・区画、QR コードのラベル | 全員 |
| [プロジェクトマスタ](master/projects.md) | 案件・プロジェクト | 全員 |
| [営業拠点マスタ](master/business-locations.md) | 本社・支店などの拠点(発注の納品場所) | 全員 |
| [発注点/安全在庫マスタ](master/item-reorder-settings.md) | 品目 × 倉庫ごとの発注点・安全在庫 | 全員 |

## 基本マスタ設定(システム管理)

| 画面 | 内容 | 対象 |
|---|---|---|
| [会社・システム設定](admin/company-settings.md) | 会社名・帳票の自社情報、承認機能・監査ログの有効/無効など | 管理者 |
| [メール送信設定](admin/mail-settings.md) | 帳票ごとのメールの件名・本文、帳票テンプレート、フォント・ロゴ・印影 | 管理者 |
| [R2ファイル管理](admin/r2-explorer.md) | 保存されているファイルの参照 | 管理者 |
| [システムからのお知らせ管理](admin/announcements.md) | ダッシュボードのお知らせ | 管理者 |
| [進捗確認: 工程ごとの担当設定](admin/progress-stage-owners.md) | 進捗確認の工程の担当 | 管理者 |
| [D1データ参照・編集](admin/d1-explorer.md) | DB のデータの参照・編集 | 管理者 |
| [ユーザー管理](admin/users.md) | ユーザーの登録、部署・ロールの割り当て | 管理者 |
| [画面・権限マスタ](admin/permissions.md) | ロールごとの画面・操作の権限 | 管理者 |
| [組織・部署マスタ](admin/departments.md) | 部署と上下関係 | 管理者 |
| [役職・ロールマスタ](admin/roles.md) | ロール | 管理者 |
| [承認フロー定義](admin/approval-flows.md) | 申請の種類・金額ごとの承認経路、申請経路のプレビュー | 管理者 |
| [消費税マスタ](admin/tax-categories.md) | 消費税の区分と税率 | 管理者 |

## ログ

| 画面 | 内容 | 対象 |
|---|---|---|
| [操作ログ](logs/audit-logs.md) | 登録・更新・削除などの操作の記録 | 管理者 |
| [メール送信履歴ログ](logs/mail-logs.md) | メール・Slack の送信結果 | 管理者 |
| [OTPダウンロードログ](logs/otp-logs.md) | 取引先向けダウンロードの記録 | 管理者 |

## 取引先・外部倉庫の方向け

| 画面 | 内容 | 対象 |
|---|---|---|
| [書類のダウンロード(OTP)](external/document-download.md) | メールで届いたリンクから、確認コードを入れて書類をダウンロードする | 取引先・外部倉庫 |

## マニュアルの作り方(開発者向け)

キャプチャは、Playwright のスクリプトで撮影しています。画面を変えたら撮り直してください。

```bash
# リポジトリのルートで(撮影先は既定で Staging。ログイン情報はルートの .env の MANUAL_USER・MANUAL_PASSWORD)
node packages/frontend/scripts/manual-capture/capture.mjs            # すべて撮影
node packages/frontend/scripts/manual-capture/capture.mjs master     # カテゴリを指定
node packages/frontend/scripts/manual-capture/import-sample-data.mjs # 撮影先にサンプルデータを取り込む(最初の1回)
node packages/frontend/scripts/manual-capture/capture-approval.mjs   # 申請・承認の流れを撮影(⚠ データを変更する)
```

- `capture-approval.mjs` は、実際に見積を作って申請・承認・差戻しをします(撮影先のデータが変わり、通知メールも送られます)。
  `.env` に、申請する一般社員(`MANUAL_APPLICANT_USER`・`MANUAL_APPLICANT_PASSWORD`)と、
  その見積を承認する上長(`MANUAL_APPROVER_USER`・`MANUAL_APPROVER_PASSWORD`)が必要です。前回の見本の見積は、最初に片付けます。

- 撮影の手順は `packages/frontend/scripts/manual-capture/scenarios/` にカテゴリごとに書きます。
- 撮影中に見つかった画面のエラーは `packages/frontend/scripts/manual-capture/.output/report.json` に記録されます。不具合は [バグ票](bug-list.md) に登録して、相談してから直します。
