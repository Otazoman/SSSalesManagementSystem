# バックエンドの構造

`packages/backend` は、Cloudflare Workers 上で動く API サーバーです(Hono + Drizzle ORM)。
システム全体の中での位置づけは [全体設計](overview.md) を参照してください。

## 1. API ドキュメント

API の一覧・リクエスト・レスポンスの形式は、Swagger UI で確認できます。**開発環境専用**です。

| 内容 | URL(ローカル) |
|---|---|
| API ドキュメント(Swagger UI) | http://localhost:8788/api/docs |
| OpenAPI 仕様(JSON) | http://localhost:8788/api/openapi.json |

- 見るには、ローカルで Backend・Frontend を起動し(README の3章)、**ログインした状態で**上の URL を開きます。
- `packages/backend/.dev.vars` に `ENABLE_API_DOCS=true` がある時だけ表示されます。Staging・本番には設定しないので、表示されません(404)。
- API ドキュメントに載るのは、ルートに `describe〇〇Route()`(`platform/openapi/describe-route.ts`)を付けた API だけです。未対応の API も順次追加しています。

## 2. ディレクトリ構成

```text
packages/backend/
├─ wrangler.jsonc.example      Worker の設定のひな形(wrangler.jsonc はここから生成する。Git管理外)
├─ drizzle/                    DB の migration(main / log / otp / journal / deals / ui)。変更禁止
├─ test/                       複数機能にまたがるテスト(サンプルデータの取込など)と、テスト用の DB 準備
└─ src/
   ├─ index.ts                 入口。CORS・API キーの確認・ルーターの自動割り当て・Cron の処理
   ├─ types/env.ts             Worker のバインディング(D1・R2・KV・秘密の値)の型
   ├─ constants/               画面定義(screens.ts)などの定数
   ├─ db/                      テーブル定義(Drizzle のスキーマ)。クエリは書かない
   │  ├─ schema.ts             業務DB(DB)の入口。schemas/ の各ファイルをまとめて公開する
   │  ├─ schemas/              schema-core(共通・マスタ) / schema-biz(伝票・在庫) / schema-workflow(承認)
   │  └─ *-schema.ts           audit(監査ログ) / otp / journal(仕訳) / deals(商談) / ui(表示設定)
   ├─ routes/                  機能ごとの API(下の3章)
   ├─ platform/                機能をまたいで使う共通処理(下の5章)
   ├─ workflow-engine/         承認ワークフローの共通エンジンと、対象ごとのアダプター(下の6章)
   ├─ scheduled/               Cron で動く処理(通知の送信、帳票テンプレートの変換)
   └─ utils/                   メール送信・PDF生成・ログなど、platform に入らない既存の処理
```

## 3. 機能(routes)

### 3-1. 領域と機能

機能は、業務の領域ごとのディレクトリに分けています。

| 領域 | ディレクトリ | 主な機能 |
|---|---|---|
| 認証 | `routes/auth` | ログイン・ログアウト・ログイン中のユーザー情報 |
| システム管理 | `routes/admin` | ユーザー・ロール・部署・画面権限・承認フロー・会社設定・メール設定・消費税・お知らせ・画面説明・監査ログ・メールログ・OTPログ・仕訳(出力・形式・連携元)・DB/R2 の閲覧 |
| マスタ | `routes/master` | 取引先・取引先担当者・納品先・商品・商品単価・商品構成・単位・勘定科目・倉庫・倉庫担当者・ロケーション・営業拠点・プロジェクト・発注点・仕訳ルール |
| 販売 | `routes/sales` | 商談・見積・受注・売上・請求・入金 |
| 購買 | `routes/purchase` | 購買申請・発注・仕入・支払 |
| 在庫 | `routes/inventory` | 入荷指示・入庫・出荷指示・出庫・在庫・棚卸・品質区分の変更・廃棄・返品 |
| 承認 | `routes/workflow` | 承認申請・承認タスク(承認・差戻し・一括承認・履歴) |
| その他 | `routes/progress` ほか | 進捗確認、伝票の完了/進行中の手動設定、ユーザーの表示設定 |

### 3-2. URL の決まり方(自動割り当て)

