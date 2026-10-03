# Sales Management System - Claude Code 開発ルール

## 基本方針

このプロジェクトは既存の販売管理システムです。

既存機能を壊さず、段階的にリファクタリング・機能追加を行います。

Claude Codeは、明示的に指定された範囲を超えてコードを変更してはいけません。

---

# 最重要ルール

## 1. 指定範囲外を変更しない

ユーザーが変更対象として明示していないファイルは変更しない。

特に、以下を勝手に変更しない。

- DB schema
- Drizzle migration
- Cloudflare設定
- 認証
- 認可
- API仕様
- package.json
- package-lock.json
- 環境変数
- Git設定

---

# 2. DB migrationは変更禁止

以下は原則として変更禁止。

- packages/backend/drizzle/
- Drizzle migrationファイル
- migration journal
- migration snapshot

既存migrationを整理・統合・削除しない。

DB schemaを変更する必要がある場合は、変更前にユーザーへ確認する。

---

# 3. Cloudflare設定は変更禁止

以下はユーザーの明示的な指示がない限り変更しない。

- packages/backend/wrangler.jsonc.example
- packages/frontend/wrangler.jsonc.example
- infra/terraform/(Terraform定義)
- infra/scripts/sync-wrangler.mjs(wrangler.jsonc 生成スクリプト)
- Cloudflare Worker設定
- Service Binding(Frontend → Backend の services)
- Backend の非公開設定(workers_dev / preview_urls)
- D1 binding
- R2 binding
- KV binding
- Worker deployment設定

Cloudflareへのdeployを勝手に実行しない。

wrangler.jsonc(backend・frontend)は Git 管理外の生成物である。設定を変える場合は
wrangler.jsonc.example を編集し、`node infra/scripts/sync-wrangler.mjs --write` で作り直す
(wrangler.jsonc を直接編集しない)。実ID(D1・KV・Secrets Store の store_id)を含むため、内容を出力・コミットしない。

---

# 4. 認証・認可は変更禁止

以下について、明示的な指示なしに設計変更しない。

- session cookie
- login_user_role
- API_KEY
- ログイン処理
- パスワード処理
- 権限チェック
- admin権限
- permission cache

認証・認可の改善案を発見した場合は、まず報告する。

---

# 5. API仕様を維持する

既存APIについて、明示的な指示なしに以下を変更しない。

- URL
- HTTP method
- request形式
- response形式
- status code
- authentication method

APIを変更する必要がある場合は、変更前に影響範囲を報告する。

---

# 6. 環境変数・秘密情報

以下の値を読み取って出力・表示・コミットしない。

- API_KEY
- BACKEND_URL
- FRONTEND_URL
- その他のsecret
- password
- token
- Cloudflare credentials

.env、.dev.vars等の秘密情報をチャットやログに出力しない。

---

# 7. CSVサンプルデータ

sampledata/ 配下は取込用データである。

ユーザーから明示的な指示がない限り変更しない。

---

# 8. 画像・フォント

以下はアプリケーション資産であり、明示的な指示なしに変更しない。

- company/
- fonts/
- company_logo.png
- company_seal.png

---

# 9. 生成物・依存関係

以下は原則として手動変更しない。

