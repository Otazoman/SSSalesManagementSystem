# フロントエンドの構造

`packages/frontend` は、画面(Next.js)と、それを配信・中継する Frontend Worker(`proxy.ts`)からなります。
システム全体の中での位置づけは [全体設計](overview.md) を参照してください。

## 1. 仕組みの概要

- 画面は Next.js 16 / React 19 / Tailwind CSS 4 で作り、`npm run build` で**静的ファイル**(`out/`)に書き出します(`next.config.ts` の `output: "export"`)。
  サーバー側で動く Next.js の機能(Server Components の動的処理・API Routes など)は使いません。
- 静的ファイルは、Frontend Worker が Workers Assets(`env.ASSETS`)から配信します。
- 画面からの API 呼び出しは、すべて同じ URL の `/api/*` に送ります。`proxy.ts` が Backend に中継します。

## 2. ディレクトリ構成

```text
packages/frontend/
├─ proxy.ts                    Frontend Worker 本体(ページのアクセス制御・/api/* の中継)
├─ wrangler.jsonc.example      Worker の設定のひな形(wrangler.jsonc はここから生成する。Git管理外)
├─ next.config.ts              静的書き出しの設定
├─ out/                        ビルド結果(Git管理外)
└─ app/
   ├─ layout.tsx               全画面共通の枠(ヘッダー・サイドメニュー・スマホ用のドロワー)
   ├─ page.tsx                 トップ(初期設定済みかを確認して振り分ける)
   ├─ PermissionGuard.tsx      画面権限の確認(権限が無ければ AccessDenied を表示)
   ├─ hooks/                   アプリ全体で1つだけのフック(ログインユーザー・メニュー・画面権限)
   ├─ context/                 アプリ全体の状態(権限・テーマ・画面説明)
   ├─ types.ts                 アプリ全体の型
   ├─ _shared/                 複数の機能で使う共通部品(下の5章)
   │
   ├─ dashboard/ profile/ progress/                    ダッシュボード・プロフィール・進捗確認
   ├─ sales/                   販売(商談・見積・受注・売上・請求/入金)
   ├─ purchase/                購買(購買申請・発注・仕入・支払)
   ├─ inventory/               在庫(入荷・出荷・在庫照会・棚卸)
   ├─ accounting/              会計(仕訳の出力・修正、仕訳ルール、出力形式)
   ├─ master/                  業務マスタ
   ├─ admin/                   システム管理(ロールが admin のユーザーのみ)
   ├─ workflow/                承認(承認タスク・承認履歴)
   │
   ├─ login/ setup-init-admin/ forgot-password/ password-reset/ force-password-change/   ログイン関連
   └─ *-download/              取引先・外部倉庫向けの OTP ダウンロード画面(ログイン不要)
```

## 3. 1つの画面(機能)のファイル構成

```text
app/sales/quotes/
├─ page.tsx          画面の入口。権限の確認(usePagePermissions)と、部品の組み立て
├─ _components/      この画面だけで使う部品(フォーム・一覧表・検索欄・モーダルなど)
├─ _hooks/           この画面だけで使う状態管理と API 呼び出し
└─ _types/index.ts   この画面だけで使う型
```

- テストは部品と同じ場所に置きます。`*.test.ts(x)` は jsdom で動く通常のテスト、`*.browser.test.tsx` は実ブラウザ(Chromium)で動く表示のテストです。
- ディレクトリ名が `_` で始まるものは、Next.js のページ(URL)になりません。

### 3-1. 何をどこに書くか

| 場所 | 書いてよいもの | 書いてはいけないもの |
|---|---|---|
| `page.tsx` | 画面の入口、`usePagePermissions()` の呼び出し、部品の配置 | `fetch` の直書き、複雑な業務ロジック(`_hooks` へ) |
| `_components/` | その画面専用の部品 | 2つ以上の画面で使う見た目(`_shared/ui` へ) |
| `_hooks/` | その画面専用の状態管理・API 呼び出し | アプリ全体で1つだけのもの(認証・メニュー・権限は `app/hooks`) |
| `_types/` | その画面だけで使う型 | 2つ以上の画面で同じ形の型(`_shared/types` へ) |
| `_shared/ui/` | 状態を持たない、再利用できる表示部品 | API 呼び出し、業務ロジック |
| `_shared/hooks/` | 2つ以上の画面で使う汎用ロジック(API・ページング・CSV など) | 特定の画面の業務ルール |
| `app/hooks/`・`PermissionGuard.tsx`・`context/` | アプリ全体で1つだけの認証・権限・メニューの状態 | 特定の画面のロジック |