`src/routes/index.ts` で公開したルーターは、`src/index.ts` が自動で `/api/{名前}` に割り当てます。
名前はキャメルケースからケバブケースに変換されます。

```ts
// src/routes/index.ts
export { unitsRouter as units } from "./master/units";                   // → /api/units
export { companySettingsRouter as companySettings } from "./admin/...";  // → /api/company-settings
```

新しい機能を追加したときは、`routes/index.ts` に1行追加するだけで URL が決まります。

### 3-3. 1つの機能のファイル構成

各機能のディレクトリは、次の4つのファイルが基本です。

```text
routes/master/units/
├─ index.ts              ルーター。URL・HTTPメソッド・入力チェックの宣言と、レスポンスの組み立て
├─ units.service.ts      業務ロジック(ステータスの判定、他の機能との連携など)
├─ units.repository.ts   DB のクエリ(Drizzle)だけ
├─ units.schema.ts       リクエストの入力チェック(Valibot)。DB のテーブル定義ではない
└─ index.test.ts         テスト
```

- 大きな機能は、`service` を役割ごとに分けます(例: 見積は `quote-crud.service.ts`・`quote-csv.service.ts`・`quote-pdf.service.ts`・`quote-mail.service.ts` など)。
- テストはソースと同じ場所に `*.test.ts` として置きます。

### 3-4. 何をどこに書くか

| ファイル | 書いてよいもの | 書いてはいけないもの |
|---|---|---|
| `index.ts`(ルーター) | URL の宣言、入力チェック(`vValidator`)の適用、HTTP ステータスの組み立て | DB のクエリ、業務ルールの判定 |
| `*.service.ts` | 業務ロジック、他の機能の **service** の呼び出し、`platform/` の利用 | 他の機能の **repository** を直接使うこと |
| `*.repository.ts` | Drizzle のクエリだけ | ステータスが変更可能かなどの業務ルール |
| `*.schema.ts` | リクエストの Valibot スキーマ | DB のテーブル定義の再定義 |
| `platform/` | 機能をまたいで使う汎用処理 | 特定の機能・テーブルを前提にした処理 |
| `workflow-engine/target-adapters/` | 承認が確定したときに、対象のテーブルへどう反映するか | 共通エンジン(`engine.ts`)のロジック |
| `db/` | テーブル定義だけ | クエリ |

### 3-5. 依存の向き

```text
routes/{機能}/index.ts
  → {機能}.service.ts
      → {機能}.repository.ts → db(テーブル定義)
      → platform/*
      → 他の機能の service(機能をまたぐときは service 経由。repository を直接使わない)
workflow-engine/engine.ts(対象の種類を知らない)
  → workflow-engine/target-adapters/registry.ts
      → 対象の機能の repository(アダプターの中でだけ、機能の DB を扱ってよい)
```

`platform/`・`db/` から特定の機能への依存(逆向き)は禁止です。

## 4. リクエストの処理(src/index.ts)

リクエストは、次の順に処理されます。

1. **CORS**: `FRONTEND_URL` と localhost からの接続だけを許可します(cookie 付き)。
2. **API キーの確認**(`/api/*`): `X-API-KEY` が `API_KEY` と一致しなければ 401 を返します。例外は次のとおりです。
   - ユーザーが0人の間の `/api/users/count`・`/api/users/setup-admin`(初期設定用)
   - 取引先・外部倉庫向けの OTP ダウンロード(`/api/{見積・受注・売上・請求・発注・検収・入出荷指示・出庫}/download-request|verify/...`)
3. **各機能のルーター**: 必要に応じて `getSession()`(`platform/auth/get-session.ts`)でログイン中のユーザーを取得し、処理します。
4. **エラー処理**: `platform/http/http-error.ts` のエラーを投げると、対応する HTTP ステータスで返ります。

| エラークラス | ステータス | 使う場面 |
|---|---|---|
| `BadRequestError` | 400 | 入力が不正、今の状態ではできない操作 |
| `ForbiddenError` | 403 | 権限が無い操作 |
| `NotFoundError` | 404 | 対象が見つからない |
| `ConflictError` | 409 | 重複・競合 |

### 4-1. エラー処理のルール

