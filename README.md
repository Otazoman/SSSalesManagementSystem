# Sales Management System

中小規模事業者向けの販売管理システムです。見積から受注・出荷・売上・請求・入金まで、発注から入荷・仕入・支払まで、
在庫管理、承認ワークフローを1つのWebアプリケーションで扱います。Cloudflare Workers 上で動作します。

- **オープンソース(MIT License)**: 商用を含め、自由に使用・改変・再配布できます([12章](#12-ライセンス))。
- **Cloudflare の無料プランで動く構成**: サーバーの管理は不要で、Workers・D1・R2・KV だけで動きます。
- **スマートフォン・タブレットにも対応**: 倉庫での入出庫などを、手元の端末で操作できます。

| 知りたいこと | 参照先 |
|---|---|
| 自分の PC で動かしたい | [3章 ローカル開発環境の構築](#3-ローカル開発環境の構築) |
| Cloudflare に公開したい | [4〜6章](#4-cloudflare-の準備staging本番共通最初に1回だけ) |
| 設計・DB 構造・開発のルールを知りたい | [docs/README.md(ドキュメントの一覧)](docs/README.md) |
| 開発に参加したい | [13章 開発に参加する](#13-開発に参加する) |

## 目次

1. [概要](#1-概要)
2. [構築の全体像](#2-構築の全体像)
3. [ローカル開発環境の構築](#3-ローカル開発環境の構築)
4. [Cloudflare の準備(Staging・本番共通、最初に1回だけ)](#4-cloudflare-の準備staging本番共通最初に1回だけ)
5. [Staging の構築](#5-staging-の構築)
6. [本番の構築](#6-本番の構築)
7. [更新のデプロイ(2回目以降)](#7-更新のデプロイ2回目以降)
8. [問題が起きたとき(ロールバック)](#8-問題が起きたときロールバック)
9. [開発時によく使うコマンド](#9-開発時によく使うコマンド)
10. [リリースタグの作成](#10-リリースタグの作成)
11. [参考資料](#11-参考資料)
12. [ライセンス](#12-ライセンス)
13. [開発に参加する](#13-開発に参加する)

---

## 1. 概要

### 主な機能

| 分類 | 機能 |
|---|---|
| 販売 | 商談、見積、受注、売上、請求、入金・消込、前受金 |
| 購買 | 購買申請、発注、仕入、検収、支払・消込、前払金 |
| 在庫 | 入荷指示・入庫、出荷指示・出庫、倉庫間移動、在庫照会、棚卸、破損・廃棄・返品、引当 |
| 承認 | 伝票ごとの承認ワークフロー(多段承認、差戻し、一括承認、申請経路のプレビュー) |
| 帳票 | 見積書・注文請書・納品書・請求書・発注書・検収書などのPDF出力、メール送信、OTP付きダウンロード |
| 会計連携 | 仕訳の自動作成・出力 |
| マスタ | 取引先・取引先担当者・納品先、商品・単価・構成、倉庫・ロケーション、勘定科目、組織・ユーザー・権限 など |
| その他 | 進捗確認、監査ログ、CSV入出力、スマートフォン・タブレット対応 |

### システム構成

```text
ブラウザ
  │  /api/* を呼び出す(cookie付き)
  ▼
Frontend Worker   packages/frontend   画面(Next.js の静的ファイル)+ proxy.ts   ← 公開(ブラウザからアクセスする)
  │  ログイン状態を確認し、/api/* を Backend へ転送する(API_KEY はここで付与し、ブラウザには出さない)
  │  転送は Service Binding(Worker 同士の直接接続。URL は使わない)
  ▼
Backend Worker    packages/backend    API(Hono + Drizzle ORM)                ← 非公開(Frontend からしか呼べない)
  │
  ▼
D1(データベース)/ R2(帳票・添付ファイル)/ KV(会社設定・権限キャッシュ)/ Secrets Store(秘密の値)
```

- Frontend と Backend は**別々の Worker** で、それぞれデプロイします。**デプロイは必ず Backend → Frontend の順**です
  (Frontend は Backend に直接つながるため、Backend が先に存在している必要があります)。
- Backend には公開 URL がありません(`workers_dev: false`)。外部からは Frontend の URL だけでアクセスします。
- Cloudflare の無料プランで動作する構成です。

### 使用技術

| 範囲 | 技術 |
|---|---|
| Frontend | Next.js 16 / React 19 / Tailwind CSS 4 |
| Backend | Hono / Drizzle ORM / Valibot / pdf-lib / ExcelJS |
| 実行基盤 | Cloudflare Workers・D1・R2・KV・Secrets Store |
| インフラ管理 | Terraform(D1・R2・KV の作成)、wrangler(Worker のデプロイ・Secrets Store) |
| テスト | Vitest(Workers ランタイム・jsdom・Playwright によるブラウザテスト) |
| ツール管理 | mise(Node.js 24 / Python 3.12 / Terraform 1.16。`mise.toml` で固定) |

### ディレクトリ構成

```text
/
├─ packages/
│  ├─ frontend/     画面(Next.js)と Frontend Worker(proxy.ts)
│  └─ backend/      API(Hono)、DB定義(src/db)、migration(drizzle/)
├─ infra/
│  ├─ terraform/    Cloudflare のリソース定義(environments/staging・production)
│  └─ scripts/      wrangler.jsonc を作るスクリプト(sync-wrangler.mjs)
├─ docs/            設計ドキュメント(architecture / backend / frontend / glossary など)
├─ fonts/ company/  帳票用のフォント・ロゴ・印影
├─ sampledata/      取込用サンプルCSV(架空データ)
└─ samplereport/    帳票テンプレートのサンプル(架空データ)
```

### Worker の設定ファイル(wrangler.jsonc)について

`packages/backend`・`packages/frontend` の `wrangler.jsonc` は、Cloudflare のリソースの実ID(データベースIDなど)を含むため、
**Git では管理せず、ひな形(`wrangler.jsonc.example`)からコマンドで作ります**。

```bash
# リポジトリのルートで
node infra/scripts/sync-wrangler.mjs            # 何が埋め込まれるかの確認だけ
node infra/scripts/sync-wrangler.mjs --write    # wrangler.jsonc を作る(上書き)
```

- Terraform で作成済みの環境(本番・Staging)があれば、その実IDを埋め込みます。無ければ仮の値のまま作ります(ローカル開発は仮の値で動きます)。
- Secrets Store のストアIDは、初回だけ `--store-id <ストアID>` で指定します(以降は今の `wrangler.jsonc` から引き継ぎます)。
- 設定(バインディングなど)を変えるときは、`wrangler.jsonc` ではなく **`wrangler.jsonc.example` を編集**し、このコマンドで作り直します。
- 実IDを埋め込んでも、ローカル開発のデータはそのまま使えます(ローカル用のIDを `preview_database_id` / `preview_id` で固定しているため)。

---

## 2. 構築の全体像

環境は3つあります。上から順に構築してください。

| 環境 | 目的 | 動く場所 | 手順 |
|---|---|---|---|
| ローカル開発環境 | 開発・テスト | 自分のPC / Codespaces | [3章](#3-ローカル開発環境の構築) |
| Staging | 本番に出す前の動作確認 | Cloudflare | [4章](#4-cloudflare-の準備staging本番共通最初に1回だけ) → [5章](#5-staging-の構築) |
| 本番 | 実際の業務で使う | Cloudflare | [4章](#4-cloudflare-の準備staging本番共通最初に1回だけ)(済みなら不要)→ [6章](#6-本番の構築) |

Staging と本番は**同じ Cloudflare アカウントの中に、別々のリソースとして**作ります。

> **⚠ wrangler のコマンドは、`--env staging` を付けると Staging、付けないと本番が対象です。**
> 付け忘れると本番に反映されます。本番の Worker がまだ無い場合は、`wrangler secret put` などを実行しただけで
> **本番用の空の Worker が作られてしまう**ので、実行前に必ず確認してください。

### Staging と本番の指定方法(コマンドごと)

| 作業 | Staging | 本番 | 実行する場所 |
|---|---|---|---|
| Worker のデプロイ | `npx wrangler deploy --env staging` | `npx wrangler deploy` | `packages/backend` → `packages/frontend` の順 |
| Worker の Secret の登録 | `npx wrangler secret put <名前> --env staging` | `npx wrangler secret put <名前>` | `packages/backend` |
| DB の migration | `npx wrangler d1 migrations apply <DB> --env staging --remote` | `npx wrangler d1 migrations apply <DB> --remote` | `packages/backend` |
| ログの確認 | `npx wrangler tail --env staging` | `npx wrangler tail` | 各 `packages/*` |
| ロールバック | `npx wrangler rollback --env staging` | `npx wrangler rollback` | 各 `packages/*` |
| R2 へのアップロード | バケット名 `system-staging/...` を指定 | バケット名 `system/...` を指定 | どこでも(`--remote` を付ける) |
| Secrets Store の登録 | 名前の末尾に `_STAGING`(例 `API_KEY_STAGING`) | 名前そのまま(例 `API_KEY`) | どこでも(`--remote` を付ける) |
| Terraform | `infra/terraform/environments/staging` で実行 | `infra/terraform/environments/production` で実行 | 各フォルダ |
| `wrangler.jsonc` の作成 | 環境の指定は不要(本番・Staging の両方をまとめて作る) | 同左 | リポジトリのルート |

> `--remote` は「Cloudflare 上のリソースを対象にする」という意味で、Staging・本番の区別とは別です。
> 付けないとローカル(PC の中)が対象になります。

### Staging と本番の名前の違い

| 項目 | Staging | 本番 |
|---|---|---|
| Frontend Worker(公開 URL) | `my-erp-frontend-staging` | `my-erp-frontend` |
| Backend Worker(非公開) | `my-erp-backend-staging` | `my-erp-backend` |
| D1(業務データ) | `my-erp-db-staging` | `my-erp-db` |
| D1(ログ・OTP・仕訳・商談・UI) | `my-erp-shared-db-staging`(1つにまとめている) | `my-erp-log-db` など5つ |
| R2(フォント・ロゴ等) | `system-staging` | `system` |
| Secrets Store の名前 | `API_KEY_STAGING` など(末尾に `_STAGING`) | `API_KEY` など |

> Staging の D1 を1つにまとめているのは、無料プランの D1 が1アカウント10個までのためです(詳しくは `infra/README.md`)。

### 構築中に控えておく値

構築の途中で出てくる値です。メモ帳などに控えながら進めてください。**秘密の値(★)はGitやチャットに書かないでください。**

| 値 | どこで分かるか | 使う場所 |
|---|---|---|
| アカウントID | 4-3 | Terraform の設定ファイル |
| ストアID(Secrets Store) | 4-5 | wrangler.jsonc、Secret の登録 |
| ★ API_KEY / SESSION_SECRET / SETUP_TOKEN | 自分で決める(長いランダムな文字列) | Secret の登録、初期管理者の作成 |
| Frontend の URL | Frontend のデプロイ時に表示される | URL の Secret の登録、ブラウザでのアクセス |

ランダムな文字列は、次のコマンドで作れます。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. ローカル開発環境の構築

Cloudflare のアカウントがなくても、ローカルだけで動かせます(D1・R2・KV は PC 上で再現されます)。

### 3-1. 開発環境を用意する

次の2つの方法があります。どちらか一方を選んでください。3-2 以降の手順は共通です。

| 方法 | 特徴 | 向いている人 |
|---|---|---|
| A. GitHub Codespaces | ブラウザだけで開発できる。PCへのインストールが不要 | すぐに始めたい人、PCの環境を汚したくない人 |
| B. ローカルPC + mise | 自分のPCで動かす。動作が速く、オフラインでも使える | 普段使いの開発環境にしたい人 |

どちらの方法でも、ツール(Node.js・Python・Terraform)のバージョンは `mise.toml` で固定しているので、**mise で揃えます**。

#### 方法A: GitHub Codespaces

1. GitHub のリポジトリのページで **Code** → **Codespaces** → **Create codespace on main** を押します。
   ブラウザで VS Code が開きます(初回は数分かかります)。
2. VS Code 下部のターミナルで、mise を入れてツールを揃えます。

```bash
curl https://mise.run | sh
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
source ~/.bashrc
mise trust
mise install
node -v        # v24 と表示されれば OK
```

3. 3-2 に進みます。

> - コマンドは、Codespace のフォルダ(`/workspaces/<リポジトリ名>`)で実行します。ターミナルを開いたときの場所です。
> - 起動した画面(3-6)は、VS Code の **PORTS** タブで `8788` の行の地球儀アイコンを押すと、ブラウザで開けます。
> - Codespace は一定時間使わないと自動で停止します。GitHub の Codespaces 一覧から再開でき、ファイルやローカルDBはそのまま残ります。
> - 無料で使える時間には上限があります。使い終わったら Codespace を停止してください。

#### 方法B: ローカルPC + mise(Windows)

PowerShell を開いて実行します。

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser   # 初回のみ
winget install jdx.mise
winget install Git.Git        # Git が未導入の場合
```

インストール後、**PowerShell を開き直してから**続けます。

```powershell
git clone <リポジトリのURL>
cd <クローンしたフォルダ>
& mise activate pwsh | Out-String | Invoke-Expression
mise trust
mise install
node -v        # v24 と表示されれば OK
```

mise は PowerShell を開くたびに有効にする必要があります。毎回打たなくて済むよう、PowerShell のプロファイルに追記しておきます。

```powershell
if (!(Test-Path $PROFILE)) { New-Item -Type File -Path $PROFILE -Force }; notepad $PROFILE
# メモ帳に次の1行を追記して保存
& mise activate pwsh | Out-String | Invoke-Expression
```

> - この README のコマンドは PowerShell でもそのまま動きます。環境変数の設定(`export`)だけは書き方が違うため、PowerShell 用を併記しています。

Mac・Linux の場合は、`git clone` した後、方法A の手順2のコマンドで同じように揃えられます。

### 3-2. 依存パッケージをインストールする

```bash
cd packages/backend
npm install
cd ../frontend
npm install
```

### 3-3. ローカル用の設定ファイルを作る(wrangler.jsonc・.dev.vars)

まず、Worker の設定ファイル `wrangler.jsonc` をひな形から作ります(Git管理外)。

```bash
# リポジトリのルートで
node infra/scripts/sync-wrangler.mjs --write
```

次に `.dev.vars` を作ります。ローカル専用の設定ファイルです(Git管理外。Staging・本番には使われません)。

```bash
cd packages/backend
cp .dev.vars.example .dev.vars
```

`packages/backend/.dev.vars` を開き、次のように書きます。

```text
FRONTEND_URL=http://localhost:8788
FRONTEND_BASE_URL=http://localhost:8788
```

Frontend の `.dev.vars` は不要です(Frontend から Backend へは、URL ではなく Service Binding でつながるため)。

### 3-4. ローカル用の秘密の値を登録する

`API_KEY`・`SESSION_SECRET`・`SETUP_TOKEN` は `.dev.vars` ではなく、Secrets Store という仕組みで読み込みます。
`--remote` を付けずに実行すると、**PC の中だけに保存されます**(Cloudflare には送られません)。

- 実行すると値の入力を求められます。ローカル用なので、テスト用の適当な値で構いません。
- `API_KEY` と `SESSION_SECRET` は、**backend と frontend で同じ値**を入れてください。

> **⚠ ローカルの値は「`wrangler.jsonc` の `store_id`」ごとに保存されます。**
> コマンドの `<ストアID>` には、**今の `wrangler.jsonc` に書かれている `store_id`** を入れてください。
> - ローカル開発だけの場合: `SECRETS_STORE_ID_PLACEHOLDER`(仮の値)のままです。
> - Staging・本番を構築した後(4-6 で実際のストアIDを埋め込んだ後)は、そのストアIDです。
>   **ストアIDが変わったら、この手順をもう一度行ってください**(行わないと、ローカルで `/api/*` が 500 エラーになります)。

今の `store_id` は、次のコマンドで確認できます(値は秘密ではありません)。

```bash
# リポジトリのルートで(Git Bash / Linux / Mac)
grep -m1 -o '"store_id": "[^"]*"' packages/backend/wrangler.jsonc
```

```powershell
# PowerShell
Select-String -Path packages/backend/wrangler.jsonc -Pattern '"store_id": "([^"]*)"' | Select-Object -First 1
```

確認した値を `<ストアID>` に入れて登録します。

```bash
cd packages/backend
npx wrangler secrets-store secret create <ストアID> --name API_KEY --scopes workers
npx wrangler secrets-store secret create <ストアID> --name SESSION_SECRET --scopes workers
npx wrangler secrets-store secret create <ストアID> --name SETUP_TOKEN --scopes workers

cd ../frontend
npx wrangler secrets-store secret create <ストアID> --name API_KEY --scopes workers
npx wrangler secrets-store secret create <ストアID> --name SESSION_SECRET --scopes workers
```

### 3-5. ローカルのDBを作る

```bash
cd packages/backend
npm run db:migrate-main      # 業務データ
npm run db:migrate-log       # 監査ログ
npm run db:migrate-otp       # OTP
npm run db:migrate-journal   # 仕訳
npm run db:migrate-deals     # 商談
npm run db:migrate-ui        # UI設定・お知らせ等
```

### 3-6. 起動する

ターミナルを2つ開きます。

ターミナルを2つ開き、**Backend → Frontend の順**に起動します。

```bash
# ターミナル1: Backend(http://localhost:8787)
cd packages/backend
npm run dev
```

```bash
# ターミナル2: Frontend(http://localhost:8788)
cd packages/frontend
npm run build
npx wrangler dev --port 8788
```

Frontend は、同じ PC で起動中の Backend に自動でつながります。Frontend の起動時に次のように表示されれば接続できています。

```text
env.BACKEND (my-erp-backend)    Worker    local [connected]
```

`[not connected]` と表示される場合は、Backend が起動していません(API がエラーになります)。先に Backend を起動してください。

画面のコードを変更したら、ターミナル2を止めて `npm run build` からやり直してください。

### 3-7. 初期設定をする

1. ブラウザで http://localhost:8788 を開きます。最初は初期管理者の作成画面が表示されます。
   3-4 で登録した `SETUP_TOKEN` の値を入力し、管理者のユーザーを作成します。
2. 作成した管理者でログインし、管理画面の「メール送信設定」→ アセット管理から、帳票用のファイルをアップロードします。
   - フォント: `fonts/LINESeedJP_TTF_Rg.ttf`
   - ロゴ: `company/company_logo.png`
   - 印影: `company/company_seal.png`
3. マスタを次の順に登録します(後のマスタが前のマスタを使うため)。
   - 組織 → ロール → ユーザー → 画面権限・承認フロー
   - 取引先 → 取引先担当者
   - 勘定科目 → 単位 → 商品 → 商品単価・商品構成
   - 倉庫 → ロケーション

サンプルデータ(`sampledata/`、架空データ)をCSVで取り込むこともできます。取込順は `sampledata/README.md` を参照してください。

**これでローカル開発環境の構築は完了です。**

- API ドキュメント(Swagger UI): ログインした状態で http://localhost:8788/api/docs を開く。
  **開発環境専用**です(`packages/backend/.dev.vars` の `ENABLE_API_DOCS=true` の時だけ表示され、Staging・本番では表示されません)。
- Cron(メール送信キューの処理など)を手動で動かす: `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`

---

## 4. Cloudflare の準備(Staging・本番共通、最初に1回だけ)

Staging・本番を作る前に、1回だけ行う準備です。**すでに済んでいる場合は飛ばしてください。**
コマンドはすべて**リポジトリのルートフォルダ**から始めます。

### 4-1. Cloudflare のアカウントを用意する

1. https://dash.cloudflare.com/sign-up でアカウントを作成します(無料プランで構いません)。
2. ダッシュボードの「Workers & Pages」を一度開き、`workers.dev` のサブドメインを登録します
   (デプロイした Worker は `https://<Worker名>.<サブドメイン>.workers.dev` で公開されます)。
3. ダッシュボードの「R2 Object Storage」を開き、R2 を有効にします
   (無料枠の範囲で使う場合でも、支払い方法の登録を求められることがあります)。

### 4-2. wrangler で Cloudflare にログインする

```bash
cd packages/backend
npx wrangler login       # ブラウザが開くので「Allow」を押す
npx wrangler whoami      # ログインしたアカウント名とアカウントIDが表示される
cd ../..
```

> **Codespaces の場合**: `wrangler login` はブラウザでの許可の後、`localhost` の画面に戻って完了する仕組みのため、
> Codespaces では完了しないことがあります。その場合は、表示された `localhost:8976/...` のURLを丸ごとコピーし、
> Codespace の**新しいターミナル**で `curl "<コピーしたURL>"` を実行すると完了します。

### 4-3. アカウントIDを控える

`npx wrangler whoami` に表示される `Account ID` を控えます
(ダッシュボードの「Workers & Pages」画面の右側でも確認できます)。

### 4-4. Terraform 用の API トークンを作る

Terraform が Cloudflare にリソースを作るための鍵です。

1. ダッシュボード右上のアイコン → **My Profile** → **API Tokens** → **Create Token** → **Custom token** の「Get started」
2. **Permissions** に次の3つを追加します(すべて `Account` の範囲)。
   - `D1` : `Edit`
   - `Workers R2 Storage` : `Edit`
   - `Workers KV Storage` : `Edit`
3. **Account Resources** で自分のアカウントを選び、「Continue to summary」→「Create Token」
4. 表示されたトークンを控えます(**この画面を閉じると二度と表示されません**)。

トークンはファイルに書かず、ターミナルの環境変数で渡します。**ターミナルを開き直したら、もう一度設定してください。**

```bash
# Git Bash / Linux / Mac
export CLOUDFLARE_API_TOKEN="(作成したトークン)"
```

```powershell
# PowerShell
$env:CLOUDFLARE_API_TOKEN = "(作成したトークン)"
```

### 4-5. 秘密の値の保存場所(Secrets Store)を用意する

Secrets Store は**1アカウントに1つしか作れない**ため、Staging・本番で共用します。
Cloudflare は、ストアが無いアカウントでダッシュボードの Secrets Store 画面を開くなどすると、`default_secrets_store` という
名前のストアを**自動で作ります**。そのため、Terraform では管理せず、wrangler のコマンドで確認・作成します。

```bash
cd packages/backend
npx wrangler secrets-store store list --remote     # 既存のストアの一覧(Name と ID が表示される)
```

- **一覧にストアがある場合**: そのストアの `ID` を控えます(作成は不要です)。
- **一覧が空の場合**: 次のコマンドで作成し、表示された `ID` を控えます。

```bash
npx wrangler secrets-store store create default_secrets_store --remote
```

```bash
cd ../..
```

> ストアを削除すると、登録した秘密の値がすべて消えます。ダッシュボードなどで削除しないでください。

### 4-6. ストアIDを wrangler.jsonc に埋め込む

4-5 で控えたストアIDを指定して、`wrangler.jsonc` を作り直します(backend・frontend の両方に埋め込まれます)。

```bash
# リポジトリのルートで
node infra/scripts/sync-wrangler.mjs --store-id <ストアID> --write
```

ストアIDは今の `wrangler.jsonc` に保存されるので、次回からは `--store-id` を付けなくても引き継がれます。

> **⚠ ローカル開発をする場合は、ここで [3-4](#3-4-ローカル用の秘密の値を登録する) をもう一度行ってください。**
> ローカルの秘密の値は `store_id` ごとに保存されているため、ストアIDを埋め込んだ後は、そのIDで登録し直す必要があります。

**これで Cloudflare の準備は完了です。**

---

## 5. Staging の構築

本番に出す前の確認用の環境を作ります。

> **⚠ wrangler のコマンドには、すべて `--env staging` を付けます。**(下のコマンドには付けてあります)
> Secrets Store の名前は末尾に `_STAGING`、R2 のバケット名は末尾に `-staging` です。

4章を先に済ませ、`CLOUDFLARE_API_TOKEN` を設定したターミナルで、リポジトリのルートから始めます。

### 5-1. リソース(D1・R2・KV)を作る

```bash
cd infra/terraform/environments/staging          # ← Staging のフォルダ
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` を開き、次のように書きます。**配置地域は作成後に変更できません**(日本で使うなら `apac`)。

```hcl
account_id       = "(4-3 で控えたアカウントID)"
d1_location_hint = "apac"
r2_location      = "apac"
```

```bash
mise exec -- terraform init
mise exec -- terraform plan     # 作成されるものの一覧を確認
mise exec -- terraform apply    # 確認して yes と入力
cd ../../../..
```

> **⚠ Terraform 用のトークンを外してから進めます。** wrangler は、環境変数 `CLOUDFLARE_API_TOKEN` があると `wrangler login` の代わりにそのトークンを使います。
> Terraform 用のトークン(D1・R2・KV の権限のみ)のままだと、Worker のデプロイなどが権限不足で失敗します。
>
> ```bash
> unset CLOUDFLARE_API_TOKEN                  # Git Bash / Linux / Mac
> Remove-Item Env:CLOUDFLARE_API_TOKEN        # PowerShell
> ```

### 5-2. 作成したリソースの ID を wrangler.jsonc に埋め込む

```bash
node infra/scripts/sync-wrangler.mjs            # 「staging: あり」と表示され、実IDが埋め込まれることを確認
node infra/scripts/sync-wrangler.mjs --write    # wrangler.jsonc を作り直す
```

### 5-3. 秘密の値を登録する

`<ストアID>` を 4-5 で控えた値に置き換えて実行します。値の入力を求められるので、**本番とは別の**ランダムな文字列を入れてください。

```bash
npx wrangler secrets-store secret create <ストアID> --name API_KEY_STAGING --scopes workers --remote
npx wrangler secrets-store secret create <ストアID> --name SESSION_SECRET_STAGING --scopes workers --remote
npx wrangler secrets-store secret create <ストアID> --name SETUP_TOKEN_STAGING --scopes workers --remote
```

### 5-4. DB のテーブルを作る

```bash
cd packages/backend
npx wrangler d1 migrations apply DB         --env staging --remote
npx wrangler d1 migrations apply DB_LOG     --env staging --remote
npx wrangler d1 migrations apply DB_OTP     --env staging --remote
npx wrangler d1 migrations apply DB_JOURNAL --env staging --remote
npx wrangler d1 migrations apply DB_DEALS   --env staging --remote
npx wrangler d1 migrations apply DB_UI      --env staging --remote
```

それぞれ確認を求められたら `y` を入力します。

### 5-5. Backend をデプロイする(先に Backend)

```bash
# packages/backend にいる状態で
npx wrangler deploy --env staging
```

Backend は非公開のため、URL は表示されません(`Deployed my-erp-backend-staging triggers` と表示されれば成功です)。

### 5-6. Frontend をデプロイする

```bash
cd ../frontend
npm run build
npx wrangler deploy --env staging
```

表示される URL(`https://my-erp-frontend-staging.<サブドメイン>.workers.dev`)を控えます。
表示の中に `env.BACKEND (my-erp-backend-staging)` があれば、Staging の Backend につながっています。

### 5-7. Frontend の URL を Backend に登録する

5-6 で控えた Frontend の URL を、Backend に登録します(末尾の `/` は付けません)。登録するとすぐに反映されます。

```bash
cd ../backend
npx wrangler secret put FRONTEND_URL --env staging         # Frontend の URL を入力(このURLからのアクセスだけを許可する)
npx wrangler secret put FRONTEND_BASE_URL --env staging    # Frontend の URL を入力(通知メール内のリンクに使う)
cd ../..
```

### 5-8. 帳票用のフォント・ロゴ・印影をアップロードする

```bash
# リポジトリのルートで(バケット名は system-staging)
npx wrangler r2 object put system-staging/fonts/company_fonts.ttf  --file=fonts/LINESeedJP_TTF_Rg.ttf --content-type=font/ttf  --remote
npx wrangler r2 object put system-staging/company/company_logo.png --file=company/company_logo.png  --content-type=image/png --remote
npx wrangler r2 object put system-staging/company/company_seal.png --file=company/company_seal.png  --content-type=image/png --remote
```

(初期管理者の作成後に、管理画面の「メール送信設定」→ アセット管理からアップロードしても同じです。)

### 5-9. 初期管理者を作成して動作を確認する

1. ブラウザで Frontend の URL を開くと、初期管理者の作成画面(「初期設定：最初の管理者登録」)が表示されます。
2. 5-3 で登録した `SETUP_TOKEN_STAGING` の値を入力し、管理者を作成します。
   初期管理者は、**メールアドレスでだけ**ログインできます(従業員番号 `admin` は推測しやすいため、従業員番号ではログインできません)。
3. ログインし、3-7 の手順3の順でマスタを登録して、画面や帳票PDFが動くことを確認します。

ログイン画面のままで初期設定画面が出ない・画面にエラーが出る場合は、[11-2 困ったとき](#11-2-困ったとき)を参照してください。

**これで Staging の構築は完了です。**

---

## 6. 本番の構築

Staging と同じ流れです。

> **⚠ wrangler のコマンドに `--env staging` を付けません。**
> Terraform のフォルダは `production`、Secrets Store の名前・R2 のバケット名に `_STAGING` / `-staging` は付きません。

4章を先に済ませ(Staging で済んでいれば不要)、`CLOUDFLARE_API_TOKEN` を設定したターミナルで、リポジトリのルートから始めます。

### 6-1. リソース(D1・R2・KV)を作る

```bash
cd infra/terraform/environments/production       # ← 本番のフォルダ
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` を開き、次のように書きます。**配置地域は作成後に変更できません。**

```hcl
account_id       = "(4-3 で控えたアカウントID)"
d1_location_hint = "apac"
r2_location      = "apac"
```

```bash
mise exec -- terraform init
mise exec -- terraform plan     # 作成されるものの一覧を確認
mise exec -- terraform apply    # 確認して yes と入力
cd ../../../..
```

> **⚠ Terraform 用のトークンを外してから進めます。** wrangler は、環境変数 `CLOUDFLARE_API_TOKEN` があると `wrangler login` の代わりにそのトークンを使います。
> Terraform 用のトークン(D1・R2・KV の権限のみ)のままだと、Worker のデプロイなどが権限不足で失敗します。
>
> ```bash
> unset CLOUDFLARE_API_TOKEN                  # Git Bash / Linux / Mac
> Remove-Item Env:CLOUDFLARE_API_TOKEN        # PowerShell
> ```

### 6-2. 作成したリソースの ID を wrangler.jsonc に埋め込む

```bash
node infra/scripts/sync-wrangler.mjs            # 「production: あり」と表示され、実IDが埋め込まれることを確認
node infra/scripts/sync-wrangler.mjs --write    # wrangler.jsonc を作り直す(Staging の実IDもそのまま埋め込まれる)
```

### 6-3. 秘密の値を登録する

**Staging とは別の**ランダムな文字列を入れてください。

```bash
npx wrangler secrets-store secret create <ストアID> --name API_KEY --scopes workers --remote
npx wrangler secrets-store secret create <ストアID> --name SESSION_SECRET --scopes workers --remote
npx wrangler secrets-store secret create <ストアID> --name SETUP_TOKEN --scopes workers --remote
```

### 6-4. DB のテーブルを作る

```bash
cd packages/backend
npx wrangler d1 migrations apply DB         --remote
npx wrangler d1 migrations apply DB_LOG     --remote
npx wrangler d1 migrations apply DB_OTP     --remote
npx wrangler d1 migrations apply DB_JOURNAL --remote
npx wrangler d1 migrations apply DB_DEALS   --remote
npx wrangler d1 migrations apply DB_UI      --remote
```

### 6-5. Backend をデプロイする(先に Backend)

```bash
# packages/backend にいる状態で
npx wrangler deploy
```

Backend は非公開のため、URL は表示されません。

### 6-6. Frontend をデプロイする

```bash
cd ../frontend
npm run build
npx wrangler deploy
```

表示される URL(`https://my-erp-frontend.<サブドメイン>.workers.dev`)を控えます。
表示の中に `env.BACKEND (my-erp-backend)` があれば、本番の Backend につながっています。

### 6-7. Frontend の URL を Backend に登録する

```bash
cd ../backend
npx wrangler secret put FRONTEND_URL         # Frontend の URL を入力
npx wrangler secret put FRONTEND_BASE_URL    # Frontend の URL を入力
cd ../..
```

### 6-8. 帳票用のフォント・ロゴ・印影をアップロードする

```bash
# リポジトリのルートで(バケット名は system)
npx wrangler r2 object put system/fonts/company_fonts.ttf  --file=fonts/LINESeedJP_TTF_Rg.ttf --content-type=font/ttf  --remote
npx wrangler r2 object put system/company/company_logo.png --file=company/company_logo.png  --content-type=image/png --remote
npx wrangler r2 object put system/company/company_seal.png --file=company/company_seal.png  --content-type=image/png --remote
```

### 6-9. 初期管理者を作成する

1. ブラウザで Frontend の URL を開き、6-3 で登録した `SETUP_TOKEN` の値を入力して管理者を作成します。
   初期管理者は、**メールアドレスでだけ**ログインできます(従業員番号 `admin` は推測しやすいため、従業員番号ではログインできません)。
2. 3-7 の手順3の順でマスタを登録します。

**これで本番の構築は完了です。**

独自ドメイン(例: `sms.example.com`)で公開したい場合は、ダッシュボードの Frontend Worker の「Settings」→「Domains & Routes」で追加し、
そのURLで 6-7 の `FRONTEND_URL`・`FRONTEND_BASE_URL` を登録し直してください(Backend は非公開のままで構いません)。

---

## 7. 更新のデプロイ(2回目以降)

コードを更新したときの手順です。**必ず Staging で 7-1〜7-5 を行って確認してから、本番で同じ手順を行います。**
反映前のチェックや、変更の内容によって追加で必要な作業は、[変更を反映する流れ](docs/development/release.md) にまとめています。
下のコマンドは Staging 用です。**本番では `--env staging` を外してください**(指定方法は [2章の表](#staging-と本番の指定方法コマンドごと))。

### 7-1. 最新のコードを取得し、テストする

```bash
git pull
node infra/scripts/sync-wrangler.mjs --write    # wrangler.jsonc.example の変更を反映する
cd packages/backend
npm install
npx tsc --noEmit
npm test
cd ../frontend
npm install
npx tsc --noEmit
npm test
cd ../..
```

### 7-2. 新しい migration があれば適用する

**Backend をデプロイする前に**適用します(新しいコードが新しいテーブル・列を使うため)。
適用した migration は元に戻せないので、未適用のファイル(`packages/backend/drizzle/<DB>/` の `.sql`)の中身を先に確認してください。

```bash
cd packages/backend
npx wrangler d1 migrations list DB --env staging --remote     # 未適用の一覧が表示される
npx wrangler d1 migrations apply DB --env staging --remote    # 未適用があれば適用する
```

`DB` 以外(`DB_LOG`・`DB_OTP`・`DB_JOURNAL`・`DB_DEALS`・`DB_UI`)も同じように確認します。

### 7-3. Backend をデプロイする(先に Backend)

```bash
# packages/backend にいる状態で
npx wrangler deploy --env staging
```

### 7-4. Frontend をデプロイする

```bash
cd ../frontend
npm run build
npx wrangler deploy --env staging
```

### 7-5. 動作を確認する

- ログインできる
- 変更した画面・機能が動く
- 帳票PDFを出力できる

エラーの内容は、次のコマンドでリアルタイムに確認できます(`packages/backend`・`packages/frontend` それぞれで実行)。

```bash
npx wrangler tail --env staging
```

---

## 8. 問題が起きたとき(ロールバック)

デプロイした Worker を、1つ前のバージョンに戻せます(`packages/backend`・`packages/frontend` それぞれで実行)。

```bash
npx wrangler deployments list --env staging    # これまでのデプロイ履歴
npx wrangler rollback --env staging            # 1つ前に戻す
```

- Worker を戻しても、**D1 のデータと適用済みの migration は戻りません**。
- D1 は Time Travel で過去の時点に戻せます(無料プランは過去7日分)。
  ただし、**戻した時点より後に登録されたデータはすべて消える**ため、最後の手段にしてください。

```bash
npx wrangler d1 time-travel info DB --env staging
npx wrangler d1 time-travel restore DB --env staging --timestamp=<UNIXタイムスタンプ>
```

---

## 9. 開発時によく使うコマンド

テストの書き方・ルールは [テストの実施方法とルール](docs/development/testing.md) を参照してください。

### ビルド・Lint・型チェック

```bash
# Frontend
cd packages/frontend
npm run lint
npm run build
npx tsc --noEmit

# Backend(lint スクリプトはありません)
cd packages/backend
npx tsc --noEmit
npx wrangler deploy --dry-run    # デプロイ内容の確認だけ(実際にはデプロイしない)
```

### テスト(Vitest)

```bash
# Backend(Workers ランタイム上で実行。D1 はテスト用のインメモリ)
cd packages/backend
npm test                                         # 全件
npm run test:watch                               # 変更を監視して再実行
npx vitest run test/sampledata-import.test.ts    # 1ファイルだけ
npx vitest run -t "入金消込"                      # テスト名で絞り込み

# Frontend(node 用と React(jsdom)用の2構成を続けて実行)
cd packages/frontend
npm test
npm run test:watch
npx vitest run --config vitest.config.react.mts app/sales/deals   # フォルダ・ファイルを指定
```

### 画面幅別の表示確認(実ブラウザ)

スマートフォン 375px・タブレット 768px・PC 1280px で表示を確認します。対象は `app/**/*.browser.test.tsx` です(`npm test` には含まれません)。

```bash
cd packages/frontend
npx playwright install chromium    # 初回のみ
npm run test:browser
```

### DBスキーマを変更したとき(migration の作成)

`packages/backend/src/db/` のスキーマを変更したら、migration を生成してローカルに適用します。
**既存の migration ファイル(`packages/backend/drizzle/`)は編集・削除しないでください。**
生成された SQL は、適用前に必ず中身を確認してください。

```bash
cd packages/backend
npm run db:generate-main    # migration を生成(log / otp / journal / deals / ui も同様)
npm run db:migrate-main     # ローカルに適用
npm run db:push-main        # 生成+適用をまとめて実行
npm run db:push             # 全DBをまとめて生成+適用
```

スキーマを変更したら、DB のドキュメント(`docs/database/`)も作り直します。テーブルを追加した場合は、
`packages/backend/scripts/db-docs/catalog.mjs` にテーブルの日本語名・説明も追加します(詳しくは [DB 構造](docs/database/README.md#更新方法))。

```bash
# リポジトリのルートで
node packages/backend/scripts/db-docs/generate-db-docs.mjs
```

ローカルDBを作り直す場合は、ローカルのDBファイル(`packages/backend/.wrangler/state/v3/d1`)を削除して 3-5 をやり直してください。
**`npm run db:reset`・`npm run db:rebuild` は `drizzle/` フォルダ(migration)ごと削除する**ので使わないでください。

### サンプルデータの再生成

```bash
python sampledata/generate_sampledata.py
cd packages/backend
npx vitest run test/sampledata-import.test.ts test/sample-report-templates.test.ts   # 取り込めるか確認
```

---

## 10. リリースタグの作成

リリースの区切りには [Semantic Versioning](https://semver.org/lang/ja/)(`vX.Y.Z`)に沿った annotated tag を付与する。

```bash
# リポジトリのルートで、タグを付けたいコミットにいることを確認
git status
git log --oneline -1

# annotated tag を作成(メッセージにリリース内容を記載)
git tag -a v0.1.0 -m "Release v0.1.0"

# 作成したタグを確認
git tag -n

# タグをリモートに push
git push origin v0.1.0
```

- タグ名は `v` 始まりの [Semantic Versioning](https://semver.org/lang/ja/) 形式(`v<メジャー>.<マイナー>.<パッチ>`)とする。
- `git push`(ブランチの push)だけではタグは送られない。タグは `git push origin <タグ名>` で個別に push するか、`git push --tags` でまとめて push する。
- 誤ってタグを作成した場合は、push 前であれば `git tag -d <タグ名>` でローカルのタグを削除できる。push 後にリモートのタグを削除する場合は影響範囲を確認した上で `git push origin :refs/tags/<タグ名>` を実行する。

---

## 11. 参考資料

### 11-1. 秘密の値(Secret)の一覧

| 名前 | 使う Worker | 保存場所 | 内容 |
|---|---|---|---|
| `FRONTEND_URL` | backend | Worker の Secret | Frontend の URL(このURLからのアクセスだけを許可する) |
| `FRONTEND_BASE_URL` | backend | Worker の Secret | Frontend の URL(通知メール内のリンクに使う) |
| `API_KEY` | backend・frontend | Secrets Store | Frontend から Backend を呼ぶときの認証キー |
| `SESSION_SECRET` | backend・frontend | Secrets Store | ログイン状態(cookie)の署名キー |
| `SETUP_TOKEN` | backend | Secrets Store | 初期管理者を作成するときに入力するトークン |

- **Worker の Secret** は、その Worker だけが使う値です(`wrangler secret put` で登録)。
- Frontend から Backend への転送先は Secret ではなく、`wrangler.jsonc` の Service Binding(`services`)で決まります(以前の `BACKEND_URL` は不要になりました)。
- **Secrets Store** は、アカウントに1つの保存場所に置き、backend・frontend の両方から使う値です。Staging は名前の末尾に `_STAGING` を付けて区別します。
- 登録した値は、ダッシュボードでもコマンドでも**表示できません**。必要なら安全な場所に保管してください。

登録済みかどうかは、次のコマンドで確認できます(名前だけが表示され、値は表示されません)。

```bash
npx wrangler secrets-store secret list <ストアID> --remote     # Secrets Store の一覧

cd packages/backend                                            # frontend でも同様
npx wrangler secret list --env staging                         # Worker の Secret の一覧(本番は --env staging なし)
npx wrangler deploy --dry-run --env staging                    # Worker が設定を正しく読めているか
```

### 11-2. 困ったとき

| 症状 | 確認すること |
|---|---|
| 画面を開くと 500 エラーになる | Secrets Store の値(5-3 / 6-3)が登録されているか、`wrangler.jsonc` にストアID(4-6)が埋め込まれているか |
| ログイン画面のままで初期設定画面が出ない・API が 404 になる | Frontend の転送先の Backend がデプロイされているか(`npx wrangler deployments list --env staging` を `packages/backend` で実行)。Frontend のデプロイ時に `env.BACKEND (…)` が表示されたか |
| ログインできない・API がエラーになる | Backend の `FRONTEND_URL` が Frontend の URL と一致しているか(末尾の `/` なし、`https://` 付き) |
| 本番用の Worker(`my-erp-frontend` など)が意図せずできた | `--env staging` を付け忘れて `wrangler secret put` などを実行した。Staging 用は `--env staging` を付けてやり直す |
| ローカルで API がエラーになる(`[not connected]`) | Backend(`packages/backend` の `npm run dev`)を先に起動したか |
| 初期管理者を作成できない | `SETUP_TOKEN`(Staging は `SETUP_TOKEN_STAGING`)の値と入力が一致しているか |
| 帳票PDFが出力できない | フォント・ロゴ・印影をアップロードしたか(5-8 / 6-8) |
| `no such table` などの DB エラー | migration を適用したか(`npx wrangler d1 migrations list DB --remote`) |
| `store create` で `maximum_stores_exceeded` になる | Secrets Store が既にある(自動作成されている)。`store list` で ID を確認して使う(4-5) |
| wrangler のコマンドで設定ファイルが見つからない | `wrangler.jsonc` を作ったか(`node infra/scripts/sync-wrangler.mjs --write`) |
| デプロイで D1・KV の ID が不正というエラーになる | `wrangler.jsonc` に実IDが埋め込まれているか(5-2 / 6-2。`node infra/scripts/sync-wrangler.mjs` で確認) |
| wrangler のコマンドが認証・権限のエラーになる(`Authentication error` など) | 環境変数 `CLOUDFLARE_API_TOKEN`(Terraform 用のトークン)が残っていないか。残っていれば外して(`unset CLOUDFLARE_API_TOKEN`)、`npx wrangler login` の状態で実行する |
| Terraform で認証エラーになる | `CLOUDFLARE_API_TOKEN` を設定したか、トークンの権限(4-4)が足りているか |
| ローカルで `/api/*` が 500 エラーになる | 3-4 の秘密の値を backend・frontend の**両方**で、**今の `wrangler.jsonc` の `store_id`** で登録したか(4-6 でストアIDを埋め込んだ後は登録し直しが必要) |

実際のエラーの内容は `npx wrangler tail`(Staging は `--env staging`)で確認できます。
画面に表示された問い合わせ番号から過去のエラーを探す方法(Workers Logs)は、[docs/development/release.md](docs/development/release.md) の「7. 問題が起きたとき」を参照してください。

### 11-3. 関連ドキュメント

- [docs/README.md](docs/README.md) … ドキュメントの一覧(全体設計・バックエンド/フロントエンドの構造・DB・開発ガイド・使用マニュアル)
- `infra/README.md` … Terraform の詳細(既存リソースの取り込み、リソースの追加、状態ファイルの管理など)
- `sampledata/README.md` … サンプルデータの取込順
- `samplereport/README.md` … 帳票テンプレートの対応表

---

## 12. ライセンス

このプロジェクトは [MIT License](./LICENSE) で公開しています。

Copyright (c) 2026 Sales Management System Workshop

### できること・守ること

| | 内容 |
|---|---|
| できること | 商用・非商用を問わず、使用・複製・改変・結合・出版・配布・サブライセンス・販売ができます。自社向けに改造して使うことも、改造したものを配布することもできます |
| 守ること | ソフトウェアのすべての複製または重要な部分に、上の著作権表示と [LICENSE](./LICENSE) の許諾表示を含めてください |
| 保証 | ソフトウェアは「現状のまま」提供され、いかなる保証もありません。使用によって生じた損害について、著作者は責任を負いません |

正式な条件は [LICENSE](./LICENSE)(英文)が優先します。

### 同梱している第三者のファイル

次のファイルには、MIT License ではなく、それぞれの条件が適用されます。

| ファイル | 権利者・ライセンス |
|---|---|
| `fonts/LINESeedJP_TTF_Rg.ttf`(LINE Seed JP) | 著作権は LY Corporation。SIL Open Font License 1.1 で提供されています(フォント単体での販売は禁止など、OFL の条件に従ってください) |

### サンプルの画像・データ

- `company/company_logo.png`・`company/company_seal.png` は、帳票の表示を確認するための**見本の画像**です(このプロジェクトで作成した、架空の会社「株式会社サンプル」のロゴ・印影。背景透過の PNG)。
  実際に使うときは、**自社のロゴ・印影に差し替えてください**(管理画面の「メール送信設定」→ アセット管理からアップロードできます)。帳票の PDF に使えるのは PNG(背景透過も可)です。
- `sampledata/`・`samplereport/` のデータは、すべて架空のものです。

### 依存しているライブラリ

実行時に使う主なライブラリのライセンスは次のとおりです(2026-09 時点)。いずれも、このプロジェクトを MIT License で配布することと両立します。

| ライセンス | ライブラリ |
|---|---|
| MIT | Next.js、React、Hono(`@hono/*`・`hono-openapi` を含む)、Valibot、pdf-lib(`@pdf-lib/fontkit`)、ExcelJS、mimetext、smtp-client、JsBarcode、qrcode-generator、ZXing(`@zxing/browser`) |
| Apache-2.0 | Drizzle ORM |

各ライブラリの正式な条件は、それぞれのパッケージの `LICENSE`(`node_modules/<パッケージ名>/LICENSE`)を参照してください。

---

## 13. 開発に参加する

不具合の報告・改善の提案・プルリクエストを歓迎します。

### 13-1. 不具合の報告・改善の提案

GitHub の Issue で受け付けます。次の内容を書いてください。

- 起きたこと(画面・操作・表示されたメッセージ)と、本来どうなるべきか
- 再現の手順
- 環境(ローカル / Staging / 本番、ブラウザ、スマートフォンかどうか)

**パスワード・API キー・Cloudflare の ID など、秘密の値は書かないでください。** 画面のキャプチャに実在の取引先・個人の情報が写る場合は、隠してから添付してください。

### 13-2. プルリクエストの流れ

1. リポジトリを fork し、作業用のブランチを作ります。
2. [3章](#3-ローカル開発環境の構築) の手順でローカル環境を作り、変更します。
3. 変更に合わせてテストを追加し、[テストの実施方法とルール](docs/development/testing.md) の「反映前のチェックリスト」を確認します。
4. 変更の内容(何を・なぜ)を書いて、プルリクエストを作ります。画面の変更は、変更前後のキャプチャを付けてください。

### 13-3. 開発のルール

| ルール | 詳しくは |
|---|---|
| 1回の変更は1つの目的にしぼる(複数の機能を同時に大きく変えない) | [CLAUDE.md](CLAUDE.md) #11 |
| DB の migration・API の仕様・認証/認可・Cloudflare の設定は、事前に相談してから変える | [CLAUDE.md](CLAUDE.md) #2〜#5 |
| 既存の migration ファイルは変更・削除しない | [CLAUDE.md](CLAUDE.md) #2 |
| 機能ごとのディレクトリ構成と、共通処理の置き場のルールを守る | [バックエンドの構造](docs/architecture/backend.md)・[フロントエンドの構造](docs/architecture/frontend.md) |
| 画面の文字色(薄いグレーを使わない)と、画面幅への対応のルールを守る | [フロントエンドの構造の7章](docs/architecture/frontend.md#7-画面作りのルール) |
| 画面の用語・メッセージは用語集に合わせる | [用語集](docs/glossary.md) |
| 項目の追加は手順とチェックリストに沿う | [項目を追加するときの修正方法](docs/development/adding-a-field.md) |
| スキーマを変えたら DB のドキュメントを作り直す | [DB 構造](docs/database/README.md#更新方法) |
| 秘密の値・`wrangler.jsonc`・`.dev.vars` はコミットしない | [README の1章](#worker-の設定ファイルwranglerjsoncについて) |
| サンプルデータは架空のデータだけを使う | [sampledata/README.md](sampledata/README.md) |

`CLAUDE.md` は、AI(Claude Code)で開発するときのルールをまとめたファイルですが、人が開発するときも同じルールに従います。

### 13-4. 貢献したコードのライセンス

プルリクエストで提供されたコードは、このプロジェクトと同じ [MIT License](./LICENSE) で公開されます。
