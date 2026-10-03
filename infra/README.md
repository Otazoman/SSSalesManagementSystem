# infra(Cloudflareのリソースをコードで管理する)

D1・R2・KV を Terraform で作成し、その結果(ID・名前)を埋め込んだ `wrangler.jsonc` を、ひな形(`wrangler.jsonc.example`)から作ります。
Secrets Store は Cloudflare が自動作成し、アカウントに1つしか作れないため、Terraform では管理しません(下記参照)。
Worker のコードは今までどおり wrangler でデプロイします(Terraform では Worker を作りません)。
Staging/本番は、同一Cloudflareアカウント内で `wrangler.jsonc` の
`"env"."staging"`(named environment)としてリソース(D1/R2/KV/assets)を完全に分けています(#14-2①)。

構築手順の全体(初めての人向け)は、プロジェクトルートの `README.md` を参照してください。このファイルは Terraform の詳細です。

```
infra/
├─ terraform/
│  ├─ modules/cloudflare-resources/   リソースの定義(唯一の定義。D1×6・R2×15・KV×2)
│  └─ environments/
│     ├─ production/                  本番(既存と同じ名前: my-erp-db など)
│     └─ staging/                     ステージング(名前の末尾に -staging: my-erp-db-staging など)
└─ scripts/sync-wrangler.mjs          wrangler.jsonc.example から wrangler.jsonc を作る(Terraformの出力・ストアIDを埋め込む)
```

## 1. 準備(1回だけ)

```sh
mise install                # terraform(mise.toml で固定)が入ります
mise exec -- terraform version
```

`terraform` を直接打ちたい場合は、mise を有効にしたシェル(`mise activate`)で実行するか、下の例のように `mise exec --` を付けてください。

Cloudflare の**APIトークン**を作り、環境変数で渡します(ファイルには書かない・Gitに入れない)。

- 作成場所: Cloudflare ダッシュボード → My Profile → API Tokens → Create Token → Custom token
- 権限(Account の範囲): `D1: Edit` / `Workers R2 Storage: Edit` / `Workers KV Storage: Edit`

```sh
export CLOUDFLARE_API_TOKEN="(作ったトークン)"      # PowerShell: $env:CLOUDFLARE_API_TOKEN = "..."
```

アカウントIDは、環境ごとのフォルダで `terraform.tfvars.example` を `terraform.tfvars` にコピーして入れます(`terraform.tfvars` はGit管理外)。
配置地域(`d1_location_hint` / `r2_location`。日本から使うなら `apac`)は**作成後に変えられない**ので、決めてから設定してください。

## 2. リソースを作る

```sh
cd infra/terraform/environments/staging          # 本番は production
mise exec -- terraform init
mise exec -- terraform plan                      # 作られるもの(本番23件・staging19件)を確認
mise exec -- terraform apply                     # 確認して yes
```

Cloudflare の無料プランでも、D1・R2・KV は作成できます(利用量の上限は無料枠のまま。Terraformで作っても変わりません)。

## 3. wrangler.jsonc を作る

`packages/backend`・`packages/frontend` の `wrangler.jsonc` は Git 管理外です。Git で管理しているひな形
(`wrangler.jsonc.example`)を元に、`apply` で決まった ID・名前をバインディング名で探して埋め込み、作ります(コメント・整形は保たれます)。

```sh
# リポジトリのルートで
node infra/scripts/sync-wrangler.mjs                          # 確認のみ(何が埋め込まれるかを表示)
node infra/scripts/sync-wrangler.mjs --write                  # wrangler.jsonc を作る(上書き)
node infra/scripts/sync-wrangler.mjs --store-id <ID> --write  # Secrets Store のストアIDも埋め込む(初回のみ)
```

- **毎回ひな形から作り直します**。Terraform の state・出力がある環境(production・staging)は実IDを埋め込み、無い環境は仮の値のままにします。
  そのため、本番・Staging の両方を運用する端末では、両方の state が揃った状態で実行してください。
- production は `wrangler.jsonc` のトップレベル部分だけを、staging は `"env"."staging"` の中だけを対象にします(バインディング名は両方に同じ名前で出てきますが、混同せず正しい方だけを書き換えます)。
- 埋め込むのは D1 の `database_name` / `database_id`、R2 の `bucket_name`、KV の `id`、Secrets Store の `store_id` です。
  ローカル開発用の `preview_database_id` / `preview_id` は書き換えないため、実IDを埋め込んでもローカルのデータはそのまま使えます。
- `--store-id` を省略すると、今ある `wrangler.jsonc` のストアIDを引き継ぎます。
- Terraform にあって `wrangler.jsonc.example` に無いバインディングは「見つからなかったバインディング」として表示されます。
- スクリプトのテスト: `node --test infra/scripts/sync-wrangler.test.mjs`

その後、D1 のマイグレーションを適用します(`--env staging` を付ける以外は既存の手順どおり)。

```sh
cd packages/backend
npx wrangler d1 migrations apply DB --env staging --remote
npx wrangler d1 migrations apply DB_LOG --env staging --remote
npx wrangler d1 migrations apply DB_OTP --env staging --remote
npx wrangler d1 migrations apply DB_JOURNAL --env staging --remote
npx wrangler d1 migrations apply DB_DEALS --env staging --remote
npx wrangler d1 migrations apply DB_UI --env staging --remote
```

`DB_LOG`〜`DB_UI` の5つは同じ物理データベース(`my-erp-shared-db-staging`)を指していますが、コマンドはバインディング単位で実行するため、それぞれ自分の `migrations_dir` のファイルだけを見て適用します(ファイル名・テーブル名が5つとも重複していないため、1つの物理データベースにまとめて当てても問題ありません)。

## Secrets Store(秘密情報の箱)

`API_KEY` / `FRONTEND_URL` などの秘密の**値**は、Terraform では扱いません
(Terraformの`sensitive`指定はCLI表示を隠すだけで、`terraform.tfstate`には平文で残ってしまうため。CLAUDE.mdの秘密情報ルールと相容れません)。

**箱(ストア)も Terraform では管理しません**(2026-09-23 変更)。理由:

- Cloudflare の制約で、ストアは**1アカウントにつき1つまで**しか作れません(2つ目は `maximum_stores_exceeded` エラー)。
- ストアが無いアカウントで管理者が Secrets Store に触れる(ダッシュボードの画面を開く等)と、Cloudflare が
  `default_secrets_store` という名前で**自動作成**します(公式ドキュメント: "The first store in your account is created automatically
  when a user ... interacts with it.")。Terraform より先に自動作成されると、Terraform 側と食い違ってエラーになっていました。
- ストアを削除・作り直すと中の秘密がすべて消えるため、Terraform の管理下(destroy 可能)に置く利点がありません。

ストアは wrangler で確認・作成します。

```sh
cd packages/backend
npx wrangler secrets-store store list --remote                          # 既存のストアとIDの確認
npx wrangler secrets-store store create default_secrets_store --remote  # 一覧が空の場合のみ
```

確認したIDは `node infra/scripts/sync-wrangler.mjs --store-id <ID> --write` で `wrangler.jsonc` に埋め込みます(backend・frontend、production・staging のすべて)。

production/stagingの秘密は、この1つのストアの中で名前を分けて管理します(例: `API_KEY` は本番用、`API_KEY_STAGING` はステージング用。
`--comment`に用途を書いてもよい)。

**#14-2で移行済み**: `API_KEY`・`SESSION_SECRET`(backend/frontend共有)・`SETUP_TOKEN`(backend専用)は、
`wrangler.jsonc`の`secrets_store_secrets`バインディング経由(`env.API_KEY.get()`のような非同期取得)で読むように変更済みです。
`FRONTEND_URL`・`FRONTEND_BASE_URL`は共有不要な単なるURLのため、引き続き通常のSecret(`wrangler secret put`)のままです。

登録手順はプロジェクトルートの `README.md` の「5. Staging の構築」「6. 本番の構築」、値の確認コマンドは「10-1. 秘密の値(Secret)の一覧」を参照してください。

ローカル開発では、`--remote`を付けずに同じコマンドを実行するとローカル専用の値を登録できます(`.dev.vars`の代わり。
`.dev.vars.example`にコメントを残してあります)。ローカルの値は `wrangler.jsonc` の `store_id` ごとに保存されます。

## リソースを追加・変更するとき

- **R2・KV**: `modules/cloudflare-resources/main.tf` の `locals`(バインディング名 = 名前)に1行足す(`packages/backend/src/types/env.ts` と `packages/backend/wrangler.jsonc.example` にも同じバインディング名を足す)
- **D1**: `modules/cloudflare-resources/variables.tf` の `d1_groups`(既定値、本番用)に1グループ足す。stagingで物理データベースを増やしたくない場合は、既存グループの`bindings`にバインディング名を追加する(下記「D1をまとめる(staging)」参照)

追加したら `terraform plan` → `apply` のあと、`sync-wrangler.mjs --write` で `wrangler.jsonc` を作り直す(新しいバインディングは `wrangler.jsonc.example` に先に書いておく)。

## D1をまとめる(staging・無料プランのデータベース数対策)

D1データベース数は無料プランで**1アカウントにつき10個**まで(2026-09時点)。本番の6個(業務データ・監査ログ・OTP・仕訳・商談・お知らせ等)をそのままstagingにも複製すると12個になり超過するため、
staging用は `environments/staging/main.tf` の `d1_groups` で、`DB`(業務データ)以外の5つを**1つの物理データベースにまとめて**います(テーブル名・migrationファイル名の重複が無いことを確認済み)。

- `d1_groups` は「グループ名 => { name = データベース名, bindings = バインディング名の一覧 }」の形。1グループにつき物理データベースは1個だけ作られ、そのグループの `bindings` に列挙した名前**全部**が同じデータベースを指す(`wrangler.jsonc` では複数のバインディングが同じ `database_id` を持つ形になる)。
- アプリのコード(`c.env.DB_LOG` 等)は変更不要(バインディング名は変わらないため)。
- D1のmigration(`wrangler d1 migrations apply`)は、まとめた物理データベースに対して**バインディングごとの`migrations_dir`をそれぞれ適用する**(1つの物理データベースに、5つのmigrationフォルダの内容が入る形になる。テーブル名が重複していないため問題ない)。
- 本番は`modules/cloudflare-resources/variables.tf`の`d1_groups`の既定値(6分割)のまま。stagingだけ`environments/staging/main.tf`で上書きしている。
- Cloudflareアカウント自体を本番と分ける場合(2026-09にユーザーが検討)は、この制約自体が無くなる(アカウントごとに10個の枠がある)ため、まとめる必要は無くなる。その場合は`environments/staging/main.tf`の`d1_groups`の上書きを削除すればよい(モジュール既定の6分割に戻る)。

## すでにあるリソースを Terraform の管理下に入れる(import)

本番など、すでに作成済みのリソースを作り直さずに管理下へ入れる場合は、`apply` の前に import します(名前が違うと別物として新規作成されるので、`plan` で「create」が出ないことを確認してください)。

```sh
# D1:  '<アカウントID>/<データベースID>'
terraform import 'module.cloudflare.cloudflare_d1_database.this["DB"]' '<アカウントID>/<データベースID>'
# R2:  '<アカウントID>/<バケット名>/<jurisdiction>'(通常は default)
terraform import 'module.cloudflare.cloudflare_r2_bucket.this["SYSTEM_BUCKET"]' '<アカウントID>/system/default'
# KV:  '<アカウントID>/<名前空間ID>'
terraform import 'module.cloudflare.cloudflare_workers_kv_namespace.this["COMPANY_SETTINGS"]' '<アカウントID>/<名前空間ID>'
```

KV は名前(title)が Terraform の定義と違うと `plan` で名前の変更が出ます。既存の名前に合わせるか、`main.tf` の値を既存の名前にしてください。

## 状態ファイル(terraform.tfstate)の置き場所

既定は各環境フォルダのローカル(Git管理外)です。1人で運用するうちはこれで足ります。複数人・CI から実行するようになったら、
Cloudflare R2(S3互換)などのリモートへ移します(R2 のバケットは Terraform 管理の外で、手動で1つ作っておく)。

```hcl
# environments/<環境>/main.tf の terraform { } の中に追加
backend "s3" {
  bucket                      = "sms-terraform-state"
  key                         = "production/terraform.tfstate"   # 環境ごとに変える
  region                      = "auto"
  endpoints                   = { s3 = "https://<アカウントID>.r2.cloudflarestorage.com" }
  skip_credentials_validation = true
  skip_region_validation      = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  skip_s3_checksum            = true
}
```

## ロックファイル(.terraform.lock.hcl)

プロバイダのバージョンと検証用ハッシュの記録です。**最初の `terraform init` のあとに生成されるものを各環境フォルダでコミット**してください(Windows・Linux・Mac で共通にするには
`terraform providers lock -platform=windows_amd64 -platform=linux_amd64 -platform=darwin_arm64`)。

## Terraform が使えないとき(コマンドで作る場合)

```sh
npx wrangler d1 create my-erp-db          # 出力された database_id を wrangler.jsonc へ
npx wrangler r2 bucket create system
npx wrangler kv namespace create COMPANY_SETTINGS   # 出力された id を wrangler.jsonc へ
```
