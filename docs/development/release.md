# 変更を反映する流れ(コマンドライン)

コードの変更を、Staging → 本番に反映する手順です。CI/CD(自動ビルド・自動デプロイ)は使わず、手元の端末からコマンドで行います。
初めての環境の構築は、プロジェクトルートの [README.md](../../README.md) の4〜6章を参照してください。

## 1. 全体の流れ

```text
ローカルで変更・テスト
  → コミット・push
  → Staging に反映(migration → Backend → Frontend)
  → Staging で確認(不具合はバグ票に記録)
  → 本番に反映(migration → Backend → Frontend)
  → 本番で確認
```

- **必ず Staging で確認してから本番に反映します。**
- 反映の順番は、**migration → Backend → Frontend** です。
  - migration が先: 新しいコードが、新しいテーブル・列を使うため
  - Backend が Frontend より先: Frontend は Service Binding で Backend に直接つながるため
- wrangler のコマンドは、`--env staging` を付けると Staging、付けないと本番が対象です([README の2章の表](../../README.md#staging-と本番の指定方法コマンドごと))。

## 2. 反映する前に(ローカル)

[テストの実施方法とルール](testing.md) の「変更を反映する前のチェックリスト」を確認します。最低限、次を実行します。

```bash
cd packages/backend
npm test && npx tsc --noEmit
cd ../frontend
npm test && npx tsc --noEmit
cd ../..
node packages/backend/scripts/db-docs/generate-db-docs.mjs --check   # スキーマを変えた場合
```

変更をコミットし、GitHub に push します。

## 3. Staging に反映する

`wrangler login` 済みのターミナルで、リポジトリのルートから始めます。

> **⚠ Terraform 用のトークンを外してから進めます。** wrangler は、環境変数 `CLOUDFLARE_API_TOKEN` があると `wrangler login` の代わりにそのトークンを使います。
> Terraform 用のトークン(D1・R2・KV の権限のみ)のままだと、Worker のデプロイなどが権限不足で失敗します。
>
> ```bash
> unset CLOUDFLARE_API_TOKEN                  # Git Bash / Linux / Mac
> Remove-Item Env:CLOUDFLARE_API_TOKEN        # PowerShell
> ```


### 3-1. 最新のコードと設定を用意する

```bash
git pull
node infra/scripts/sync-wrangler.mjs --write     # wrangler.jsonc.example の変更を反映(実ID・ストアIDは引き継がれる)
cd packages/backend  && npm install
cd ../frontend       && npm install
cd ../..
```

### 3-2. migration を確認・適用する

未適用の migration があるかを、6つの DB すべてで確認します。

```bash
cd packages/backend
for db in DB DB_LOG DB_OTP DB_JOURNAL DB_DEALS DB_UI; do
  echo "== $db"; npx wrangler d1 migrations list $db --env staging --remote
done
```

PowerShell の場合:

```powershell
cd packages/backend
foreach ($db in "DB","DB_LOG","DB_OTP","DB_JOURNAL","DB_DEALS","DB_UI") {
  "== $db"; npx wrangler d1 migrations list $db --env staging --remote
}
```

未適用があった DB だけ適用します。**適用した migration は元に戻せない**ので、適用する `.sql`(`packages/backend/drizzle/<DB>/`)の中身を先に読みます。

```bash
npx wrangler d1 migrations apply DB --env staging --remote     # 例: 業務DBに未適用があった場合
```

### 3-3. Backend を反映する

```bash
# packages/backend にいる状態で
npx wrangler deploy --env staging
```

### 3-4. Frontend を反映する

```bash
cd ../frontend
npm run build
npx wrangler deploy --env staging
```

表示の中に `env.BACKEND (my-erp-backend-staging)` があれば、Staging の Backend につながっています。

### 3-5. Staging で確認する

- ログインできる
- 変更した画面・機能が動く(スマートフォン幅でも確認する)
- 帳票 PDF を出力できる(帳票に関わる変更の場合)

エラーの内容は、ログで確認できます(`packages/backend`・`packages/frontend` それぞれで実行)。

```bash
npx wrangler tail --env staging
```

`wrangler tail` は、見ている間に起きたことだけを表示します。過去のエラーは、下の「7. 問題が起きたとき」の Workers Logs で探します。

見つかった不具合は、その場で直さず、バグ票の一覧に記録してから、直す内容を相談して決めます。

## 4. 本番に反映する

Staging と同じ手順を、`--env staging` を**付けずに**行います。

```bash
# 3-1 と同じ(git pull・sync-wrangler・npm install)は済んでいる前提

cd packages/backend
for db in DB DB_LOG DB_OTP DB_JOURNAL DB_DEALS DB_UI; do
  echo "== $db"; npx wrangler d1 migrations list $db --remote
done
npx wrangler d1 migrations apply DB --remote     # 未適用があった DB だけ

npx wrangler deploy                              # Backend

cd ../frontend
npm run build
npx wrangler deploy                              # Frontend(表示に env.BACKEND (my-erp-backend) があること)
```

反映後、本番でもログインと、変更した画面の主な操作を確認します。

## 5. 変更の内容によって追加で必要な作業

| 変更の内容 | 追加で必要な作業 | 手順 |
|---|---|---|
| DB のスキーマを変えた | migration の適用(3-2) | 上のとおり |
| `wrangler.jsonc.example` を変えた(バインディングの追加など) | `node infra/scripts/sync-wrangler.mjs --write` で `wrangler.jsonc` を作り直す | 3-1 |
| D1・R2・KV を追加した | Terraform でリソースを作ってから、`wrangler.jsonc` を作り直す | [infra/README.md](../../infra/README.md) の「リソースを追加・変更するとき」 |
| 秘密の値(Secrets Store)を追加した | Staging(`<名前>_STAGING`)・本番の両方に登録する | README の5-3 / 6-3 |
| Worker の Secret(`FRONTEND_URL` など)を変えた | `wrangler secret put <名前>`(Staging は `--env staging`) | README の5-7 / 6-7 |
| 帳票のフォント・ロゴ・印影を変えた | R2 にアップロードし直す(または管理画面から) | README の5-8 / 6-8 |
| 画面の定義(`screens.ts`)に画面を追加した | 反映後、管理画面の「画面・権限マスタ」で、必要なロールに権限を付ける | ― |

## 6. 反映した記録

何をいつ反映したかは、次のコマンドで確認できます。

```bash
git log --oneline -10                              # 反映したコード
cd packages/backend
npx wrangler deployments list --env staging       # Worker の反映履歴(本番は --env staging なし)
npx wrangler d1 migrations list DB --env staging --remote   # 適用済みの migration
```

## 7. 問題が起きたとき

### エラーの詳細を調べる(問い合わせ番号)

サーバーで予期しないエラーが起きると、画面には「〇〇に失敗しました(問い合わせ番号: xxxxxxxx)」とだけ表示されます
(エラーの内部情報は画面に出さない。BUG-025)。詳細(エラーの内容・スタックトレース)は、Backend のログに
`[500] errorId=xxxxxxxx GET /api/...` の形で残ります。

- **過去のエラーを探す(Workers Logs)**: Cloudflare のダッシュボード → Workers & Pages → `my-erp-backend-staging`(本番は `my-erp-backend`)
  → 「ログ」(Observability)で、問い合わせ番号(例: `errorId=1a2b3c4d`)を検索します。
  - Backend の `wrangler.jsonc.example` の `"observability": { "enabled": true }` で有効にしています(本番・Staging とも)。
  - 無料プランでは1日20万件まで・3日間保存です。3日より前のエラーは残りません。
- **今起きていることを見る**: `packages/backend` で `npx wrangler tail --env staging`(本番は `--env staging` なし)。


Worker を1つ前のバージョンに戻す方法と、D1 を過去の時点に戻す方法は、[README の8章](../../README.md#8-問題が起きたときロールバック) を参照してください。
Worker を戻しても、適用済みの migration と DB のデータは戻りません。
