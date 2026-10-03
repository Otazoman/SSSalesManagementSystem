# テストの実施方法とルール

## 1. テストの種類

| 種類 | 対象 | 実行する場所 | 仕組み | 規模(2026-09 時点) |
|---|---|---|---|---|
| Backend | API・業務ロジック・共通処理 | `packages/backend` | Vitest + `@cloudflare/vitest-pool-workers`(Workers と同じ実行環境。D1・R2・KV はメモリ上に作る) | 170ファイル・約1640件 |
| Frontend Worker | `proxy.ts`(ログイン確認・API の中継) | `packages/frontend` | Vitest(`vitest.config.mts`) | 1ファイル |
| Frontend 画面 | 画面の部品・フック | `packages/frontend` | Vitest + jsdom + Testing Library(`vitest.config.react.mts`) | 約180ファイル |
| Frontend 実ブラウザ | 画面幅ごとの表示崩れ・レイアウト | `packages/frontend` | Vitest Browser Mode + Playwright(Chromium)(`vitest.config.browser.mts`) | 15ファイル |
| スクリプト | `wrangler.jsonc` の生成、DB ドキュメントの生成 | リポジトリのルート | Node.js 標準のテスト(`node --test`) | 2ファイル |

テストは、Cloudflare の実際のリソース(Staging・本番)には一切つながりません。

## 2. 実行方法

### 2-1. Backend

```bash
cd packages/backend
npm test                                         # 全件
npm run test:watch                               # 変更を監視して再実行
npx vitest run src/routes/master/units           # フォルダを指定
npx vitest run src/routes/master/units/index.test.ts   # 1ファイル
npx vitest run -t "入金消込"                      # テスト名で絞り込み
npx tsc --noEmit                                 # 型チェック
```

### 2-2. Frontend

```bash
cd packages/frontend
npm test                                         # proxy.ts と 画面(jsdom)を続けて実行
npm run test:watch                               # 画面(jsdom)を監視して再実行
npx vitest run --config vitest.config.react.mts app/sales/quotes   # フォルダを指定
npx vitest run --config vitest.config.mts        # proxy.ts だけ
npx tsc --noEmit                                 # 型チェック
npx eslint <ファイル>                             # 変更したファイルの lint
```

実ブラウザのテスト(`npm test` には含まれません):

```bash
cd packages/frontend
npx playwright install chromium    # 初回のみ
npm run test:browser
```

### 2-3. スクリプト

```bash
# リポジトリのルートで(Windows ではフォルダ指定が動かないため、ファイルを指定する)
node --test infra/scripts/sync-wrangler.test.mjs
node --test packages/backend/scripts/db-docs/generate-db-docs.test.mjs
```

## 3. テストの書き方

### 3-1. 置き場所

| 対象 | 置き場所 | 例 |
|---|---|---|
| 1つの機能の API | 機能のディレクトリの `index.test.ts` | `routes/master/units/index.test.ts` |
| 大きな機能の service | テーマごとの `*.service.test.ts` | `sales-order-workflow.service.test.ts` |
| 共通処理 | 処理と同じ場所の `*.test.ts` | `platform/http/pagination.test.ts` |
| 複数の機能にまたがるもの | `packages/backend/test/` | `test/sampledata-import.test.ts` |
| 画面の部品・フック | 部品と同じ場所の `*.test.ts(x)` | `_hooks/useQuoteForm.test.ts` |
| 画面幅ごとの表示 | 部品と同じ場所の `*.browser.test.tsx` | `app/layout.browser.test.tsx` |

1つのテストファイルが大きくなりすぎたら(目安: 1000行超)、テーマごとに分けます。

### 3-2. テストの前提データ

| データの種類 | 用意の仕方 |
|---|---|
| 画面の CSV 取込がある(取引先・商品・単位・倉庫・見積・受注など) | `sampledata/` の CSV を、本番と同じ取込 API で取り込む(`importSampleCsv("partners_import_sample.csv")`) |
| 画面の CSV 取込が無い(ユーザー・ロール・部署・承認フローなど) | `packages/backend/test/fixtures/<シナリオ名>/<テーブル名>.csv` を用意し、`seedFixtures(db, "<シナリオ名>")` で投入する |
| そのテストで検証する値(与信限度額・承認フローの金額の範囲など) | テストのコードの中で指定する(CSV に移すと、何を検証しているかが読み取れなくなるため) |

