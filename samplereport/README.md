# samplereport(帳票テンプレートのサンプル)

帳票(PDF)のレイアウトを Excel(xlsx)で定義するための**サンプルテンプレート**です。メール送信設定画面で、
帳票ごとにxlsxをアップロードすると、そのレイアウトでPDFが生成されます(アップロードしない帳票は既定のレイアウト)。

- 全て**架空のデータ**です(社名「サンプル株式会社」、住所は架空の区市名、電話 `03-0000-0000`、登録番号 `T0000000000001`、
  印影は「サンプル株式会社」の架空の印影。ロゴは「LOGO NAME」のダミー)。実在の会社・住所・番号とは関係ありません。
- セルに `{{プレースホルダー}}` を書くと、帳票の生成時に実際の値へ置き換わります。
  **明細のひな形行**(`{{item.〇〇}}` を含む行)は1行だけ置き、明細の件数分に複製されます(1ページに収まらない場合は自動で複数ページになります)。
- `packages/backend/test/sample-report-templates.test.ts` が、このフォルダのテンプレートを実際のコンパイル処理で読み込み、
  各帳票の**実際のプレースホルダー解決処理**の値を差し込んでPDFを描画し、①未対応のプレースホルダーが無い ②未解決の `{{ }}` が残らない
  ③特定につながる情報が含まれていない、ことを確認しています(`npm test`)。テンプレートを変えたら、このテストで確認してください。

## ファイルと対応する帳票

| ファイル | 帳票 | テンプレートID(メール送信設定) | 状態 |
|---|---|---|---|
| `001_Quotation.xlsx` | 見積書 | `sales_quote` | テンプレート(印影・ロゴの画像つき) |
| `002_Confirmation.xlsx` | 注文請書 | `order_acknowledgement` | テンプレート(印影・ロゴの画像つき) |
| `003_Shipping.xlsx` | 出荷指示書 | `shipping_instruction` | テンプレート(印影・ロゴの画像つき) |
| `004_delivery.xlsx` | 納品書 | `sales_invoice` | テンプレート(印影・ロゴの画像つき。指示書と共通のプレースホルダー。小計・消費税は出さない) |
| `005_Invoice.xlsx` | 請求書 | `billing_invoice` | テンプレート(印影・ロゴの画像つき。振込先は直接入力。下の「請求書の注意」参照) |
| `006_purchase.xlsx` | 発注書 | `purchase_order` | テンプレート(印影・ロゴの画像つき) |
| `007_Receiving.xlsx` | 入荷指示書 | `receiving_instruction` | テンプレート(印影・ロゴの画像つき) |
| `008_inspection.xlsx` | 検収書 | `acceptance_inspection` | テンプレート(印影・ロゴの画像つき) |
| `009_SalesRecognition.xlsx` | 売上計上書 | `sales_recognition` | テンプレート(印影・ロゴの画像つき) |
| `010_PurchaseRecognition.xlsx` | 仕入計上書 | `purchase_recognition` | テンプレート(印影・ロゴの画像つき) |

全帳票、印影・ロゴは見積書(`001_Quotation.xlsx`)と同じ画像です。位置は帳票ごとに、自社情報欄・明細ヘッダーと重ならない空き行を自動で探して配置しています(手作業で動かす場合は、右端の列1列だけを使う・他の文字と同じ行に重ねない、の2点を守ってください)。

## テンプレートの書き方

- セルに `{{名前}}` と書くと、その位置に値が入ります。例: セルに `{{partner_name}} 御中` と書くと「サンプル株式会社 御中」になります。文字と組み合わせても構いません(`TEL：{{company_tel}}`)。
- 名前は**半角**で、下の表にあるものだけ使えます。表にない名前を書くとPDFの生成時に `{{ }}` のまま残ります。
- **明細**は、`{{item.name}}` のように `item.` を付けた名前を1行だけ書いておくと、明細の件数分に複製されます(その行の罫線・文字の大きさも複製されます)。
- 金額は `¥12,000` の形(税込・税抜は項目による)、日付は `2026-09-01` の形の**文字**で入ります。Excelの数式・表示形式は使えません(右寄せなどはセルの配置で指定します)。
- 該当するデータがない項目は、空欄になります。

## 使えるプレースホルダー(日本語の解説)

### 全帳票に共通する項目

