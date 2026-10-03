# 項目を追加するときの修正方法

既存の画面(マスタ・伝票)に項目を1つ追加するときに、どこを直すかの手順です。
構造の全体像は [バックエンドの構造](../architecture/backend.md)・[フロントエンドの構造](../architecture/frontend.md) を参照してください。

> **注意**: DB の構造の変更は、CLAUDE.md で「変更前にユーザーへ確認する」ことになっています。作業の前に、追加する項目・型・必須かどうかを決めて合意してください。

## 全体の流れ

| 順番 | 作業 | 主な場所 |
|---|---|---|
| 1 | DB のスキーマに列を追加する | `packages/backend/src/db/` |
| 2 | migration を作り、ローカルの DB に適用する | `packages/backend/drizzle/` |
| 3 | DB のドキュメントを作り直す | `docs/database/` |
| 4 | Backend(入力チェック・保存・業務ロジック)を直す | `packages/backend/src/routes/{領域}/{機能}/` |
| 5 | 関係する周辺の処理を直す(承認・CSV・帳票など) | 下のチェックリスト |
| 6 | Frontend(型・フォーム・一覧)を直す | `packages/frontend/app/{領域}/{機能}/` |
| 7 | テストを追加・実行する | 各 `*.test.ts(x)` |
| 8 | Staging → 本番に反映する(migration の適用を含む) | [変更を反映する流れ](release.md) |

## 1. DB のスキーマに列を追加する

対象のテーブルの定義に列を追加し、**列の直前にコメントで意味を書きます**(DB のドキュメントの説明になります)。

```ts
// packages/backend/src/db/schemas/schema-biz.ts
export const itemShipmentHeaders = sqliteTable("item_shipment_headers", {
  // ...
  // 倉庫間移動の出庫側。得意先(partnerId)の代わりに、移動先となる倉庫を指定できる
  destinationWarehouseId: text("destination_warehouse_id").references(() => warehouses.id),
  // ...
});
```

- **既存の行があるテーブルに追加する列は、空を許す(`.notNull()` を付けない)か、既定値(`.default(...)`)を付けます。**
  既定値の無い必須の列を追加すると、既存の行を移せず migration が失敗します。
- 日時は `integer("xxx_at", { mode: "timestamp" })`、真偽値は `integer("is_xxx", { mode: "boolean" })` で定義します。
- 他のテーブルを参照する列は `.references(() => テーブル.id)` を付けます(ER 図の線になります)。別の DB のテーブルは参照できません。

## 2. migration を作り、ローカルの DB に適用する

```bash
cd packages/backend
npm run db:generate-main     # 業務DBの場合。他のDBは db:generate-log / otp / journal / deals / ui
```

`drizzle/main/` に新しい `.sql` ができます。**適用する前に、必ず中身を読みます。**

- 列の追加だけなら `ALTER TABLE ... ADD ...` の1文になります。
- 列の追加と同時に、既存の列の制約(NOT NULL など)を変えると、テーブルの作り直し(`CREATE TABLE __new_...` → `INSERT ... SELECT` → `DROP` → `RENAME`)になり、D1 では失敗しやすくなります。
  **列の追加と制約の変更は、別々の migration に分けてください。**
- 既存の migration ファイル(`drizzle/` の既存の `.sql`・`meta/`)は、変更・削除しません。

中身を確認したら、ローカルの DB に適用します。

```bash
npm run db:migrate-main
```

## 3. DB のドキュメントを作り直す

```bash
# リポジトリのルートで
node packages/backend/scripts/db-docs/generate-db-docs.mjs
```

- 列の説明は、手順1で書いたコメントが使われます。
- テーブルを新しく追加した場合は、`packages/backend/scripts/db-docs/catalog.mjs` の `TABLES` に日本語名・説明・領域を追加します(無いとエラーになります)。

## 4. Backend を直す

対象の機能のディレクトリ(例: `routes/inventory/shipments/`)で、次の順に直します。

| ファイル | 直す内容 |
|---|---|
| `*.schema.ts` | リクエストの入力チェック(Valibot)に項目を追加する。既存の画面・CSV から送られてこなくても動くよう、原則 `v.optional(...)` にする |
| `*.repository.ts` | 登録(`insert`)・更新(`update`)で、項目を保存する。一覧・詳細は `select()` で全列を返している場合は変更不要 |
| `*.service.ts` | 業務ルール(入力値の検証、他の項目との組み合わせのチェックなど)を追加する。エラーは `BadRequestError`・`NotFoundError` などを投げる |
| `index.ts` | 通常は変更不要。API ドキュメントの説明(`describe〇〇Route()`)に影響する場合だけ直す |

- API の既存の項目・URL・レスポンスの形は変えません(項目の**追加**だけにします)。
- 参照先のデータ(例: 倉庫)が存在するかは、service で確認します。

## 5. 周辺の処理のチェックリスト

項目の種類によって、次の場所にも影響します。該当するものを確認してください。