詳しくは [テストデータ(CSV フィクスチャ)](../../packages/backend/test/fixtures/README.md) を参照してください。サンプルデータは架空のデータだけを使います。

### 3-3. 名前と書き方

- テスト名は、**日本語で「どういう時に、どうなるか」**を書きます。
  例: `it("仕入先と移動元倉庫を同時に指定すると400を返す", ...)`
- 1つのテストで確かめることは1つにします。
- 画面のテストでは、画面に表示される文言・ラベルで要素を探します(Testing Library の `getByRole`・`getByText` など)。
- 画面幅のテストでは、`test-support/responsive.ts` の `WIDTHS`(375・768・1280)と `setWidth()` を使います。

## 4. テストのルール

### 4-1. 変更するとき

- **変更には、その変更を確かめるテストを付けます。** 項目の追加なら、保存されること・業務ルールのエラーになることを確かめます([項目を追加するときの修正方法](adding-a-field.md))。
- **不具合の修正には、再発を防ぐテストを付けます。** そのテストが、修正前のコードでは失敗することを確認してから修正します(確認できない場合は、その旨を記録します)。
- まず変更した部分のテストを実行し、通ったら全体のテストと型チェックを実行します。
- API の外部仕様(URL・メソッド・リクエスト・レスポンス・ステータス)が変わっていないことを、既存のテストが通ることで確かめます。

### 4-2. 既存のテスト・チェックを弱めない

- テストを通すために、既存のテストの期待値を理由なく書き換えたり、テストを削除・スキップしたりしません。仕様が変わって期待値を変える場合は、その理由をコミットに書きます。
- `app/_shared/responsive-guard.test.ts` は、独自のモーダルや表など、画面幅で崩れやすい書き方の件数を基準値で固定しています。
  - 件数が**増える**変更はしません(共通部品の `Modal`・`FormGrid`・`TableScroll`・`DataTable` を使います)。
  - 共通部品に置き換えて件数が**減った**場合は、基準値を下げます(基準値と同じでないとテストが失敗します)。

### 4-3. lint と型チェック

- 型チェック(`npx tsc --noEmit`)は、Backend・Frontend ともエラー0件を保ちます。
- Frontend の lint には、以前からのエラー・警告が残っています。**一括で直すことはしません。** 変更したファイルに `npx eslint <ファイル>` を実行し、今回の変更で**新しく**増えたエラー・警告が無いことを確かめます(CLAUDE.md #15・#16)。

### 4-4. 生成物が最新であること

スキーマを変えたときは、DB のドキュメントが最新であることをテストで確かめます(`generate-db-docs.test.mjs` が、`docs/database/` が古いと失敗します)。

```bash
node packages/backend/scripts/db-docs/generate-db-docs.mjs --check
```

### 4-5. 実機(Staging)での確認

- 画面の変更は、ローカル(`wrangler dev`)と Staging のブラウザで、主な操作の流れと、画面幅(スマートフォン・PC)を確認します。
- Staging での確認で見つかった不具合は、その場で直さず、**バグ票の一覧に記録してから**、直す内容・順番を相談して決めます。

## 5. 変更を反映する前のチェックリスト

```text
[ ] Backend: npm test が通る / npx tsc --noEmit がエラー0件
[ ] Frontend: npm test が通る / npx tsc --noEmit がエラー0件 / 変更したファイルの eslint で新しい指摘が無い
[ ] 画面幅に関わる変更をした: npm run test:browser が通る
[ ] スキーマを変えた: migration の SQL を読んだ / generate-db-docs.mjs --check が通る
[ ] wrangler の設定を変えた: wrangler.jsonc.example を編集した / node --test infra/scripts/sync-wrangler.test.mjs が通る
[ ] 不具合の修正: 再発を防ぐテストを付けた
```

反映(デプロイ)の手順は [変更を反映する流れ](release.md) を参照してください。