| プレースホルダー | 意味 | 表示例 |
|---|---|---|
| `company_name` | 自社の会社名(会社・システム設定) | サンプル株式会社 |
| `company_zip` | 自社の郵便番号(ハイフン付き。「〒」は付かないのでテンプレートに書く) | 000-0000 |
| `company_address` | 自社の住所 | 東京都サンプル区サンプル町1-1-1 |
| `company_tel` | 自社の電話番号 | 03-0000-0000 |
| `company_invoice_no` | 適格請求書発行事業者の登録番号(インボイス制度)。未登録なら空欄。出荷指示書・入荷指示書・納品書では使えません | T0000000000001 |

### 明細(見積書・注文請書・発注書・検収書・請求書・売上計上書・仕入計上書)

| プレースホルダー | 意味 | 表示例 |
|---|---|---|
| `item.no` | 明細の連番 | 1 |
| `item.name` | 品目名 | 製品X(標準型) |
| `item.qty` | 数量 | 3 |
| `item.unit` | 単位(単位マスタの名称) | 個 |
| `item.unit_price` | 単価 | ¥12,000 |
| `item.tax_rate` | 税率 | 10% |
| `item.amount` | 明細の金額(単価×数量。値引きはマイナス) | ¥36,000 |

### 金額・税(上の7帳票に共通)

| プレースホルダー | 意味 | 表示例 |
|---|---|---|
| `subtotal_before_discount` | 値引き前の小計(マイナスの明細を除く合計) | ¥55,000 |
| `discount_total` | 値引きの合計(マイナスの明細の合計) | ¥0 |
| `subtotal` | 税抜の合計(合計−消費税)。見積書・注文請書・発注書・検収書・請求書・売上計上書・仕入計上書で使えます | ¥55,000 |
| `tax_amount` | 消費税の合計 | ¥5,500 |
| `total_amount` | 税込の合計 | ¥60,500 |
| `tax_breakdown.rate10.excl` / `.tax` | 10%対象の税抜金額 / 消費税額 | ¥43,000 / ¥4,300 |
| `tax_breakdown.rate8.excl` / `.tax` | 軽減8%対象の税抜金額 / 消費税額 | ¥12,000 / ¥960 |
| `tax_breakdown.rate0.excl` / `.tax` | 0%(非課税・不課税)対象の税抜金額 / 消費税額(消費税は常に¥0) | ¥0 / ¥0 |

### 帳票ごとの項目

**見積書**(`sales_quote`)

| プレースホルダー | 意味 |
|---|---|
| `quote_no` | 見積番号 |
| `quote_date` | 見積日 |
| `valid_until` | 見積の有効期限 |
| `partner_name` | 取引先(得意先)名 |
| `title` | 件名 |
| `delivery_date` | 納期 |
| `payment_terms` | 支払条件 |
| `memo` | 備考 |
| `sales_person_name` | 営業担当者名 |

**注文請書**(`order_acknowledgement`)

| プレースホルダー | 意味 |
|---|---|
| `order_no` | 受注番号 |
| `order_date` | 受注日 |
| `source_quote_no` | 元の見積番号(見積から作った受注のみ) |
| `partner_name` | 取引先(得意先)名 |
| `title` | 件名 |
| `delivery_date` | 納期 |
| `delivery_place` | 納品場所 |
| `payment_terms` | 支払条件 |
| `memo` | 備考 |
| `sales_person_name` | 営業担当者名 |

**発注書**(`purchase_order`)

| プレースホルダー | 意味 |
|---|---|
| `order_no` | 発注番号 |
| `order_date` | 発注日 |
| `source_requisition_no` | 元の購買申請の番号(申請から作った発注のみ) |
| `partner_name` | 仕入先名 |
| `title` | 件名 |
| `delivery_date` | 納期 |
| `delivery_place` | 納品場所 |
| `payment_terms` | 支払条件 |
| `memo` | 備考 |
| `sales_person_name` | 購買担当者名 |

**検収書**(`acceptance_inspection`)

| プレースホルダー | 意味 |
|---|---|
| `acceptance_no` | 検収番号(入庫の番号) |
| `received_date` | 検収日(入庫日) |
| `purchase_order_no` | 発注番号 |
| `partner_name` | 仕入先名 |
| `memo` | 備考 |
| `sales_person_name` | 購買担当者名 |