| 確認すること | 場所 | 対応 |
|---|---|---|
| **承認機能の対象か**(承認を有効にすると、申請内容を保存し、承認の確定時に反映する) | `packages/backend/src/workflow-engine/target-adapters/{対象}.adapter.ts` | 承認の確定時に書き込む項目の一覧に追加する。**この項目の追加前に出された申請でも値を消さないよう、申請内容に項目が含まれる時だけ更新する**(例: `...(payload.newField !== undefined && { newField: payload.newField || null })`) |
| **CSV の取込・出力があるか** | `*.service.ts`(または `*-csv.service.ts`)の出力の列と取込の処理 | 出力の見出しと値に追加する。取込は、古い形式の CSV(列が無い)でも動くようにする |
| **サンプルデータの CSV に影響するか** | `sampledata/generate_sampledata.py` | 取込の列を増やした場合は生成スクリプトを直し、`python sampledata/generate_sampledata.py` で作り直す |
| **帳票(PDF)に印字するか** | `*-pdf.service.ts`、`platform/report-templates/` | 印字する値の組み立てに追加する。帳票テンプレートのプレースホルダーを増やす場合は `samplereport/README.md` の対応表も更新する |
| **一覧の並び替え・検索に使うか** | `*.repository.ts` の並び替えを許可する列(`〇〇_SORT_COLUMNS`)・検索条件 | 必要なら追加する |
| **他の伝票に引き継ぐか**(見積 → 受注、発注 → 仕入 など) | 引き継ぎ先の機能の service・画面の引き継ぎ処理 | 必要なら引き継ぎ先にも項目を追加する |
| **監査ログ** | `platform/audit/log-audit-event.ts` を呼んでいる箇所 | 登録・更新の内容をまとめて記録している場合は、通常は変更不要 |

## 6. Frontend を直す

対象の画面のディレクトリ(例: `app/inventory/stock/`)で、次の順に直します。

| 場所 | 直す内容 |
|---|---|
| `_types/index.ts` | 一覧・詳細の型に項目を追加する(Backend が返す名前と同じにする) |
| `_hooks/` | フォームの状態(`useState`)、送信する値、修正時の値の復元(差戻しの修正・再申請を含む)に追加する |
| `_components/` | 入力欄・一覧の列・詳細の表示に追加する |

- 入力欄は共通部品(`FormField`・`FormGrid` など)を使い、文字色のルールを守ります(`bg-white text-slate-900` など。[フロントエンドの構造の7-1](../architecture/frontend.md#7-1-文字の色見やすさ))。
- 選択肢の元になるマスタ(例: 倉庫)は、`apiFetch()` で取得します。
- **差戻しからの修正・再申請の経路が複数ある**画面(URL の `?editId=` から開く場合と、一覧の「修正して再申請」から開く場合など)は、すべての経路で値が復元されることを確認します。

## 7. テストを追加・実行する

- Backend: 対象の機能の `index.test.ts`(または `*.service.test.ts`)に、保存されること・業務ルールのエラーになることのテストを追加します。
- Frontend: 画面のフックのテスト(`_hooks/*.test.ts`)に、送信する値・復元のテストを追加します。
- 実行方法とルールは [テストの実施方法とルール](testing.md) を参照してください。

## 実例: 入庫・出庫に「移動元・移動先の倉庫」を追加した変更

入庫に `source_warehouse_id`(移動元倉庫)、出庫に `destination_warehouse_id`(移動先倉庫)を追加した変更(コミット `8c67ca2`)で、直したファイルは次のとおりです。

| 手順 | ファイル |
|---|---|
| 1. スキーマ | `packages/backend/src/db/schemas/schema-biz.ts` |
| 2. migration | `packages/backend/drizzle/main/0092_next_katie_power.sql`(`ALTER TABLE ... ADD` の2文)、`meta/` |
| 4. Backend | `routes/inventory/receipts/receipts.{schema,repository,service}.ts`、`routes/inventory/shipments/shipments.{schema,repository,service}.ts` |
| 6. Frontend | `app/inventory/stock/_types/index.ts`、`_hooks/useStockReceiptForm.ts`・`useStockShipmentForm.ts`、`_components/ReceiptScanPanel.tsx`・`ShipmentScanPanel.tsx`・`InventoryHistoryPanel.tsx`・`OpenedStockDocumentCard.tsx`、`app/inventory/receiving/page.tsx`・`shipping/page.tsx` |
| 7. テスト | `routes/inventory/receipts/index.test.ts`・`shipments/index.test.ts`、`_hooks/useStockReceiptForm.test.ts`・`useStockShipmentForm.test.ts`、`_components/OpenedStockDocumentCard.test.tsx` |

業務ルール(service)として、次を追加しました。

- 仕入先(得意先)と移動元(移動先)の倉庫は、同時に指定できない
- 指定した倉庫が存在するか確認する
- 移動元(移動先)が、伝票の明細の倉庫と同じなら指定できない

この例では、画面の修正後に「差戻しからの修正・再申請で値が戻らない」経路が2つ見つかりました(URL から開く場合と、一覧から開く場合)。手順6の最後の確認を忘れないようにしてください。