### 3-2. 依存の向き

```text
app/{領域}/{機能}/page.tsx
  → _hooks/*      → app/_shared/hooks/*(API・ページング・CSV など)
  → _components/* → app/_shared/ui/*
app/hooks/*、PermissionGuard.tsx、context/*
  → すべての画面から使われる(画面側から書き換えない)
```

`app/_shared/*` から特定の画面の `_hooks`・`_components`・`_types` を参照してはいけません。

## 4. Frontend Worker(proxy.ts)

| 処理 | 内容 |
|---|---|
| `/api/*` の中継 | ログイン不要の API 以外は、有効なセッション cookie(`session_token`)を確認します。無ければ 401 を返します。確認できたら `X-API-KEY` を付けて、Service Binding(`env.BACKEND`)で Backend に転送します |
| ページのアクセス制御 | 公開ページ(ログイン関連・OTP ダウンロード)と静的ファイル以外は、ログインしていなければ `/login` に移動します |
| 管理画面の制限 | `/admin` 配下は、ロールが `admin` でなければ `/dashboard?error=unauthorized` に移動します |
| 静的ファイルの配信 | Workers Assets から返します。URL に対応するファイルが無い場合は、Next.js の画面を返せるよう補正します |

- ログイン不要の API・公開ページの一覧は `proxy.ts` の中にあります。取引先向けの画面などを追加するときは、ここにも追加が必要です。
- `proxy.ts` のテストは `proxy.test.ts`(`vitest.config.mts`)です。

## 5. 共通部品(_shared)

| ディレクトリ | 内容 |
|---|---|
| `_shared/ui/` | 画面の部品。`DataTable`(一覧表)、`FormField`・`FormGrid`・`FormActions`(入力フォーム)、`Modal`・`SidePanel`、`Button`、`MessageBanner`(メッセージ)、`StatusBadge`・`StatusTabs`・`StatusPillTabs`(状態の表示・絞り込み)、`Pagination`、`SearchPanelShell`・`ListToolbar`(検索・一覧の操作)、`PageHeader`、`TableScroll`(表の横スクロール)、`MailSendModal`・`OtpDownloadCard`(メール送信・OTP)、`ConfirmProvider`(削除などの確認。`useConfirm()` で使う)、`HtmlEditor`・`RichHtml`(リッチテキスト)、`DocumentCompletionControl`(伝票の完了/進行中)、`ApplicantDepartmentSelect`(申請部署)など |
| `_shared/hooks/` | `use-api-fetch`(API 呼び出し)、`use-paginated-list`(ページング付きの一覧)、`use-csv-download`・`use-csv-import`(CSV)、`use-attachment-upload`(添付ファイル)、`use-otp-download`・`use-instruction-download`(OTP・指示書のダウンロード)、`use-deep-link-id`(URL の `?editId=` などで伝票を開く)、`use-pagination-setting`、`use-tax-rounding-mode`(消費税の端数処理)、`use-confirm`(確認。**ブラウザの `confirm`・`alert` は使わず**、`const confirm = useConfirm();` → `if (!(await confirm("削除しますか？"))) return;`。BUG-045) |
| `_shared/jst-date.ts` | 日本時間の日付(`todayJst`・`formatJstDate`・`addMonthsToDate`)。**「今日」は必ずこれで作る**(`new Date().toISOString().slice(0, 10)` は UTC のため、朝9時前は前日になる。BUG-043) |
| `_shared/tax-amounts.ts` | 消費税の端数処理(`roundTaxAmount`)。Backend の `platform/tax` と同じ計算(BUG-042) |
| `_shared/password-policy.ts` | 会社設定のパスワードのルールの説明(`describePasswordPolicy`)。確かめるのは Backend の `platform/auth/password-policy.ts`。画面では `use-password-policy-description` で説明を出すだけ(BUG-046) |
| `_shared/status/` | 伝票・マスタ・承認・消込などの状態の表示名と色 |
| `_shared/api/`・`_shared/types/` | 一覧のレスポンス、添付ファイル、選択肢などの共通の型 |

### 5-1. API の呼び出し

API は `apiFetch()`(`_shared/hooks/use-api-fetch.ts`)で呼びます。