エラーの応答は、全ての API で同じ形です(入力チェックのエラーだけ `errors` に項目ごとの内容が付きます)。

```json
{ "success": false, "message": "画面に出す文言" }
```

| 場面 | 書き方 | 応答 |
|---|---|---|
| 利用者が直せる理由がある(入力・データの状態・設定の不足など) | `BadRequestError` などのエラークラス(上の表)を投げる | そのステータスと `message` |
| 想定外(プログラムの不具合・外部サービスの障害など) | 通常の `Error` を投げる(または発生したエラーをそのままにする) | 500。`message` は「〇〇に失敗しました(問い合わせ番号: xxxx)」。元のエラー文はログにだけ出す |
| 入力チェック(valibot) | `vValidator(対象, スキーマ, validationHook())` と、必ず `validationHook()` を付ける。`v.safeParse` を自分で判定する場合は `if (!parsed.success) return respondValidationError(c, parsed.issues);` | 400。`message` は、スキーマに日本語の文言があれば最初の不備の文言、無ければ「入力内容に不備があります」 |
| 本文の JSON が壊れている | 何もしない(`src/index.ts` の `rejectMalformedJson` が、各 API の前に返す) | 400。「リクエストの形式が正しくありません」 |

- ルーターの catch・`onError`・`app.onError`(`src/index.ts`)は、全て `respondError(c, err, "〇〇に失敗しました")`(`platform/http/error-handler.ts`)を呼ぶだけにします。
  catch で `isHttpError` などを個別に判定したり、`c.json({ error: ... })` を返したり、400 の応答をファイルごとの関数(`badRequest` など)で作ったりしません。
- 外部キー制約の違反など、ルーターで特定の文言に置き換えたいものだけ、`respondError` の前に分岐を書きます。
- 500 の文言に `err.message` を入れません(DB のエラー文などが画面に出てしまうため。BUG-025)。
  例外: メール送信設定の「テスト送信」は、SMTP の設定を確かめる機能のため、SMTP サーバーの応答を文言に入れています。
- サービスの catch で別のエラーに包み直す場合は、業務エラー(`isHttpError`)はそのまま投げ直し、理由を消さないようにします。
- 一括処理(一括メール送信など)の結果の一覧に含まれる `error`(1件ごとの失敗の理由)は、エラーの応答ではなく処理の結果なので、この形の対象外です。

