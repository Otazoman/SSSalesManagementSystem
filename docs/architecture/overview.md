# 全体設計

販売管理システム全体の構成・データの流れ・設計ルールをまとめます。
各パッケージの詳しい構造は [バックエンドの構造](backend.md)・[フロントエンドの構造](frontend.md) を参照してください。
構築・デプロイの手順はプロジェクトルートの [README.md](../../README.md) にあります。

## 1. システム構成

```text
ブラウザ
  │  画面(静的ファイル)の取得、/api/* の呼び出し(同じURL・cookie付き)
  ▼
Frontend Worker  (packages/frontend)                        ← 公開(外部からアクセスできるのはここだけ)
  │  - 画面: Next.js を静的ファイルに書き出したもの(Workers Assets で配信)
  │  - proxy.ts: ログイン状態の確認、ページのアクセス制御、/api/* の転送
  │  - 転送時に API_KEY を X-API-KEY ヘッダーとして付与(ブラウザには出さない)
  │
  │  Service Binding(env.BACKEND。Worker 同士の直接接続で、URL は使わない)
  ▼
Backend Worker  (packages/backend)                          ← 非公開(workers_dev: false)
  │  - API: Hono。/api/{機能名} に機能ごとのルーターを自動で割り当てる
  │  - CORS・API キーの確認 → 各機能の処理 → Drizzle ORM で DB へ
  │  - Cron(1分ごと): メール・Slack 通知の送信、帳票テンプレートの変換
  ▼
D1(データベース) / R2(ファイル) / KV(設定・キャッシュ) / Secrets Store(秘密の値)
```

| 構成要素 | 場所 | 技術 |
|---|---|---|
| 画面 | `packages/frontend/app` | Next.js 16(`output: "export"` で静的ファイルに書き出す)/ React 19 / Tailwind CSS 4 |
| Frontend Worker | `packages/frontend/proxy.ts` | Cloudflare Workers(Workers Assets で画面を配信) |
| Backend Worker | `packages/backend/src` | Cloudflare Workers / Hono / Drizzle ORM / Valibot |
| データ | D1・R2・KV・Secrets Store | Cloudflare のサービス |
| インフラ定義 | `infra/terraform` | Terraform(D1・R2・KV の作成のみ) |