**請求書**(`billing_invoice`)

| プレースホルダー | 意味 |
|---|---|
| `billing_no` | 請求番号 |
| `billing_date` | 請求日 |
| `period_start` / `period_end` | 請求期間の開始日 / 終了日(締め請求のみ。都度請求は空欄) |
| `partner_name` | 請求先(得意先)名 |
| `title` | 件名 |
| `payment_terms` | 支払条件(現在は「貴社お支払基準に準拠」の固定) |
| `memo` | 備考 |
| `sales_person_name` | 担当者名(請求書には担当者の登録がないため、常に空欄) |

**売上計上書**(`sales_recognition`)

| プレースホルダー | 意味 |
|---|---|
| `sales_no` | 売上番号 |
| `sales_date` | 計上日 |
| `partner_name` | 取引先(得意先)名 |
| `title` | 件名 |
| `payment_terms` | 支払条件 |
| `memo` | 備考 |
| `sales_person_name` | 営業担当者名 |

**仕入計上書**(`purchase_recognition`)

| プレースホルダー | 意味 |
|---|---|
| `purchase_no` | 仕入番号 |
| `purchase_date` | 計上日 |
| `delivery_date` | 納品日(計上日と同じ) |
| `purchase_order_no` | 発注番号(発注から計上した場合のみ) |
| `partner_name` | 仕入先名 |
| `title` | 件名 |
| `payment_terms` | 支払条件 |
| `memo` | 備考 |
| `sales_person_name` | 購買担当者名 |

**出荷指示書・入荷指示書・納品書**(`shipping_instruction` / `receiving_instruction` / `sales_invoice`。3帳票は共通で、文言を変える項目は「〇〇_label」で取れます)

| プレースホルダー | 意味 |
|---|---|
| `document_title` | 帳票の題名(出荷指示書など) |
| `code` | 伝票番号 |
| `date` | 発行日 |
| `recipient_label` / `recipient_name` | 宛先の見出し(出荷先・入荷先・納品先など) / 宛先の名称 |
| `recipient_address` / `recipient_tel` | 宛先の住所 / 電話番号 |
| `partner_label` / `partner_name` | 取引先欄の見出し(得意先・仕入先・出荷元倉庫) / その名称 |
| `scheduled_date_label` / `scheduled_date` | 日付欄の見出し(出荷予定日・入荷予定日・出荷日) / その日付 |
| `company_fax` | 自社のFAX番号 |
| `memo` | 備考 |
| `staff_name` | 担当者名 |
| `delivery_addressee` / `delivery_location` / `delivery_phone` | 納品先の宛名 / 場所 / 電話番号 |
| `sales_order_id` | 元の受注番号(納品書のみ。受注に紐づかない場合は空欄) |

この3帳票の明細は、上の共通の明細とは名前が異なります。

| プレースホルダー | 意味 |
|---|---|
| `item.no` | 明細の連番 |
| `item.item_code` | 品目コード |
| `item.item_name` | 品目名 |
| `item.lot_number` | ロット番号 |
| `item.quantity` | 数量 |
| `item.unit` | 単位 |
| `item.remark` | 明細の備考 |
| `item.unit_price` / `item.amount` | 単価 / 金額(納品書のみ。受注に紐づかない明細は空欄) |

正確な一覧は `packages/backend/src/platform/report-templates/resolve-*-placeholders.ts` を参照してください(テストはここが返す値と突き合わせています)。

## 請求書の注意
- **振込先**(銀行・支店・口座番号・名義)は、システムに登録する項目がないため、テンプレートに**直接文字で入力**します(サンプルの `005_Invoice.xlsx` の「振込先」の欄は架空の口座です)。
- 請求書には担当者の情報がないため、`005_Invoice.xlsx` には担当者の欄を置いていません。
- 支払期限の欄は「支払条件」として `{{payment_terms}}` を置いています。

## 補足
- 各テンプレートの印影・ロゴの画像は、Excelに貼り付けた画像がそのままPDFに描画されます(`company/` の会社ロゴ・印影とは別のデータです)。
- 金額などの値は、Excelの数式ではなくプレースホルダーで差し込みます(サンプルのテンプレートには数式を残していません)。
- テンプレートをアップロードしていない帳票、または読み込みに失敗した帳票は、従来どおり既定の(固定の)レイアウトでPDFが生成されます。