```ts
const units = await apiFetch<UnitRecord[]>("/api/units?status=active");
await apiFetch("/api/units/register", {
  method: "POST",
  json: { id, name },                         // JSON を送る
  defaultErrorMessage: "単位の登録に失敗しました",
});
```

- cookie の送信(`credentials: "include"`)を必ず付けます。
- エラーの時は、Backend のメッセージ(`message` → `error` の順)、無ければ `defaultErrorMessage` で例外を投げます。画面では `catch` して `MessageBanner` などで表示します。

## 6. ログイン・メニュー・画面権限

| 仕組み | 場所 | 内容 |
|---|---|---|
| ログインユーザーとメニュー | `app/hooks/use-auth-and-menu.ts` | ログイン後に `/api/auth/profile`(ユーザー・権限)と `/api/permissions/screens`(画面一覧)を取得し、サイドメニューを作ります |
| 画面の表示可否 | `app/PermissionGuard.tsx` | 今の URL の画面に対する権限(`{resource}:menu`)が無ければ、`AccessDenied` を表示します。ロール `admin` はすべて表示できます |
| 画面内の操作の可否 | `app/hooks/use-page-permission.ts` | `usePagePermissions()` で `canRead`・`canCreate`・`canUpdate`・`canDelete` と、機能ごとの承認機能の有効/無効を取得します。ボタンの表示・活性の切り替えに使います |

- 画面の定義(URL・名前・メニューのカテゴリ・権限の単位)は、Backend の `packages/backend/src/constants/screens.ts` にあります。**新しい画面を追加するときは、ここへの登録が必要**です(登録しないとメニューに出ず、権限も設定できません)。
- 画面権限は主に Frontend で制御しています。Backend 側の状況は [全体設計の4-2](overview.md#4-2-権限画面権限) を参照してください。

## 7. 画面作りのルール

### 7-1. 文字の色(見やすさ)

薄いグレーの文字は使いません(CLAUDE.md #20)。

- 入力欄(input・select・textarea)は `bg-white text-slate-900` を必ず指定します。
- ボタンは、通常 `bg-white text-slate-800`、主要なボタン `bg-slate-900 text-white` のように文字色を必ず指定します。
- 本文・ラベル・表のセルは `text-slate-700` 以上(ラベルは `text-slate-800` 推奨)にします。
- `text-slate-500` は、無効状態・プレースホルダ・空欄の「-」表示にだけ使えます。補足文は `text-slate-600` が下限です。

### 7-2. 画面幅への対応(スマートフォン・タブレット)

- スマートフォン(375px)・タブレット(768px)・PC(1280px)で崩れないようにします。
- モーダル・入力欄の並び・表の横スクロールは、共通部品(`Modal`・`FormGrid`・`TableScroll`・`DataTable`)を使います。独自に作ると崩れやすいため、`app/_shared/responsive-guard.test.ts` が独自実装の数を監視しています(増えるとテストが失敗します)。
- 実ブラウザでの確認は `npm run test:browser` です(README の9章)。

### 7-3. 文言

画面の用語・メッセージ・ボタンの書き方は [用語集](../glossary.md) に合わせます。

## 8. テスト

| 種類 | 設定ファイル | 対象 | 実行 |
|---|---|---|---|
| Frontend Worker | `vitest.config.mts` | `proxy.test.ts` | `npm test`(前半) |
| 画面・フック(jsdom) | `vitest.config.react.mts` | `app/**/*.test.{ts,tsx}` | `npm test`(後半) |
| 実ブラウザ(Chromium) | `vitest.config.browser.mts` | `app/**/*.browser.test.tsx` | `npm run test:browser` |

## 9. 命名のルール

| 対象 | ルール | 例 |
|---|---|---|
| 画面専用のフック | `use{機能}.ts`(既存)/ 新規は `use-{機能}.ts` も可 | `useQuoteForm.ts` |
| 共通のフック | `use-{機能}.ts`(ケバブケース、`_shared/hooks`) | `use-api-fetch.ts` |
| 共通の部品 | パスカルケース | `DataTable.tsx`、`MessageBanner.tsx` |
| 画面専用の型 | `_types/index.ts` の中でパスカルケース | `QuoteRecord` |
| 共通の型 | `_shared/types/{関心事}.ts` | `lookup.ts`、`attachment.ts` |

既存のコードには、このルールから外れた名前も残っています。一括での名前変更はせず、新しく作るファイル・手を入れるファイルから揃えます。