- node_modules/
- .next/
- out/
- .wrangler/
- tsconfig.tsbuildinfo
- packages/*/wrangler.jsonc(wrangler.jsonc.example から sync-wrangler.mjs で生成する)

npm install、npm uninstall、package.json変更は、ユーザーの明示的な指示なしに実行しない。

---

# 10. Git

以下を勝手に実行しない。

- git commit
- git push
- git reset
- git clean
- git checkout
- git restore
- git branch削除

作業開始時にはgit statusを確認する。

変更終了後には変更ファイル一覧を報告する。

---

# 11. 作業単位

1回の作業では、1つの目的に集中する。

例えば、

- accountsの型整理
- accountsのHook整理
- accountsのAPI整理

など、変更目的を分ける。

複数機能を同時に大規模変更しない。

---

# 12. リファクタリングの原則

リファクタリングでは原則として、

- 外部仕様を変更しない
- UIの動作を変更しない
- API仕様を変更しない
- DB構造を変更しない
- 認証方式を変更しない
- 業務ロジックを変更しない

こと。

目的は内部構造の改善であり、機能変更ではない。

---

# 13. コード変更前の確認

コードを変更する前に、

1. 対象ファイル
2. 変更理由
3. 影響範囲
4. 想定されるリスク

を確認する。

対象範囲が不明確な場合は変更せず、質問する。

---

# 14. コマンド実行

安全な読み取り系コマンドは実行してよい。

例:

- git status
- git diff
- npm run lint
- npm run build
- npx wrangler deploy --dry-run

ただし、以下はユーザーの明示的な許可なしに実行しない。

- 本番deploy
- DB migration apply
- DB reset
- DB rebuild
- npm install
- npm uninstall
- Git commit
- Git push

---

# 15. リファクタリング前後の確認

変更後は可能な範囲で、

- lint
- build
- typecheck
- 関連テスト

を実行する。

既存のlint errorをすべて一度に修正することを目的にしない。

---

# 16. 現在の既知の状態

Frontend lintには現在、

- 127 errors
- 33 warnings

が存在する。

これらを一括修正しない。

既存エラーと今回発生したエラーを区別する。

---

# 17. 重要な設計境界

現在のシステムは概ね、

Browser
→ Frontend
→ Frontend Worker
→ Backend Worker
→ D1 / R2 / KV

という構成である。

Frontend WorkerとBackend Workerの責務を勝手に統合しない。

Frontend Worker → Backend Worker の通信は Service Binding(env.BACKEND)で行う(URL への fetch ではない)。
Backend Worker は公開していない(workers_dev: false)。外部から到達できるのは Frontend Worker のみ。

---

# 18. 最初の作業では分析を優先する

新しい作業を開始した際、ユーザーが「分析」を求めている場合はコードを変更しない。

分析結果として、

- 現状
- 問題点
- 影響範囲
- 改善案
- リスク

を報告する。

コード変更はユーザーが明示的に依頼した後に行う。

---

# 19. 迷った場合

以下の場合は勝手に変更しない。

- DBを変更する必要がありそう
- APIを変更する必要がありそう
- 認証を変更する必要がありそう
- Cloudflare設定を変更する必要がありそう
- 複数機能に影響しそう
- 変更範囲が不明
- 既存動作を壊す可能性がある

その場合は、変更せずに状況と選択肢を報告する。

---

# 20. UIの文字色・視認性(新規画面・画面修正では必ず守る)

薄いグレーの文字は視認性が低いため、繰り返し指摘されている。新規画面の追加・既存画面の修正では、以下を必ず守る。

- 入力欄(input / select / textarea)には必ず `bg-white text-slate-900` を明示する。色指定を省略しない(ブラウザ既定色やダークモードで薄く見える原因になる)。
- ボタンにも文字色を明示する(通常ボタンは `bg-white text-slate-800`、主要ボタンは `bg-slate-900 text-white`)。
- 本文・ラベル・説明文・表のセルは `text-slate-700` 以上の濃さにする(ラベルは `text-slate-800` 推奨)。
- `text-slate-300` / `text-slate-400` / `text-gray-*`(400以下)は文字色に使わない。`text-slate-500` は下記の無効状態・プレースホルダ・空欄表示にのみ使ってよい。補足文でも `text-slate-600` を下限とする。
- 無効(disabled)状態の文字でも `text-slate-500` を下限とし、無効であることは文字色だけに頼らず opacity 等でも示す。
- 空欄を示す「-」などのプレースホルダも `text-slate-500` 以上にする。
- placeholder は `placeholder-slate-500` 以上の濃さにする。
- 薄いグレーは罫線・背景など文字以外にのみ使ってよい。
- 共通コンポーネント(`_shared/ui/`)もこのルールに従う。既存の薄い色を見つけた場合は、触れた画面の範囲で修正する。
- 画面追加・修正後、上記のクラスが守られているかを確認してから報告する。

---