> **権限チェックについて**: Backend では、画面・操作ごとの権限チェックは一部を除き行っていません(画面権限は主に Frontend で制御しています)。詳しくは [全体設計の4-2](overview.md#4-2-権限画面権限) を参照してください。

## 5. 共通処理(platform)

| ディレクトリ | 内容 |
|---|---|
| `platform/auth` | セッション cookie の発行・検証(`get-session.ts`・`session-token.ts`)、パスワードのルールと初期パスワードの生成(`password-policy.ts`。会社設定 `password_*`。BUG-046) |
| `platform/http` | エラークラス・エラー処理・ページング(`pagination.ts`)・並び替え(`sort.ts`)・日付範囲・レスポンスの型 |
| `platform/validation` | 入力チェックの共通部品(Valibot) |
| `platform/db` | Drizzle の DB 接続の作成(`createDb()`) |
| `platform/repository` | 検索条件の組み立て、大量の ID を分割して取得する処理、共通のクエリ |
| `platform/id` | 伝票番号・マスタコードの採番 |
| `platform/csv` | CSV の読み込み・書き出し |
| `platform/r2` | 添付ファイルの保存先キーの生成、旧バケットへのフォールバック、不要ファイルの削除 |
| `platform/kv` | 会社設定(`COMPANY_SETTINGS`)の読み込みとキャッシュ |
| `platform/audit` | 監査ログの記録 |
| `platform/notifications` | メール・Slack 通知を送信待ちの一覧(outbox)に登録 |
| `platform/otp` | 取引先向けダウンロードの OTP の発行・検証 |
| `platform/report-templates` | 帳票テンプレートの変換と PDF の描画 |
| `platform/documents` | 帳票の既定値・ファイル名、赤伝(取消伝票) |
| `platform/journal` | 仕訳の作成・計上・訂正、勘定科目の解決 |
| `platform/inventory` | 在庫の引当 |
| `platform/firm-banking` | 全銀形式の振込ファイルの作成 |
| `platform/date` | 日本時間の日付(`todayJst`・`formatJstDate`)。Worker は UTC で動くため、**「今日」や日時からの日付は必ずこれで作る**(BUG-043) |
| `platform/tax` | 消費税の端数処理(会社設定 `tax_rounding_mode`)・保存時の合計の計算し直し・仕訳の明細への割り振り(5-2) |
| `platform/html` | HTML の無害化(お知らせ・画面説明などのリッチテキスト) |
| `platform/openapi` | API ドキュメント用のルート説明(`describe〇〇Route()`) |

### 5-1. 一覧 API の共通仕様

- **ページング**: `page`・`limit` を指定すると `{ data, pagination }` の形で返します。指定しないと、従来どおり配列で全件を返します(後方互換)。
- **並び替え**: `sortBy`・`sortOrder` で指定します。並び替えに使える列は、各 repository で許可したものだけです。
- **状態の絞り込み**: マスタは `status`(`active` など)で絞り込めます。

### 5-3. 複数の表への書き込み(BUG-044・048・049)

D1 は、`db.batch()` でまとめた書き込みだけが、途中で失敗した時にまとめて取り消されます(トランザクションは使えません)。
1つの操作で複数の表に書き込む処理は、必ず1回の batch にします。

- リポジトリの中で完結する場合は `this.db.batch([...])` を使う。
- サービスで複数のリポジトリのメソッドを呼ぶ場合は `recordWritesForBatch`(`platform/repository/record-writes-for-batch.ts`)を使う。
  `const tx = recordWritesForBatch(this.repo);` → `await tx.repo.〇〇()`(書き込みは記録だけされる)→ `await tx.commit();`。
  別のリポジトリの書き込みは `tx.include(repo)` で同じ batch に加える。承認の処理(`workflow-tasks-approval.service.ts`)も
  手番・申請と、アダプターの反映を1回の batch にしている。書き込み直後の再集計や R2 の後始末を含むアダプター(在庫・棚卸・受注・品目)は
  `requiresImmediateWrites` とし、先に対象へ反映してから手番・申請を書き込む(失敗した場合は承認待ちのまま残る)。
- 記録中は、書き込みの結果(`meta.changes`)を使えない。在庫の引当(`tryReserve`)は記録に含めない。
  在庫の減算は `decreaseQuantityOrFail`(足りない場合は SQL のエラーにして batch ごと取り消す)を使い、足りるかは書き込む前に読み取って確かめる。
- R2 のファイルを消す処理・メールは、書き込みが成功した後に行う。
- 1つの INSERT に複数行をまとめない(D1 は1つの文で使える値が100個まで)。1行ずつの INSERT を batch にする。

### 5-2. 消費税の計算(BUG-042)

- 端数処理は「1つの伝票(請求書)につき、税率ごとの合計に1回」。方法は会社設定の `tax_rounding_mode`(`floor` 切り捨て・`round` 四捨五入・`ceil` 切り上げ。初期値は切り捨て)。
- 計算は `platform/tax/compute-tax-amounts.ts`(`roundTaxAmount`)に1つだけ置く。画面側の `frontend/app/_shared/tax-amounts.ts` も同じ計算にする。
- **保存する合計(税込)・消費税は Backend が明細から計算する**。見積・受注・売上・仕入計上は `recalculateDocumentTotals`、発注・購買申請は `calcAmounts`、
  承認済みの伝票の変更申請は、承認時に各アダプターで計算し直す。画面の計算は表示用。
- 請求は、対象の売上の明細と手入力の明細の全てから、請求書として税率ごとに1回計算する(`billing-tax-lines.ts`。請求書 PDF の内訳も同じ)。
- 仕訳は、伝票の消費税を明細に割り振る(`allocateDocumentTaxToLines`)。明細の消費税の合計は、伝票に保存された消費税と必ず一致する。
- 伝票の `totalAmount` は税込、`taxAmount` は消費税(見積・受注・売上・仕入計上・発注・購買申請・請求で共通)。

## 6. 承認ワークフロー(workflow-engine)

```text
workflow-engine/
├─ engine.ts            承認の共通エンジン(申請の登録、承認フローの選択、承認者の決定、承認・差戻し)
├─ notifier.ts          承認依頼・結果の通知
├─ settings.ts          承認機能の有効/無効の判定
└─ target-adapters/     対象ごとの処理(承認が確定したときの反映、金額の取得、プレビュー)
   ├─ registry.ts       対象の種類(targetType)→ アダプターの対応表
   └─ *.adapter.ts      取引先・商品・見積・受注・発注・仕入・在庫などのアダプター
```

- 共通エンジンは、対象の種類(`targetType`)を知りません。
- 新しいマスタや伝票を承認の対象にするときは、アダプターを1つ追加して `registry.ts` に登録します。`engine.ts` は変更しません。

## 7. データベース(Drizzle ORM)

- テーブル定義は `src/db/` にあり、DB ごとにファイルが分かれています([全体設計の3-1](overview.md#3-1-d1データベース))。
- migration は `drizzle-kit generate` で `drizzle/{DB名}/` に作ります(README の9章)。**既存の migration は変更・削除しません**。
- 機能のコードでは `createDb(c.env.DB)` で接続を作り、repository の中でクエリを書きます。
- テーブルと項目の詳細は、[DB 構造](../database/README.md)(ER 図・項目の説明、スキーマから自動生成)を参照してください。

## 8. テスト

- Vitest を、Cloudflare Workers と同じ実行環境(`@cloudflare/vitest-pool-workers`)で動かします。
- テスト用の D1 はメモリ上に作られ、`test/apply-migrations.ts` が全 DB の migration を適用してから始まります。
- `vitest.config.ts` でテスト用のバインディング(D1・R2・KV・秘密の値)を定義しています。`wrangler.jsonc` は読みません。
- 実行方法は README の9章を参照してください。

## 9. 命名のルール

| 対象 | ルール | 例 |
|---|---|---|
| ルーター | `{機能}/index.ts` | `routes/master/products/index.ts` |
| Service | `{機能}.service.ts`(役割で分ける場合は `{機能}-{役割}.service.ts`) | `products.service.ts`、`quote-pdf.service.ts` |
| Repository | `{機能}.repository.ts` | `products.repository.ts` |
| 入力チェック | `{機能}.schema.ts` | `products.schema.ts` |
| 承認アダプター | `{対象}.adapter.ts` | `partners.adapter.ts` |
| platform の関数 | 動詞+目的語のケバブケースのファイル名、名前付き export | `generate-attachment-key.ts` |
| ルーターの公開名 | キャメルケース(URL はケバブケースに自動変換) | `companySettings` → `/api/company-settings` |

既存のコードには、このルールから外れた名前も残っています。一括での名前変更はせず、新しく作るファイル・手を入れるファイルから揃えます。

### 9-1. API の形(URL・項目名)

全ての機能で次の形にそろえています(BUG-036、2026-09-28)。新しく作る API もこの形にします。

| 操作 | 形 | 例 |
|---|---|---|
| 一覧 | `GET /api/{機能}`(`page`・`limit` を指定すると `{data, pagination}`、指定しなければ配列) | `GET /api/sales-deals?page=1&limit=50` |
| 登録 | `POST /api/{機能}/register` | `POST /api/stock-receipts/register` |
| 更新・削除 | `PUT` / `DELETE /api/{機能}/:id` | `PUT /api/stock-receipts/SR-1` |
| CSVダウンロード | `GET /api/{機能}/csv-download` | `GET /api/tax-categories/csv-download` |
| CSVインポート | `POST /api/{機能}/bulk-register`(`multipart/form-data` の `file`) | `POST /api/units/bulk-register` |
| 期間の検索条件 | `startDate`・`endDate`(`YYYY-MM-DD`) | `GET /api/stock-shipments?startDate=2026-09-01&endDate=2026-09-30` |

- 1件の帳票を作る操作は `POST /api/{機能}/:id/generate-pdf`、1件の帳票の CSV は `GET /api/{機能}/:id/csv` です。
- 例外: 消費税マスタの更新は、コードを URL に含めない `PUT /api/tax-categories`(本文の `code` で対象を決める)です。