- Frontend と Backend は**別々の Worker** です。責務を統合しません(CLAUDE.md #17)。
- デプロイは **Backend → Frontend の順**です(Frontend が Backend に直接つながるため)。
- Cloudflare の無料プランで動く構成にしています。

## 2. リクエストの流れ

### 2-1. 画面の表示

1. ブラウザが Frontend Worker にページを要求します。
2. `proxy.ts` がセッション cookie(`session_token`)を確認します。
   - ログインしていない場合: 公開ページ(ログイン画面、初期設定画面、取引先向けの OTP ダウンロード画面など)以外は `/login` に移動します。
   - `/admin` 配下は、ロールが `admin` でなければ `/dashboard?error=unauthorized` に移動します。
3. Workers Assets から静的ファイル(HTML・JS・CSS)を返します。
4. 画面の中では、`PermissionGuard` がユーザーの画面権限を確認し、権限が無い画面は「アクセスできません」と表示します。

### 2-2. API の呼び出し

1. 画面の JavaScript が、同じ URL の `/api/...` を呼びます(cookie は自動で送られます)。
2. `proxy.ts` が次を確認します。
   - ログイン不要の API(ログイン、初期設定、パスワード再設定、OTP ダウンロード)以外は、有効なセッション cookie が必要です。無ければ 401 を返します。
3. `proxy.ts` が `X-API-KEY` ヘッダーを付けて、Service Binding で Backend Worker に転送します。
4. Backend の `src/index.ts` が CORS と `X-API-KEY` を確認し、該当する機能のルーターに渡します。
5. 各機能が処理して、JSON(または PDF・CSV など)を返します。

## 3. Cloudflare のリソース

### 3-1. D1(データベース)

性格の違うデータを別々のデータベースに分けています。

| バインディング | 本番のデータベース名 | 内容 | スキーマ定義 | migration |
|---|---|---|---|---|
| `DB` | `my-erp-db` | 業務データ(マスタ・伝票・在庫・承認・ユーザーなど) | `src/db/schema.ts`(`schemas/*`) | `drizzle/main` |
| `DB_LOG` | `my-erp-log-db` | 監査ログ | `src/db/audit-schema.ts` | `drizzle/log` |
| `DB_OTP` | `my-erp-otp-db` | 取引先向けダウンロードの OTP | `src/db/otp-schema.ts` | `drizzle/otp` |
| `DB_JOURNAL` | `my-erp-journal-db` | 仕訳データ | `src/db/journal-schema.ts` | `drizzle/journal` |
| `DB_DEALS` | `my-erp-deals-db` | 商談(営業活動) | `src/db/deals-schema.ts` | `drizzle/deals` |
| `DB_UI` | `my-erp-ui-db` | お知らせ・画面説明・ユーザーの表示設定 | `src/db/ui-schema.ts` | `drizzle/ui` |

> Staging では、無料プランの上限(1アカウント10個)のため、`DB` 以外の5つを1つの物理データベース(`my-erp-shared-db-staging`)にまとめています。
> アプリのコードはバインディング名で使い分けるので、この違いを意識する必要はありません。

テーブルと項目の詳細(ER 図・項目の説明)は、[DB 構造](../database/README.md) を参照してください。

### 3-2. R2(ファイル)

| バインディング | 本番のバケット名 | 内容 |
|---|---|---|
| `SYSTEM_BUCKET` | `system` | 帳票用のフォント・ロゴ・印影、帳票テンプレートなどシステム共通のファイル |
| `QUATES_BUCKET` | `my-erp-quates-attachments` | 見積の添付・見積書PDF(受注・売上・請求・仕入の旧ファイルの置き場も兼ねる) |
| `SALES_ORDERS_BUCKET` | `my-erp-sales-orders-attachments` | 受注の添付・注文請書PDF |
| `SALES_INVOICES_BUCKET` | `my-erp-sales-invoices-attachments` | 売上の添付・売上関連書類PDF |
| `BILLING_BUCKET` | `my-erp-billing-attachments` | 請求書PDF |
| `PURCHASE_REQUISITIONS_BUCKET` | `my-erp-purchase-requisitions-attachments` | 購買申請の添付 |
| `PURCHASE_ORDERS_BUCKET` | `my-erp-purchase-orders-attachments` | 発注書PDF・添付 |
| `PURCHASE_RECOGNITIONS_BUCKET` | `my-erp-purchase-recognitions-attachments` | 仕入の添付・仕入計上書PDF |
| `ACCEPTANCE_INSPECTIONS_BUCKET` | `my-erp-acceptance-inspections-attachments` | 検収書PDF |
| `SHIPMENT_INSTRUCTIONS_BUCKET` | `my-erp-shipment-instructions-attachments` | 出荷指示書PDF(外部倉庫向け) |
| `RECEIPT_INSTRUCTIONS_BUCKET` | `my-erp-receipt-instructions-attachments` | 入荷指示書PDF(外部倉庫向け) |
| `PRODUCTS_BUCKET` | `my-erp-products-attachments` | 商品マスタの添付 |
| `PARTNERS_BUCKET` | `my-erp-partners-attachments` | 取引先マスタの添付 |
| `WAREHOUSES_BUCKET` | `my-erp-warehouses-attachments` | 倉庫マスタの添付 |
| `DEALS_BUCKET` | `my-erp-deals-attachments` | 商談の添付 |

- Staging のバケット名は、末尾に `-staging` が付きます(例: `system-staging`)。
- 機能別のバケットに分ける前のファイルは旧バケット(`QUATES_BUCKET`・`SYSTEM_BUCKET`)に残っています。読み取りは「新しいバケット → 旧バケット」の順に探します(`platform/r2/bucket-with-fallback.ts`)。

### 3-3. KV(設定・キャッシュ)

| バインディング | 内容 |
|---|---|
| `COMPANY_SETTINGS` | 会社・システム設定(`config` キーの JSON。監査ログ・承認機能の有効/無効など)、パスワード再設定の一時トークンなど |
| `KV_PERMISSIONS` | ロールごとの画面権限のキャッシュ(`role_permissions:{roleId}`) |

### 3-4. 秘密の値

| 名前 | 使う Worker | 保存場所 | 内容 |
|---|---|---|---|
| `API_KEY` | Frontend・Backend | Secrets Store | Frontend から Backend を呼ぶときの認証キー |
| `SESSION_SECRET` | Frontend・Backend | Secrets Store | ログインセッション(cookie)の署名キー |
| `SETUP_TOKEN` | Backend | Secrets Store | 初期管理者を作成するときに入力するトークン |
| `FRONTEND_URL` | Backend | Worker の Secret | Frontend の URL(CORS で許可する接続元) |
| `FRONTEND_BASE_URL` | Backend | Worker の Secret | Frontend の URL(通知メール内のリンク) |
| `ENABLE_API_DOCS` | Backend | ローカルの `.dev.vars` のみ | `true` の時だけ API ドキュメントを表示する(開発環境専用) |

Secrets Store はアカウントに1つだけで、Staging は名前の末尾に `_STAGING` を付けて区別します。

## 4. 認証と認可

### 4-1. ログインとセッション

- ログインすると、Backend が署名付きのセッション cookie(`session_token`、有効期間24時間)を発行します(`platform/auth/session-token.ts`・`get-session.ts`)。
- cookie の中身は、ユーザーID・名前・ロール・部署名・会社名・有効期限を HMAC-SHA256 で署名したものです。署名キーは `SESSION_SECRET` です。
- Frontend(`proxy.ts`)と Backend は、同じ `SESSION_SECRET` でこの cookie を検証します。
- ユーザーが1人もいない間だけ、初期設定用の API(`/api/users/count`・`/api/users/setup-admin`)を API キー無しで使えます。初期管理者の作成には `SETUP_TOKEN` が必要です。

### 4-2. 権限(画面権限)

- 権限は「ロール」ごとに、画面(`resource`)と操作(一覧・登録・更新・削除など)の組み合わせで設定します(管理画面の「画面・権限マスタ」)。
- 画面の定義は `packages/backend/src/constants/screens.ts` の `SCREEN_MASTER` です。ここに登録された画面が、メニューと権限設定の対象になります。
- ログイン後、画面は `/api/auth/profile`(ユーザーと権限)と `/api/permissions/screens`(画面一覧)を取得し、メニューの表示と `PermissionGuard` による画面の表示可否に使います。
- ロール `admin`(システム管理者)は、すべての画面を使えます。

> **現状の注意点(2026-09-23 時点)**
> Backend では、API キーとログイン状態の確認はしていますが、**画面・操作ごとの権限チェックは一部(ユーザー管理の管理者操作など)を除いて行っていません**。
> 画面権限は主に Frontend(ブラウザ側)の表示制御で守られています。ログインしているユーザーであれば、権限の無い画面の API も技術的には呼び出せる状態です。
> 改善する場合は認証・認可の設計変更になるため、CLAUDE.md #4 に従い、事前に方針を決めてから行います。

### 4-3. Backend の公開範囲

Backend Worker は公開していません(`workers_dev: false`・`preview_urls: false`)。
外部からは Frontend Worker 経由でしか届かず、さらに `X-API-KEY` とセッションの確認を通る必要があります。

## 5. 主な仕組み

### 5-1. 承認ワークフロー

- 伝票・マスタの登録や変更は、承認機能を有効にすると「申請 → 承認(多段) → 確定」の流れになります。機能ごとに有効/無効を切り替えられます(会社・システム設定)。
- 承認の経路は「承認フロー」マスタで決まります。申請の種類と金額の範囲で候補を絞り、任意の条件項目(`matchField`/`matchValue`)が一致するフローを優先して選びます。
- 各段の承認者は、承認フローに設定したロールと、申請者(または申請時に選んだ申請部署)の部署から決まります。ユーザーを選んで経路を事前に確認することもできます(承認フロー画面の申請経路プレビュー)。
- 汎用の承認エンジン(`workflow-engine/engine.ts`)は対象の種類を知りません。承認が確定したときに実際のテーブルへどう反映するかは、対象ごとの「アダプター」(`workflow-engine/target-adapters/*.adapter.ts`)が担当します。

### 5-2. 帳票(PDF)とメール

- 見積書・注文請書・納品書・請求書・発注書・検収書などの PDF は、Backend で生成します(`platform/report-templates/`、pdf-lib)。フォント・ロゴ・印影は R2 の `SYSTEM_BUCKET` から読みます。
- 帳票テンプレートは Excel(xlsx)でアップロードでき、Cron で変換されます(`scheduled/process-report-template-compiles.ts`)。
- 取引先へのメール送信やダウンロードは、OTP(使い捨ての確認コード)付きのリンクで行えます。
- メール・Slack の通知は、いったん送信待ちの一覧(outbox)に入れ、Cron(1分ごと)がまとめて送ります(`scheduled/process-notification-outbox.ts`)。

### 5-3. 仕訳の連携

売上・仕入・入金・支払などの伝票から、仕訳ルールに従って仕訳データ(`DB_JOURNAL`)を作成し、会計ソフト向けの形式で出力できます(`platform/journal/`)。

### 5-4. 監査ログ

登録・更新・削除などの操作は、監査ログ(`DB_LOG`)に記録されます(`platform/audit/log-audit-event.ts`)。記録の有効/無効は会社・システム設定で切り替えます。

## 6. 環境

| 環境 | 動く場所 | Frontend の URL | 用途 |
|---|---|---|---|
| ローカル開発 | PC / Codespaces(`wrangler dev`) | http://localhost:8788 | 開発・テスト |
| Staging | Cloudflare(`--env staging`) | `https://my-erp-frontend-staging.<サブドメイン>.workers.dev` | 本番前の確認 |
| 本番 | Cloudflare | `https://my-erp-frontend.<サブドメイン>.workers.dev`(独自ドメインも可) | 業務で使う |

- ローカルでは D1・R2・KV を PC 上で再現します(`.wrangler/`)。
- `wrangler.jsonc` は Git 管理外で、ひな形(`wrangler.jsonc.example`)から `infra/scripts/sync-wrangler.mjs` で作ります(詳しくは README の1章)。

## 7. 設計ルール(共通)

- **1つの機能 = 1つのディレクトリ**: Backend は `routes/{領域}/{機能}/`、Frontend は `app/{領域}/{機能}/` に、その機能のファイルをまとめます。
- **共通の置き場は2種類だけ**: Backend は `platform/`(と承認の `workflow-engine/`)、Frontend は `app/_shared/`。「何でも入れる utils/common」は作りません。
- **共通化は「同じ意味・同じ責務・同じ仕様」の時だけ**: 違う場合は重複を許して、各機能のディレクトリに置きます。
- **依存の向き**: 機能 → 共通 の向きだけにします。共通(`platform/`・`_shared/`)から特定の機能を参照してはいけません。
- **巨大な共通クラスを作らない**: 何でも対応する BaseService・CRUD Factory などは作りません。
- **変更してはいけないもの**(ユーザーの指示が無い限り): DB の migration、API の仕様、認証・認可、Cloudflare の設定。詳しくは [CLAUDE.md](../../CLAUDE.md) を参照してください。

各パッケージでの具体的なルールは、[バックエンドの構造](backend.md)・[フロントエンドの構造](frontend.md) にあります。
