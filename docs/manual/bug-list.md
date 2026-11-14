# バグ票(Staging での確認で見つかった不具合)

使用マニュアルの作成(実際のブラウザでの操作・キャプチャの撮影)の中で見つかった不具合の一覧です。
**見つけた時点では直さず**、この一覧に沿って、直す内容・順番を相談して決めます。

- 状態: `未対応`(相談前) / `対応予定`(直すことに決定) / `確認待ち`(修正して Staging に反映済み。実機での確認待ち) / `対応しない`(仕様どおり、など)
- 直し終わった不具合は、この一覧から削除します(修正の内容は Git の履歴に残ります)。
- 重要度: `高`(業務が止まる・データが壊れる) / `中`(回避できるが支障がある) / `低`(見た目・分かりにくさ)
- 不具合は `BUG-nnn`、機能追加・仕様変更の要望は `REQ-nnn`、保守の課題(依存の更新・整理など)は `TSK-nnn` で採番します(要望は「要望一覧」、課題は「課題一覧」に記載)。
  CPU 時間の上限対策だけは、まとまりが分かるように `PERF-nn` とします(「CPU時間の対策一覧」に記載)。
- 2026-11-10: 添付のメモと 2026-11-09 のログを、コミット 541a150 のコードと照らし合わせて整理した 39 件(PERF-00〜10・BUG-087〜098・REQ-007〜022)を
  登録した(2026-11-14)。内容・実行順序・決まったことは、下の「詳細」の「2026-11 改修計画」を参照。重要度は仮のもの。原因はコードを読んで特定したもので、
  Staging での再現はしていない。計画の中の認証・API・DB の変更は、2026-11-14 にユーザーが計画どおり進めることを許可した(DB の列・表は着手前に報告する)。
- 2026-11-14: 段階1(PERF-02〜06・08・09・11)を Staging に反映した(コミット 1ea7ac5。migration なし。Backend・Frontend のデプロイ)。
- 2026-11-14: 段階2の PERF-07(PDF をブラウザで生成)を Staging に反映した(コミット d83a0c5。migration なし。Backend・Frontend のデプロイ)。

## 一覧

| No | 状態 | 重要度 | 画面 | 症状 |
|---|---|---|---|---|
| BUG-087 | 対応予定 | 中 | 請求管理・支払管理(消込) | 入金・消込を保存した後でも、✕で閉じると「保存していない編集を破棄しますか？」が出る |
| BUG-088 | 対応予定 | 低 | 商談管理(添付) | 添付ファイルが商談番号のフォルダに入らず、`deals/` の直下に並ぶ |
| BUG-089 | 確認待ち(Staging 未反映) | 高 | 承認タスク・申請履歴 | 購買申請・発注・仕入・売上・入荷指示などで「プレビュー表示は未対応です」となり、内容を確認できない。表示できる種類も項目が足りず、取引先などが番号で出る |
| BUG-090 | 対応予定 | 中 | 進捗確認 | 入荷指示を出しても、入庫が登録されるまで「入荷指示」の欄に出ない。入荷が申請中でも、行を見ると発注の「承認済」しか分からない |
| BUG-091 | 対応予定 | 低 | 入荷(入荷指示) | 発注から入荷指示を作ると、発注の納品場所に指定した倉庫が引き継がれない |
| BUG-092 | 対応予定 | 中 | 検収書・納品書・請求書(PDF) | 担当者の欄に、従業員番号(検収書)や固定の文言「営業部 担当者」(請求書)が出る。納品書に不要な登録番号が出る |
| BUG-093 | 対応予定 | 低 | 出荷・入荷(履歴) | 履歴の「作成者」が従業員番号で、氏名が分からない |
| BUG-094 | 対応予定 | 中 | 支払管理(消込) | 支払額が 0 円の支払は、金額を入力できず消込を完了できない |
| BUG-095 | 対応予定 | 低 | 発注管理(一覧) | 一覧に発注日の列が無い |
| BUG-096 | 対応予定 | 低 | 商談管理(登録) | 新規登録の時、商談担当(自社)が空欄で始まる(ログイン中のユーザーが入っていない) |
| BUG-097 | 対応予定 | 中 | プロジェクトマスタ | 承認機能を有効にしても、承認申請が無い(承認の仕組みも会社設定のスイッチも無い) |
| BUG-098 | 対応予定 | 中 | 発注点/安全在庫マスタ | 承認機能を有効にしても、承認申請が機能しない(同上。DB変更あり) |

## 要望一覧

| No | 状態 | 画面 | 内容 |
|---|---|---|---|
| REQ-006 | 未対応 | 入荷・出荷(倉庫間移動) | 倉庫間移動(横持ち)を、入庫・出庫とは分けた機能にし、出荷指示・入荷指示からも行えるようにする(旧 TSK-004) |
| REQ-007 | 対応予定 | 帳票ダウンロード(OTP) | メールアドレスを入力させる形(見積書など6種類)をやめ、入荷指示書と同じ「コードを発行」を押すだけの形にそろえる |
| REQ-008 | 対応予定 | 発注管理・購買申請 | 保存した後の表示を、仕入管理と同じダイアログにそろえる |
| REQ-009 | 対応予定 | 発注管理・発注書 | 納品場所を「名称」と「所在地」に分ける(DB変更あり) |
| REQ-010 | 対応予定 | 入荷(入荷指示) | 外部倉庫だけでなく、内部倉庫も選べるようにする(出荷指示と同じ) |
| REQ-011 | 対応予定 | 入荷・出荷・在庫管理 | 品目マスタに無い明細は入荷・出荷の対象外にし、自社品・預り品の一時保管を在庫管理の別の台帳で管理する(受入・払出は承認付き。DB変更あり) |
| REQ-012 | 対応予定 | 入荷指示・出荷指示 | 指示書のメールを、PDF の発行と同時に自動で送るのをやめ、納品書・検収書と同じ「メール送信」の操作にする |
| REQ-013 | 対応予定 | 進捗確認 | 受注・発注・見積があれば、後続の工程が起票済みか「未起票」かと、担当する予定の人を見えるようにする |
| REQ-014 | 対応予定 | 進捗確認: 工程ごとの担当設定 | 何を設定する画面かが分からない。画面の説明とマニュアルを直す |
| REQ-015 | 対応予定 | 見積管理 | 失注の状態と、失注日・失注理由を足す。進捗確認では完了扱い(DB変更あり) |
| REQ-016 | 対応予定 | 承認タスク・申請履歴 | プレビューから、元の伝票を別ウィンドウで開けるようにする |
| REQ-017 | 対応予定 | 請求管理 | 請求に承認機能を付け、承認済みの請求書だけ発行・メール送信できるようにする(売上と同じ形) |
| REQ-018 | 対応予定 | 請求管理・支払管理(消込) | 入金と支払の消込に承認を付け、承認後に消込・残高・仕訳へ反映する(DB変更あり。REQ-017 の後) |
| REQ-019 | 対応予定 | 購買申請 | 仕入先はマスタからの選択だけにする(自由入力をやめる) |
| REQ-020 | 対応予定 | 発注管理(回答納期) | 受注とつながらない明細は、希望納期を回答納期に展開する(修正可) |
| REQ-021 | 対応予定 | 入荷(入庫・検収書) | 入庫・入荷実績・検収書の画面から、元の発注を開けるリンクを付ける |
| REQ-022 | 対応予定 | 出荷(納品書) | 納品書の画面から、元の受注を開けるリンクを付ける |
| REQ-023 | 対応予定 | 承認タスク(一括承認) | 一括承認の結果に、次の段の承認待ちになった件数と、その段のロール名(ロールマスタの名称)を出す |

## CPU時間の対策一覧

| No | 状態 | 対象 | 内容 |
|---|---|---|---|
| PERF-00 | 決定済み(変更なし) | プラン | Workers Paid にはせず、無料プランのまま続ける(2026-11-10 決定) |
| PERF-01 | 対応中(1回目の計測済み) | 計測 | どの API が重いかを測る(exceededCpu の件数と CPU 時間を API のパス別に集計)。最初に行う |
| PERF-02 | 確認待ち | 申請履歴 | 1ページ分だけ組み立てる(全件を組み立ててから切り出すのをやめる)。limit の上限 500 → 50 |
| PERF-03 | 確認待ち | 承認待ち一覧 | 自分の分を先に選んでから、1ページ分だけ組み立てる |
| PERF-04 | 確認待ち | auth/profile | 会社設定を1回だけ読む(今は KV の同じキーを26回読んでいる) |
| PERF-05 | 確認待ち | 全 API 共通の前処理 | users の件数の問い合わせを必要な API だけにし、セッションの検証を1リクエストで1回にする |
| PERF-06 | 確認待ち | 画面 | 画面からの同じ API(company-settings・permissions/screens・auth/profile・申請履歴)の重複呼び出しを減らす |
| PERF-07 | 確認待ち | PDF(10種類) | PDF の描画をブラウザへ移す(案B。2026-11-10 決定)。generate-pdf は削除 |
| PERF-08 | 確認待ち | OTP メール | 登録の直後にすぐ送る(再送は今の定期処理を使う) |
| PERF-09 | 確認待ち | 承認・差戻し・取下げ | 同じ履歴・申請を2回ずつ取得しているのを1回にする |
| PERF-10 | 対応しない(当面 A。2026-11-14 決定) | ログイン・帳票テンプレートの変換・メール添付 | 無料プランで残る重い処理を PERF-07 の後に測り、対応を決める |
| PERF-11 | 確認待ち | 進捗確認 | 一覧の取得が CPU 中央値 22 ms・最大 57 ms(PERF-01 の1回目の計測)。「進行中」の絞り込みで起点を最大300件まで走査し、30件ごとに約30回の問い合わせをしている(2026-11-14 追加。方針は相談) |

## 課題一覧

| No | 状態 | 重要度 | 対象 | 内容 |
|---|---|---|---|---|
| TSK-005 | 未対応 | 中 | 依存(backend) | TSK-001 で直せなかった脆弱性: exceljs(依存の uuid・archiver を含む。修正版はメジャーバージョンの格下げ)、zod(テスト用の依存が版を固定) |

## 画面テスト(2026-10-03)

ローカル環境(`wrangler dev`)で、Playwright(Chromium)による画面操作のテストを行った。見つかった BUG-050〜063
(BUG-053 のみ Staging での確認で見つかったもの)は同日中に修正し、起動中のアプリでも確認した(内容は Git の履歴を参照)。
その確認の中で見つかった BUG-064(「受注から選択」「発注から選択」の検索で番号を入れても見つからない)も同日中に修正した。

- 全画面の表示: 57画面を PC(1280px)・スマートフォン(375px)の幅で開き、JS のエラー・API のエラー・ページ全体の横はみ出しは0件。
- サンプルデータの取込: 画面から取り込める31ファイルは、取込順どおりにすべて成功(入金消込・支払消込の2ファイルは、取込画面を追加した後に取り込んで確認)。
- 業務の流れ: 見積 → 受注 → 出庫 → 売上 → 請求 → 入金・消込、発注 → 入庫 → 仕入 → 支払 → 支払消込 を、画面から新規登録して確認した。
- 確認していないもの: 承認ワークフロー(申請・承認。BUG-052 のため実際には無効の状態だった)、PDF の発行・メール送信(BUG-053 を除く)、タブレット幅、出荷・入荷の実績入力。

## 全体の点検(2026-09-29)

ユーザーの依頼で、前回(2026-09-28、揃っていない箇所)とは別の観点で「実際に不具合になりやすい箇所」をコードで点検した
(日付と時差・消費税の端数・複数の表への書き込み・採番・画面の確認の出し方・認証まわり)。見つかったものが BUG-042〜046。
点検して問題が無かったもの: 保存済みの日付(`YYYY-MM-DD`)の表示・CSV 出力(UTC の 0時として往復するため日付はずれない)/
一覧の期間での検索(日本時間の 0時を基準にしている)/ 薄いグレーの文字(0件)/ 500 の応答にエラー文を入れている箇所(0件)。

## 気づいたこと(記録)

- バックエンドのテストを全体で実行すると、在庫の承認の流れのテスト(廃棄・返品・品質区分変更)が時間切れで失敗することがある(単独では成功。負荷による一時的なもの)。
- 管理番号の自動採番(`platform/id/generate-short-code.ts` の `resolveUniqueId`)は「重複を調べてから保存」の順のため、同じ番号が同時に登録されると
  片方が 500 になりうる(日付+乱数4桁のため、起きる可能性は低い。不具合としては挙げていない)。



## 詳細

### 2026-11 改修計画(PERF-00〜10・BUG-087〜098・REQ-007〜022)

- 作成: 2026-11-10(添付のメモと 2026-11-09 のログを、ブランチ `fix/2026-11-bug-list`・コミット 541a150 のコードと照らし合わせて整理)。
  バグ票への登録は 2026-11-14。
- 方針(2026-11-10 決定): 無料プランのまま続ける。PDF は無料プランの CPU 上限(10 ms)に収まらないため、描画をブラウザへ移す(PERF-07)。
  申請履歴と承認待ちの一覧は、件数が増えるほど重くなる作りなのでコードで直す(PERF-02・03)。ログインなど残る重い処理は、計測してから対応を決める(PERF-10)。
- 確かめていないこと: 原因はコードを読んで特定したもので、Staging での再現はしていない。CPU 時間の数値は作業環境での実測で、Workers 上の値は PERF-01 で測る。
- 行番号は 2026-11-10 時点(コミット 541a150)のもの。ずれていたら近くの同じコードを探す。パスは `packages/` からの相対(`backend/src/…`・`frontend/app/…`)。

#### 実行する AI への共通ルール

- 各項目(PERF-nn・BUG-nnn・REQ-nnn)は、1項目を1回の作業として、下の「実行順序」の順に実行する。リポジトリ直下の CLAUDE.md が最優先で、
  この計画と食い違う場合は作業を止めて利用者に確認する。
- 利用者は別の場所でも開発しているため、作業の最初に `git pull` と `git status` を行う。コミット・プッシュは指示があるまで行わない。
- この計画が許可していること: 各項目の「変更内容」に書いた範囲の API の応答の変更・DB の列の追加・Cloudflare 設定(`wrangler.jsonc.example`)の変更。
  それ以外の DB・認証・Cloudflare 設定・package.json・sampledata/ は変更しない(2026-11-14 に、計画の中の変更はすべて計画どおり進めてよいと許可を得た)。
- DB を変える項目(「DB変更あり」): 既存の migration は編集しない。`packages/backend/src/db/schemas/` を変え、`npm run db:generate-main`(対象の DB に合わせる)で
  新しい migration を1つ足す。着手前に、足す列を利用者に報告する。
- 1項目の進め方:
  1. 「対象」のファイルを読み、書いてある現状が今のコードと合っているか確かめる(合わなければ報告して止まる)。
  2. 先に失敗するテストを書く(バックエンドは packages/backend の vitest、画面は packages/frontend の vitest)。
  3. 実装し、対象のテストと `npx tsc --noEmit` を通す。バックエンドのテスト全体は時間切れで落ちることがあるため、対象のテストファイルを指定して実行する。
  4. この一覧の該当の行の状態を `確認待ち` にする。画面の動きが変わる場合は docs/manual/ の該当ページも直す。
  5. 変更したファイルの一覧と、「確認方法」を実行した結果を報告する。
- 完了の条件: 各項目の「確認方法」がすべて通ること。Staging へのデプロイと実機での確認は利用者が行う。
  承認申請の種類を足す項目・申請される伝票やマスタの入力項目を変える項目では、承認プレビューの設定とそのテスト(BUG-089)の更新も完了の条件に含める。
- 規模: 小(1〜3ファイル) / 中(画面と API の両方) / 大(DB の変更や新しい承認の流れを含む)。

#### 実行順序

段階1(安定化)を先に終え、Staging で計測し直してから段階2以降に進む。同じ段階の中は、書いてある順に1項目ずつ実行する。

| 段階 | 目的 | 項目(この順に) | 次の段階へ進む条件 |
|---|---|---|---|
| 1 | 承認・申請履歴の安定化 | PERF-01 → PERF-04 → PERF-05 → PERF-02 → PERF-11 → PERF-03 → PERF-06 → PERF-09 → PERF-08 | Staging に反映し、PERF-01 と同じ集計で exceededCpu が減ったことを確かめる |
| 2 | PDF をブラウザで生成 | PERF-07(B-1 → B-2 → B-3 → B-4 → B-5 → B-6) → PERF-10 | Staging で10種類の帳票を発行できること。PERF-10 の計測結果を利用者に報告する |
| 3 | 承認のテストを最後まで通せるようにする | BUG-089 → REQ-016 → BUG-090 → BUG-087 → BUG-094 → BUG-097 → BUG-098 | 承認のスイッチがある全ての画面で申請でき、プレビューが出ること |
| 4 | 小さな不具合と表示の統一 | BUG-088 → BUG-095 → BUG-096 → BUG-093 → BUG-092 → REQ-008 → REQ-019 → REQ-020 → REQ-021・022 | BUG-092 は PERF-07 の B-1 で移した描画のコードを直す |
| 5 | 入荷指示・帳票の流れ | REQ-010 → BUG-091 → REQ-012 → REQ-007 → REQ-009 → REQ-011(1) | REQ-007・REQ-009 は着手前に利用者へ報告(認証の方式・DB の変更) |
| 6 | 見積・進捗確認 | REQ-015 → REQ-013 → REQ-014 | REQ-013 の「未起票」は失注を前提にするため、REQ-015 を先に行う |
| 7 | 請求・入金・支払の承認 | REQ-017 → REQ-018 | DB に足す列を着手前に報告 |
| 8 | 一時保管 | REQ-011(2) → REQ-011(3) | DB に足す表を着手前に報告 |

段階1は、変更が小さく効果が全画面に及ぶもの(PERF-04・05)を先にし、次に落ちる回数が多い申請履歴(PERF-02)を置いた。PERF-03 は PERF-02 で作る部署の判定の関数を使う。PERF-11(2026-11-14 追加)は、PERF-02 と同じ考え方で直すため PERF-02 の直後に置いた。
無料プランで続けるため、PDF(段階2)は承認のテスト(段階3)より前に置いた。

#### 決まったこと(2026-11-10)

| No | 決定 |
|---|---|
| PERF-00 | Workers Paid にはしない。無料プランで続ける |
| PERF-07 | PDF はブラウザで生成する(案B)。共有パッケージ packages/report-renderer の追加と、そのための package.json の変更を許可 |
| REQ-011 | 品目マスタに無い明細は、発注・受注からの入荷・出荷の対象外。一時保管は在庫管理の台帳で、自社品と預り品の両方を扱う。受入・払出には承認を付け、承認フローが無ければ承認なし |
| REQ-015 | 見積に失注日と失注理由(文字)を足す。進捗確認では完了扱い |
| REQ-017 | 売上と同じ形(作成 → 承認申請 → 承認済みだけ発行・送信)。会社設定のスイッチ付き |
| REQ-018 | 入金と支払の消込を1件ごとに承認し、承認後に消込・残高へ反映。REQ-017 の後に同じ形で作る |
| REQ-020 | 発注単体(受注とつながらない明細)は希望納期を回答納期に展開し、修正できる |

回答が無かったため、おすすめの案で進めるもの(違う場合は着手前に知らせてもらう):

- REQ-011: 発注の明細から一時保管で受け入れても、発注の「入荷済数量」には数えない(台帳に発注番号を残す)。
- REQ-015: 失注の見積は受注にできない。「失注を取り消す」で元の状態に戻せる。

まだ決まっていないこと:

- PERF-10: ログインが CPU の上限で失敗した場合の扱い。A: そのまま(ログインは1日に数回で、失敗してもやり直しで通る) / B: パスワード照合の回数を減らす(安全性が下がる)。
  PERF-07 の後に失敗の回数を測ってから決める。それまでは A。

CLAUDE.md の「変更前に確認」に当たるもの(2026-11-14 に、計画どおり進めることを許可済み):

- 認証まわりに触れるもの: PERF-04・PERF-05(判定は変えず、読み取りの回数だけ減らす)、REQ-007(OTP の宛先の決め方が変わる)。
- API の形が変わるもの: PERF-02(limit の上限 500 → 50)、REQ-007(email が任意に)、REQ-012(メール送信の API を追加、PDF 生成はメールを送らなくなる)、
  REQ-013(応答に項目を追加)、PERF-07(PDF のデータ・受け取り・フォントの API を追加し、`generate-pdf` を削除)、REQ-017・018(承認申請の API を追加)。
- DB に列・表を足すもの: REQ-009(`orders.delivery_place_address`)、REQ-011(2)(一時保管の2つの表)、REQ-015(`quotes.lost_date`・`lost_reason`)、
  REQ-017(承認のための列が要れば)、REQ-018(`payment_receipts`・`cash_receipts`・`payment_disbursements` の `approval_status`)。

### CPU時間の上限対策(PERF-00〜10)

原因(コードと実測で確認したこと):

| 処理 | 確認した内容 | 無料プランの上限 |
|---|---|---|
| PDF 生成(見積・発注書・請求書など10種類) | 日本語フォント(3.7MB)の埋め込みと文字の配置で、1枚あたり CPU 115〜215 ms(作業環境の Node で同じライブラリを実測。Workers 上の値は前後する) | 1リクエスト 10 ms |
| ログインのパスワード照合 | PBKDF2 10万回で CPU 20〜26 ms(同上)。安全のための回数で、減らせない | 1リクエスト 10 ms |
| 申請履歴 `GET /api/workflow-tasks/history` | ページ指定があっても、全ての履歴を取得し、申請1件ごとに内容の読み込み・承認者の解決を行ってから、最後に1ページ分を切り出している。DB への問い合わせ回数が申請の総数に比例する | D1 は1リクエスト 50 回まで |
| 承認待ち `GET /api/workflow-tasks/my-pending` | 全社の承認待ちを取得し、1件ごとに5〜8回の問い合わせをしてから自分の分を選んでいる | 同上 |
| `GET /api/auth/profile`(全画面で呼ぶ) | 会社設定(KV の同じキー)を26回読み、26回 JSON として解釈している | 10 ms |
| 全 API 共通の前処理 | 毎回 users の件数を数える問い合わせ(初期セットアップ用)と、セッションの検証を2〜3回行っている | — |
| OTP メール | 送信待ちの表に登録するだけで、実際の送信は1分ごとの定期処理。最大で約1分待つ | — |

軽い API まで同じ時刻にまとめて落ちているのは、Cloudflare が上限を「たまに超える分は見逃し、続けて超えると打ち切る」動きをするためと考えられる
(推測。PERF-01 で確かめる)。上限の値は Workers の制限・D1 の制限で 2026-11-10 に確認した。

#### PERF-00 プラン(決定: 無料プランのまま)

- 決定: Workers Paid にはしない。コードの変更はない。
- その結果必要になること: PDF をブラウザで生成する方式への作り替え(PERF-07)と、ログイン・定期処理など残りの重い処理の計測と対応(PERF-10)。
- README: README.md・docs/architecture/overview.md の「無料プランで動く構成」はそのまま。PERF-07 の完了時に「PDF はブラウザで生成する(CPU 時間の上限のため)」を足す。

#### PERF-01 どの API が重いかを測る(最初に行う)

- 内容: Cloudflare ダッシュボード → Workers & Pages → `my-erp-backend-staging` → Logs で、`outcome = exceededCpu` の件数を API のパス別に集計し、
  上位10件と各 API の CPU 時間(中央値・最大)を表にする。利用者が画面から書き出したログを受け取って集計してもよい。
- 確認方法: 表をこの項目に貼る。PERF-02 以降の完了後に同じ集計をもう一度行い、前後を比べる。
- 計測(1回目、2026-11-14 09:00〜09:06): `npx wrangler tail --env staging --format json` で記録し、利用者が Staging を操作した 177 件(API と定期処理)を集計した。
  - **exceededCpu は 0 件**(全件 ok)。短い時間・少ない回数だったため、上限を超えても打ち切られなかったと考えられる(2章の推測と矛盾しない)。
    このため「落ちた件数」ではなく、**CPU 時間が 10 ms を超えた API** を対策の目安にする。
  - 生のログには Cookie が含まれるため、集計の後に削除した。番号の部分は `:id` にまとめた。
  - CPU 時間の上位(10 ms を超えたもの。単位 ms):

    | API | 回数 | CPU 中央値 | CPU 最大 | 10 ms 超の回数 | 対応する項目 |
    |---|---|---|---|---|---|
    | POST /api/sales-orders/bulk-send-email | 1 | 440 | 440 | 1 | PERF-07(送信の時に PDF をサーバーで作っている) |
    | GET /api/workflow-tasks/history | 20 | 103.5 | 206 | 20 | PERF-02 |
    | 定期処理(毎分) | 7 | 52 | 112 | 5 | PERF-08・PERF-10(メール送信・添付・テンプレート変換) |
    | POST /api/auth/login | 4 | 35.5 | 51 | 4 | PERF-10 |
    | GET /api/progress | 5 | 22 | 57 | 5 | PERF-11(2026-11-14 追加) |
    | POST /api/workflow-tasks/bulk-approve | 1 | 35 | 35 | 1 | PERF-09 |
    | GET /api/permissions/screens | 27 | 2 | 34 | 1 | PERF-06(回数) |
    | GET /api/workflow-tasks/my-pending | 12 | 6 | 33 | 3 | PERF-03 |
    | POST /api/purchase-requisitions/:id/submit-for-approval | 1 | 33 | 33 | 1 | (承認申請。様子を見る) |
    | GET /api/users/count | 4 | 2.5 | 23 | 1 | PERF-05 |
    | POST /api/quotes/:id/submit-for-approval | 2 | 18.5 | 22 | 2 | (承認申請。様子を見る) |
    | GET /api/auth/profile | 10 | 8.5 | 21 | 4 | PERF-04 |
    | POST /api/workflow-tasks/approve | 1 | 19 | 19 | 1 | PERF-09 |
    | POST /api/workflow-tasks/remand | 1 | 13 | 13 | 1 | PERF-09 |

  - 呼び出しの回数: company-settings が 20 回、permissions/screens が 27 回、申請履歴が 20 回(PERF-06 の重複呼び出しと合う)。
  - この記録には、単独の PDF 発行(generate-pdf)は含まれていない。PDF の CPU 時間は bulk-send-email の 440 ms で代わりに確かめた。
  - 注: 進捗確認(GET /api/progress)は計画の対象に入っていなかったため、PERF-11 として追加した。
- 計測(2回目、段階1を Staging に反映した後。2026-11-14 10:08〜10:16、141 件。生のログは集計後に削除):
  - **exceededCpu は前回と同じく 0 件**(全件 ok)。1回目も 0 件だったため「件数が減った」ことは確かめられない。CPU 時間で比べる。

    | API | 1回目 回数 | 1回目 中央値/最大(ms) | 2回目 回数 | 2回目 中央値/最大(ms) | 項目 |
    |---|---|---|---|---|---|
    | GET /api/workflow-tasks/history | 20 | 103.5 / 206 | 7 | 20 / 68 | PERF-02(大きく改善) |
    | 定期処理(毎分) | 7 | 52 / 112 | 9 | 10 / 69 | PERF-08(確認コードのメールの送信が API 側に移った) |
    | GET /api/progress | 5 | 22 / 57 | 8 | 30 / 45 | PERF-11(最大は下がったが、中央値は下がっていない) |
    | GET /api/workflow-tasks/my-pending | 12 | 6 / 33 | 8 | 14.5 / 28 | PERF-03(最大は下がったが、中央値は上がった。下の注) |
    | GET /api/auth/profile | 10 | 8.5 / 21 | 6 | 6.5 / 15 | PERF-04 |
    | GET /api/users/count | 4 | 2.5 / 23 | 2 | 4.5 / 5 | PERF-05 |
    | POST /api/workflow-tasks/bulk-approve | 1 | 35 / 35 | 1 | 29 / 29 | PERF-09 は対象外(一括承認) |
    | POST /api/workflow-tasks/approve | 1 | 19 / 19 | 1 | 32 / 32 | PERF-09(1回ずつのため比べられない) |
    | POST /api/auth/login | 4 | 35.5 / 51 | 2 | 34 / 38 | PERF-10(変更なし) |
    | POST /api/quotes/download-request | — | — | 1 | 170 / 170 | PERF-08(確認コードのメールを応答の後に同じ処理の中で送るため) |
    | POST /api/quotes/bulk-send-email | — | — | 1 | 1263 / 1263 | PERF-07(PDF をサーバーで作っている) |

  - 呼び出しの回数(PERF-06): 会社設定 20 回 → 5 回、画面の一覧 27 回 → 10 回、プロフィール 10 回 → 6 回(操作の量が違うため目安)。
  - メール: 期間中に登録したメール9件(承認の通知・見積の送付・確認コード)は全て送信済み(SUCCESS、再送なし)。
  - 注:
    - 承認待ち一覧は、Staging の件数が少ないため、PERF-03 で足した固定の読み込み(承認フロー・段・ロールの全件)の分だけ中央値が上がったと考えられる。
      件数が増えた時に効く作りのため、このままとし、件数が増えても重いままなら相談する。
    - 確認コードの発行は、メールの送信(SMTP)の CPU 時間が API 側に入るようになった(以前は定期処理の側で同じ時間を使っていた)。
      打ち切りは起きていないが、無料プランの上限を超える処理のため、PERF-10 の計測の対象に加える。

#### PERF-02 申請履歴: 1ページ分だけ組み立てる

- 対象: `backend/src/routes/workflow/workflow-tasks/workflow-tasks-history.service.ts`(getHistory・getHistoryPage)、`workflow-tasks.repository.ts`、
  `frontend/app/workflow/histories/_hooks/useWorkflowHistory.ts`
- 現状: getHistoryPage は getHistory を絞り込みなしで呼び、全件の HistoryItem(プレビュー・承認の進み具合つき)を作ってから、件数の集計・絞り込み・slice をしている。
- 変更内容:
  - 一覧の判定に必要な軽い列だけを、履歴(`workflow_logs`)と申請(`master_approval_requests`)を結合した1回の問い合わせで取得する関数を repository に足す
    (requestId が空の古い行は、今と同じく targetType・targetId の最新の申請に結び付ける)。
  - 表示対象の判定(自分の申請・自分の操作・自分が承認者)、タブごとの件数、絞り込み、並べ替え、ACTIVE_TASKS の重複の除外は、この軽い行だけで行う。
  - 部署の判定は、ログインユーザーのロール(myUserRoles)と、まとめて取得したフローの段(`approval_flow_steps` を inArray で1回)から計算する。
    `WorkflowEngine.resolveApprovers` と同じ結果になることをテストで確かめ、同じにできない条件があれば報告して止まる。
  - slice で切り出した1ページ分の行にだけ、名前・プレビュー・承認の進み具合を付ける。ユーザー名・ロール名・フローの段・関連する履歴は、行ごとではなく inArray でまとめて取得する。
  - limit の上限をこの API だけ 50 にする。画面は、会社設定でページングが無効でも 50 件ずつのページ送りを出す(limit=500 をやめる)。
  - ページ指定なしの古い形(`{histories, isAdmin}`)を呼ぶ画面が無いことを grep で確かめ、無ければその分岐を削除する。
- API の変更: 応答の形は変えない。limit の上限だけ 500 → 50。
- 確認方法: 既存の `workflow-tasks-history.service.test.ts`・`workflow-tasks-history.index.test.ts` が通る。追加のテストで、申請を 10 件と 200 件登録した場合の
  D1 の問い合わせ回数(`env.DB.prepare` を数える)が同じであること、limit=10 で 30 回以下であることを確かめる。
- 実装(2026-11-14):
  - `workflow-tasks.repository.ts`: `getHistoryRows`(履歴と申請を結合した1回の問い合わせ。履歴の申請・対象の承認待ちの申請・自分が申請した対象か、を
    一緒に取得)と、まとめて取得する関数(承認フローと段の全件・ロール名の全件・user_roles・ユーザー名・承認者の候補・対象の履歴)を追加。
  - `workflow-tasks-history.service.ts`: `collectHistoryRows`(軽い行で表示対象の判定・部署の判定・申請者と期間の絞り込み・並べ替え)と
    `buildHistoryItems`(渡した行だけに名前・プレビュー・承認の進み具合を付ける)に分けた。getHistoryPage は件数の集計・タブの絞り込み・
    ページの切り出しを軽い行で行い、1ページ分だけ組み立てる。getHistory(全件。テストと他機能のテストが使う)は同じ部品で全件を組み立てる。
    部署の判定は `isResolvedApprover`(ログインユーザーのロールから計算)にし、resolveApprovers と同じ結果になることをテストで確かめた。
    承認の進み具合の承認者の候補は、buildFlowProgress に任意の引数 `resolveCandidateNames` を足し、まとめて取得したデータから解決する
    (承認待ち一覧(PERF-03 の対象)は渡さないため、今の動きのまま)。フローを金額で選ぶ必要がある時だけ金額を取得する。
  - `index.ts`(GET /history): ページ指定なしの古い形の分岐を削除(画面の呼び出し2か所はどちらもページを指定している)。limit の上限を 50 にした。
  - 画面: `useWorkflowHistory.ts` は会社設定のページングを読まず、常に page・limit(既定50)を送る。古い形の応答の処理を削除。
    `page.tsx` は常にページ送りを出す(件数の選択は 20・50)。会社設定を待たないため、開いた時の履歴 API の呼び出しが1回になった(PERF-06 の一部)。
    マニュアル(docs/manual/workflow/histories.md)に1ページ50件までの説明を足した。
  - 問い合わせ回数(テストで計測): 申請 10 件・200 件とも同じ回数で 30 回以下(管理者・申請者・承認者)。直す前は 10 件で約70回、200 件で約1210回。
  - 確認の結果: 申請履歴のテスト(service 17件・API 5件)、承認タスク関係・承認の流れを使う他機能のテスト(承認タスク 96件、workflow-engine・
    マスタ・入庫 357件、購買・販売・在庫の承認 182件)、画面のテスト(申請履歴・ダッシュボード 26件)、backend・frontend の `npx tsc --noEmit` が通った。
    画面の lint は、変更前からある1件(react-hooks/set-state-in-effect)のみで、増えていない。
  - 動きの違い(報告事項):
    - 一般ユーザーの一覧で、処理状況と処理日時が同じ行同士の並びが、以前と変わる場合がある(以前は取得の順、今は処理日時・id の降順)。
    - マニュアル撮影のスクリプト(`packages/frontend/scripts/manual-capture/capture-approval.mjs`)はページを指定せずに呼んでおり、
      今後は先頭の50件だけを受け取る(取り下げの対象の承認待ち・差戻しは並びの先頭に来るため、実用上の影響は小さい。スクリプトは変更していない)。

#### PERF-03 承認待ち一覧: 自分の分を先に選ぶ

- 対象: `workflow-tasks-queue.service.ts`(getMyPendingTasks とそのページ版)
- 変更内容: PERF-02 と同じ考え方にする。承認待ちの履歴と申請を1回で取得 → 自分が承認者かを軽い行で判定 → ページを切り出す → その行にだけプレビュー・進み具合を付ける。
  部署の判定の関数は PERF-02 で作ったものを使う。
- 確認方法: `workflow-tasks-queue.service.test.ts` が通る。全社の承認待ちが 5 件と 100 件で、問い合わせ回数が変わらないこと。
- 実装(2026-11-14):
  - `workflow-tasks.repository.ts`: `getPendingTaskRows`(承認待ちの履歴と、その対象の承認待ちの申請を1回の問い合わせで取得)を追加。
  - `workflow-tasks-queue.service.ts`: `collectMyPendingRows`(軽い行で自分が承認者かを判定)と `buildTaskItems`(残った行にだけ申請者名・
    プレビュー・承認の進み具合を付ける)に分けた。判定は今と同じ順(管理者 → その段のロールを部署の指定なしで持つ → 承認フローから解決した
    承認者に含まれる)で、最後の判定は PERF-02 の `isResolvedApprover` を使う。ページ版は件数を軽い行で数え、1ページ分だけ組み立てる。
    ページ指定なしの形(承認タスクの画面が使う)は残した(自分の分の全件を返す。応答は変えていない)。
  - `workflow-tasks-history.service.ts`: PERF-02 で作った承認の進み具合をまとめて組み立てる準備を `prepareFlowProgressContext` に切り出し、
    申請履歴と承認待ち一覧の両方で使う。
  - 問い合わせ回数(テストで計測): 自分の分が3件の時、全社の承認待ちが 5 件・100 件とも同じ回数。直す前は 5 件で 33 回、100 件で 128 回。
  - 確認の結果: `workflow-tasks-queue.service.test.ts`(既存8件+追加2件)、承認タスク関係(95件)、workflow-engine・入庫・見積・発注・受注・
    アプリ全体のテスト(425件)、`npx tsc --noEmit` が通った。

#### PERF-04 auth/profile: 会社設定を1回だけ読む

- 対象: `backend/src/routes/auth/auth.service.ts`(getProfile)、`backend/src/workflow-engine/settings.ts`
- 変更内容: settings.ts に、解釈済みの会社設定を受け取って26個のフラグをまとめて返す関数(例: `readWorkflowFlags(config)`)を足す。getProfile は getCompanySettings を
  1回呼び、その結果を渡す。既存の `is〜WorkflowGloballyEnabled(kv)` は他の場所で使っているので残し、中身は新しい関数を呼ぶ形にする。
  ロールごとの権限の取得(fetchPermissionsForRole)は Promise.all にする。
- 認証への影響: 応答の内容は変えない(読み取りの回数だけ減らす)。
- 確認方法: getProfile の既存テストが通る。テストで `COMPANY_SETTINGS.get` の呼び出しが1回であること。
- 実装(2026-11-14):
  - `workflow-engine/settings.ts`: スイッチ名と会社設定のキーの対応表と、`readWorkflowFlags(config)` を追加。26個の `is〜WorkflowGloballyEnabled(kv)` は
    残し、中身を共通の処理(KV を読む → readWorkflowFlags)に置き換えた。判定(true と "true" だけが ON、失敗は OFF)と失敗の時のログの文言は同じ。
  - `routes/auth/auth.service.ts`(getProfile): 会社設定を `getCompanySettings` で1回だけ読み、readWorkflowFlags の結果を応答に入れる
    (応答の項目名・値は同じ。読めない・壊れている時は全て false)。ロールごとの権限の取得を Promise.all にした。
  - テスト: `routes/auth/index.test.ts` に3件(26個の値が会社設定どおり・config の読み取りが1回・設定が無い/壊れている時は全て false)、
    `workflow-engine/settings.test.ts`(新規)で26個の関数ごとに読むキーと判定が変わらないこと。
  - 確認の結果: 上のテスト(88件)、`src/index.test.ts`・会社設定・単位マスタ・見積のテスト(115件)、`npx tsc --noEmit` が通った。

#### PERF-05 全 API 共通の前処理を軽くする

- 対象: `backend/src/index.ts`(「2. セキュリティ & 救済処理ミドルウェア」)、`platform/auth/get-session.ts`
- 変更内容:
  - users の件数を数える問い合わせは、パスが `/api/users/count` か `/api/users/setup-admin` の時だけ行う(結果を使うのはこの2つだけ)。
  - `getSession(c)` の結果を、同じリクエストの中だけ `c.set` / `c.get` で使い回す(sessionGuard・adminGuard・各 API が別々に検証している)。
- 認証への影響: 判定の結果は変えない。API キーの確認・セッションの確認・管理者の確認の順番と条件はそのまま。
- 確認方法: guard-admin-apis・guard-revoked-sessions に関するテストと routes/auth のテストが通る。ユーザー0件の時に上の2つの API が API キーなしで通り、他は 401 になること。
- 実装(2026-11-14):
  - `src/index.ts`: users の件数の問い合わせを、パスが `/api/users/count`・`/api/users/setup-admin` の時だけ行うようにした(判定の条件と順番は同じ)。
  - `platform/auth/get-session.ts`: getSession の結果を、リクエストごとの Context をキーにした WeakMap で使い回す(リクエストが終われば破棄)。
    計画の例の `c.set` / `c.get` にすると、全 API の `Context<{ Bindings: Env }>` の型を変える必要があるため、同じ効果のこの形にした。
    検証の対象はリクエストの cookie で、途中で変わらないため、結果は毎回検証した場合と同じ(ログイン・パスワード変更で cookie を発行し直しても、
    同じリクエストの中の getSession は以前もリクエストの cookie を見ていた)。
  - テスト: `src/index.test.ts` に4件(ユーザー0件の時の2つの API と他の API の 401・ユーザーがいる時の 401・件数の問い合わせが他の API で行われない・
    1リクエストでセッションの検証が1回)。
  - 確認の結果: `src/index.test.ts`・routes/auth(57件)、routes/admin・users・会社設定など(313件)、routes/workflow・user-preferences(92件)、`npx tsc --noEmit` が通った。

#### PERF-06 画面からの同じ API の重複呼び出しを減らす

- 対象: `frontend/app/_shared/hooks/use-api-fetch.ts` と、`/api/company-settings`(12ファイル)・`/api/permissions/screens`・`/api/auth/profile` を呼んでいる箇所、`useWorkflowHistory.ts`
- 現状: 1画面を開くと company-settings が2〜3回、permissions/screens が2〜3回呼ばれる(2026-11-09 のログで確認)。申請履歴の画面は、ページングの設定を読み終える前後で履歴 API を2回呼ぶ。
- 2026-11-14: 申請履歴の画面で履歴 API を2回呼ぶ点は、PERF-02 で解消した(会社設定のページングを読まなくなったため)。
- 実装(2026-11-14):
  - `_shared/hooks/use-api-fetch.ts`: `apiFetchShared`(同じ URL の GET を30秒間まとめる。同時の呼び出しも1回の通信にする。失敗はまとめない。
    呼び出し元ごとに複製を返す)・`clearSharedApiCache`・`ApiFetchError`(ステータスを持つエラー)を追加。
  - 置き換えた箇所(参照だけの GET): 会社設定 10ファイル(仕入・見積・売上・発注・受注・請求の各フォーム、パスワード方針・消費税の端数・
    ページングの共通フック、営業拠点の選択)、画面の一覧 3ファイル(権限・承認フロー・申請の共通)、`hooks/use-auth-and-menu.ts`
    (全画面で画面を移るたびに呼ぶプロフィールと画面の一覧。401 ならログイン画面へ移る判定はそのまま)。
  - 置き換えていない箇所: 会社設定・メール設定の編集画面と、プロフィールの画面・パスワードの強制変更の画面(最新を読む必要があるため)。
  - 破棄するタイミング: 会社設定の保存(全て)、メール設定の OTP の保存(会社設定)、権限の保存・CSV 取込(全て)、通知設定の保存(プロフィール)、
    ログアウト・ログイン(全て。同じタブで別の人がログインした時に前の人の情報を使わないため)。画面のテストでは毎回破棄する(`vitest.setup.ts`)。
  - テスト: `use-api-fetch.test.ts` に5件、`purchase/receipts/page.test.tsx` に1件(仕入の新規計上を開いた時の会社設定の取得が1回。直す前は3回)。
  - 確認の結果: 画面のテスト全件(216ファイル・1238件)、`npx tsc --noEmit` が通った。変更したファイルの lint のエラーは変更前と同じ件数。
  - 注意: 他の管理者が会社設定や権限を変えた場合、他の人の画面に反映されるまで最大30秒かかる。
- 変更内容: 上の3つの GET に限り、同じ URL の呼び出しを30秒間まとめる小さな関数(例: `apiFetchShared`)を足して置き換える。会社設定を保存した時は破棄する。
  useWorkflowHistory は、ページングの設定の読み込みが終わってから最初の取得を行う。
- 確認方法: 画面のテストで、仕入管理の画面を開いた時の company-settings の呼び出しが1回であること。申請履歴の画面で履歴 API が1回であること。

#### PERF-07 PDF をブラウザで生成する(案B。2026-11-10 決定)

PDF の描画を API からブラウザへ移す。サーバーは「帳票のデータを返す」「ブラウザが作った PDF を受け取って保存する」だけを行い、どちらも 10 ms に収まる軽い処理にする。
保存先(R2)・ファイル名・ダウンロード用の URL・メールの添付は変えないため、取引先から見た動きは今と同じ。対象は10種類の帳票(見積書・注文請書・納品書・売上関連書類・
請求書・発注書・検収書・仕入関連書類・入荷指示書・出荷指示書)で、規模は大。

- 発行の流れ(変更後):
  1. 画面で「PDF 発行」を押す。
  2. ブラウザが `GET /api/<帳票>/:id/pdf-source` を呼ぶ。差し込む値・明細・レイアウトの種類と、Excel テンプレートがあればその変換済みのレイアウト(layout.json)が返る。
  3. ブラウザがフォント・ロゴ・社印を読み込む。フォント(3.7MB)は初回だけダウンロードし、以後はブラウザに保存したものを使う。
  4. ブラウザが、今サーバーで使っているのと同じ描画のコード(pdf-lib)で PDF を作る。
  5. ブラウザが `POST /api/<帳票>/:id/pdf` で PDF を送る。サーバーは検証して R2 に保存し、今の generate-pdf と同じ後処理(伝票への記録・状態の更新・監査ログ)を行う。
- 作業(この順に、1つずつ):
  - **B-1 描画のコードを共有パッケージに移す**: `backend/src/utils/pdfGenerator.ts`、`platform/report-templates/` の render-layout-pdf.ts・compute-render-pages.ts・
    compute-render-instructions.ts・fit-text.ts・format-values.ts・generate-instruction-pdf.ts・compute-quote-amount-breakdown.ts、`jsons/reportLayouts.json` を、
    新しいワークスペース `packages/report-renderer` に移す。DB・R2・Hono に依存しない形にし(フォント・画像は ArrayBuffer で受け取る)、backend も移行の間はそこから使う。
    package.json の変更(ワークスペースの追加、frontend に pdf-lib・@pdf-lib/fontkit)を含むため、2026-11-10 に利用者の許可を得た(この作業に必要な範囲だけ変更する)。
    確認: 移す前と後で、同じ入力から同じページ数・同じ文字列の PDF になること(帳票の種類ごとのテスト)。
  - **B-2 フォント・ロゴ・社印を返す API**: `GET /api/report-assets/font`・`/logo`・`/seal`。SYSTEM_BUCKET のオブジェクトを読み込まずにそのまま流す(arrayBuffer にしない)。
    ETag と Cache-Control を付け、フォントを差し替えたら新しいものが使われるようにする。ログインが必要。
  - **B-3 帳票のデータを返す API**: 10個の `*-pdf.service.ts` を「データを組み立てる部分」と「描画・保存する部分」に分け、前者を `GET /:id/pdf-source` として出す。
    応答は、帳票の種類・既定レイアウト用のデータ(今の PDFInvoiceData / InstructionPdfData)・Excel テンプレートが有効ならそのレイアウトと差し込む値。
    今の `tryRender…FromCustomTemplate` の判定はここに移す。権限は伝票の参照権限。
  - **B-4 PDF を受け取る API**: `POST /:id/pdf`(ファイル1つ)。次を確かめてから R2 に流し込む: 先頭が `%PDF-` であること、大きさが上限(5MB)以下、
    伝票が今の generate-pdf と同じ発行できる状態、利用者がその画面の更新権限を持つこと。保存後は今の generate-pdf の後処理をそのまま行う。監査ログに、誰がどの大きさの PDF を上げたかを残す。
  - **B-5 画面の共通処理**: `frontend/app/_shared/hooks/` に、上の2〜5を行うフック(例: `useIssuePdf(帳票の種類, id)`)を足し、10画面の「PDF 発行」をこれに切り替える。
    フォントはブラウザの Cache Storage に保存する。描画中は「PDF を作成しています」を出す。
  - **B-6 サーバーが自動で PDF を作っている箇所をやめる**:
    - 納品書: 出庫の確定・承認の確定・直送完了で呼んでいる generateAndStore(`workflow-engine/target-adapters/inventory-stock.adapter.ts` 153行目、
      `routes/inventory/shipments/shipments.service.ts` 450・551行目、`routes/purchase/orders/purchase-order-direct-shipment-confirm.ts` 83行目)をやめ、納品書の欄に「未発行」と発行ボタンを出す。
    - メール送信: 9個の `*-mail.service.ts` は、PDF が無ければ送信の時にサーバーで作っている(例: quote-mail.service.ts 80・242行目)。これをやめ、PDF が無ければ
      400「先に PDF を発行してください」を返す。画面は、送信の前に未発行なら B-5 を自動で行ってから送る。一括送信も、画面が未発行の分を順に発行してから送る。
    - 入荷指示書・出荷指示書: 作成の時の自動生成(各 index.ts 221行目付近)も同じくやめる。
    - 今の `POST /:id/generate-pdf` は、画面から呼ばなくなったことを確かめてから削除する(無料プランでは失敗するため)。
- 確認方法: B-1 のテスト。backend のテストで「10種類すべてで pdf-source が返る」「受け取りで PDF でない・大きすぎる・権限が無い・発行できない状態を拒否する」
  「PDF が無いとメール送信が 400」。Staging で10種類を発行し、メールと OTP ダウンロードで届くこと、PERF-01 の集計で PDF 関係の exceededCpu が 0 件であること。
- 変わること・注意: フォントの初回の読み込みに 3.7MB の通信が要る(スマートフォンでも発行できるが、初回は数秒かかる)。納品書が自動で作られなくなり、発行の操作が1つ増える。
  PDF の中身は利用者のブラウザが作るため、社内の利用者が故意に書き換えた PDF を上げることは技術的にはできる(誰が上げたかは監査ログに残る)。
- API の変更: API を2種類(×帳票)と共通の3つを追加。generate-pdf は削除。メール送信は PDF が無いと 400 になる。
- 進み具合:
  - B-1(2026-11-14 済み): 共有パッケージは、リポジトリ直下に package.json が無い(npm の workspaces を使っていない)ため、
    `packages/report-renderer` に独自の package.json(pdf-lib 1.17.1・@pdf-lib/fontkit 1.1.1。backend と同じ版)を置き、backend から
    `"report-renderer": "file:../report-renderer"` で参照する形にした(2026-11-14 ユーザー決定)。frontend への追加は B-5 で行う。
    - 移したもの(`git mv`): `utils/pdfGenerator.ts`(→ pdf-generator.ts)、`jsons/reportLayouts.json`(→ report-layouts.json)、
      `platform/report-templates/` の render-layout-pdf・compute-render-pages・compute-render-instructions・fit-text・format-values・
      generate-instruction-pdf・compute-quote-amount-breakdown・types、それらが使う `platform/tax/compute-tax-amounts.ts`。
    - backend の元の場所には、共有パッケージから読み込み直すだけのファイルを置いた(他のコードの読み込み先は変えていない)。
    - 確認: `report-renderer-equivalence.test.ts`(新規)で、9種類の帳票・ロゴと社印と改ページ・見積書とご発注書の結合・指示書3種類と改ページ・
      Excel テンプレートの16通りについて、移す前(コミット 1ea7ac5)と同じページ数・同じバイト列(SHA-256)の PDF になることを確かめた
      (時刻と乱数を固定して作る)。backend のテスト全件(197ファイル・2061件)と `npx tsc --noEmit`、`wrangler deploy --dry-run`
      (Worker の大きさは前回と同じ 4511.19 KiB。pdf-lib は1つだけ入る)が通った。
    - README.md・docs/development/release.md に、`packages/report-renderer` で先に `npm install` する手順を足した。
  - B-2(2026-11-14 済み): `routes/report-assets/`(GET /api/report-assets/font・logo・seal)。R2 のオブジェクトをそのまま流し、ETag と
    `Cache-Control: private, no-cache` を付ける。If-None-Match が同じなら 304。ログインが必要。テスト `routes/report-assets/index.test.ts`(5件)。
  - B-3・B-4(2026-11-14、見積書まで):
    - 共有パッケージに描画の入口 `renderReportPdf(source, assets)` を足した(以前の各 *-pdf.service.ts と同じ順番: Excel テンプレート → 失敗・無しなら
      既定のレイアウト → 後ろにご発注書)。pdf-source の応答はこの関数に渡すデータ(`ReportPdfSource`、JSON)。サーバーでの発行(generate-pdf。
      B-6 で削除するまで残す)も同じ関数を通す。移す前と同じ PDF になることを `report-renderer-equivalence.test.ts` で確かめた。
    - 共通の部品: `platform/report-templates/load-custom-layout.ts`(Excel テンプレートのレイアウトと差し込む値)・`load-report-assets.ts`(フォント・
      ロゴ・社印)・`browser-pdf-routes.ts`(GET /:id/pdf-source と POST /:id/pdf を帳票ごとに同じ形で登録。受け取りは PDF の先頭・5MB 以下・
      発行できる状態を確かめ、監査ログに上げた人と大きさを残す)。
    - サーバー側の画面の権限の確認 `platform/auth/screen-permission.ts`(hasScreenPermission)を足した。データは参照、受け取りは更新の権限が要る。
      付与された全ロールの権限を合わせて判断する(auth/profile と同じ。auth/profile もこの関数の権限の取得を使うようにした)。管理者かどうかは
      cookie のロールではなく DB の今のロールで判断する(adminGuard と同じ。画面より厳しい)。
    - 見積書(`quote-pdf.service.ts`): データの組み立て(buildPdfSource)・保存と後処理(storePdf)・サーバーでの発行(generatePdf)に分けた。
      テスト `routes/sales/quotes/browser-pdf.test.ts`(7件): 401・403・404・PDF でない/ファイル無し/5MB 超の 400・権限の区別、
      **ブラウザの流れ(pdf-source → renderReportPdf → 受け取り)で保存した PDF が、generate-pdf で保存した PDF とバイト列まで同じ**。
    - 確認の結果: backend のテスト全件(199ファイル・2075件)、`npx tsc --noEmit` が通った。
  - B-3・B-4(残りの9種類。2026-11-14 済み): 注文請書・発注書・検収書・売上関連書類・仕入計上書・請求書・入荷指示書・出荷指示書・納品書も、
    見積書と同じく buildPdfSource(データ)・storePdf(保存と後処理)に分け、GET /:id/pdf-source・POST /:id/pdf を登録した。
    画面の権限のリソース: 注文請書 sales_orders・売上 sales_invoices・請求書 sales_billing・発注書 purchase_orders・仕入 purchase_receipts・
    検収書と入荷指示書 inventory_receiving・納品書と出荷指示書 inventory_shipping(発行している画面に合わせた)。
    納品書は、以前の generate-pdf と同じく、出庫が確定(承認済み)していないと 400。
    - pdf-source の応答が JSON にしても変わらないこと(Date などが入らないこと)を、backend のテストの共通の準備(`test/check-report-pdf-source.ts`)で、
      描画の入口に渡す全てのデータについて確かめる(Date を入れると失敗することも確かめた)。日付の項目は、どの帳票も文字列にしてから渡している。
  - B-5(2026-11-14 済み): frontend から `file:../report-renderer` で参照し、`next.config.ts` に `transpilePackages`・`turbopack.root`(packages/ まで)を足した。
    - `_shared/report-pdf/issue-report-pdf.ts`: issueReportPdf(pdf-source → フォント・ロゴ・社印 → 描画 → 送信。応答は generate-pdf と同じ形)・
      issueReportPdfs(一括。以前の bulk-generate-pdf と同じ応答)。フォントなどは Cache Storage に保存し ETag で確かめる。PDF を作るライブラリは
      発行の時に初めて読み込む(別のファイル約 1.1MB。他の画面の表示は重くならない)。作成中は `ReportPdfIssuingNotice`(layout.tsx)が
      「PDF を作成しています」を出す。
    - 画面の PDF 発行(13か所。10種類の帳票と見積の参照・指示書の一括発行)をこれに切り替えた。
  - B-6(2026-11-14 済み):
    - 納品書の自動作成をやめた(出庫の確定・承認の確定2か所・直送完了)。納品書のパネルに「未発行」を出す(発行のボタンは以前からある)。
    - メール送信(見積書・注文請書・売上・発注書・検収書・請求書・納品書の 1件・一括): PDF が無ければサーバーでは作らず、1件は 400
      「先に PDF を発行してください」、一括はその伝票を同じ理由で失敗にする。画面は sendWithIssuedPdf・bulkSendWithIssuedPdf で、
      その時だけブラウザで発行してから送り直す(利用者の操作は変わらない)。
    - 指示書の作成の時の自動作成は、コードを確かめたところ元から無かった(計画の「221行目付近」は一括発行の API だった)。
    - POST /:id/generate-pdf(10種類)・POST /bulk-generate-pdf(指示書2種類)と、サーバーで PDF を作る関数(各サービスの generatePdf、納品書の
      generateAndStore)を削除した。画面から呼んでいないことは grep で確かめた。
    - Backend の Worker の大きさ: 4511 KiB → 3098 KiB(pdf-lib が Backend に入らなくなった)。
  - 文書: README.md・docs/architecture/overview.md に「PDF はブラウザで生成する」、マニュアル(basics/common-operations.md に「帳票の PDF を発行する」、
    inventory/shipping.md の納品書)を直した。
  - 確認の結果: backend のテスト全件(199ファイル・2078件)、frontend の画面のテスト全件(217ファイル・1246件)と Worker のテスト(24件)、
    両方の `npx tsc --noEmit`、frontend の `npm run build`、backend の `wrangler deploy --dry-run` が通った。変更した画面のファイルの lint のエラーは増えていない。
  - 確かめていないこと: ブラウザで作った PDF とサーバーで作った PDF のバイト列の一致は、見積書でだけ確かめた(他の種類は、同じ描画のコードと
    JSON の確認で代えた)。実際のブラウザでの発行・メール・OTP ダウンロードは、Staging で確かめる。
  - 変更したテスト(仕様が変わったため): 各帳票の「generate-pdf の 404」→「generate-pdf の廃止・pdf-source の 401」、1件のメール送信(BUG-029 の
    「無ければ作って送る」→「先に PDF を発行してください」)、請求書の PDF(generatePdf → buildPdfSource)、納品書の作成の条件(generate-pdf → pdf-source)、
    納品書のパネル(作成 API の呼び出し → issueReportPdf)。

#### PERF-08 OTP メールをすぐ送る(再送は今の定期処理を使う)

- 対象: `backend/src/platform/notifications/enqueue-notification.ts`、`src/scheduled/process-notification-outbox.ts`、OTP を発行している `*-download.service.ts`
  (9個。ログインの OTP は既にその場で送信しているため対象外)
- 現状: メールは送信待ちの表(`mail_delivery_logs`)に登録するだけで、1分ごとの定期処理が5件ずつ送る。失敗時は2分・4分後に再送し、3回で失敗にする仕組みは既にある。
- 変更内容:
  - process-notification-outbox.ts に、1件だけを送る関数(例: `processNotificationById(env, id)`)を切り出す。行の確保は「状態が PENDING の時だけ PROCESSING に更新し、
    更新できた時だけ送る」にして、定期処理との二重送信を防ぐ。
  - enqueueNotification は登録した行の id を返す。OTP の発行元は、登録の直後に `c.executionCtx.waitUntil(processNotificationById(...))` を呼ぶ。失敗した場合は今の再送の仕組みに任せる。
  - 定期処理に、PROCESSING のまま5分以上たった行を PENDING に戻す処理を足す(途中で打ち切られた送信の救済)。
  - Cloudflare Queues を使う案: 無料プランでも1日1万操作まで使えるが、キューの作成と wrangler.jsonc.example・Terraform の変更が要る。上の変更で遅れは解消するため、
    今回は採用しない(必要になったら別の項目にする)。
- 確認方法: テストで、OTP の発行の直後に(定期処理を動かさずに)行が SUCCESS になること、送信に失敗した行が PENDING に戻り定期処理で再送されること、同じ行が2回送られないこと。
- 実装(2026-11-14):
  - `scheduled/process-notification-outbox.ts`: `processNotificationById`(1件だけを送る)を追加。送る前の確保は、定期処理も含めて
    「PENDING の行だけを PROCESSING にし、確保できた行だけを送る」にした(以前の定期処理は状態を見ずに PROCESSING にしていた)。
    定期処理の最初に、PROCESSING のまま5分以上たった行を PENDING に戻す処理を足した。止まった時刻は、確保の時に nextAttemptAt に入れる時刻
    (この修正より前に確保された行は登録の時刻)で判断する(DB の列は足していない)。
    戻す時は再試行の回数に数え、上限(3回)に達したら FAILED にする(計画には無いが、打ち切りを繰り返す行で送信が終わらなくならないため)。
  - `platform/notifications/enqueue-notification.ts`: enqueueNotification は登録した行の id を返す。`sendNotificationNow(c, id)` を追加
    (`c.executionCtx.waitUntil` で応答の後に送る。実行環境が無い時は何もせず定期処理に任せる)。
  - OTP を発行している9つの `*-download.service.ts` で、登録の直後に sendNotificationNow を呼ぶ。
  - テスト: `scheduled/process-notification-outbox.test.ts`(新規6件: すぐに送ると SUCCESS・同じ行は2回送らない・失敗は PENDING に戻り
    再送の時刻を過ぎた定期処理で送る・5分以上止まった行を戻して送る・5分未満は触らない・上限で FAILED)、
    `sales/quotes/otp-download.test.ts` に1件(見積書の OTP の発行の直後に、定期処理なしで SUCCESS)。
  - 確認の結果: backend のテスト全件(196ファイル・2059件)、`npx tsc --noEmit` が通った。
    マニュアル(docs/manual/logs/mail-logs.md)に、確認コードのメールは直後に送ることを書き足した。
  - 注意: 送信が途中で打ち切られて戻した行は、実際には送れていた場合に同じメールがもう一度届くことがある。

#### PERF-09 承認・差戻し・申請の処理の問い合わせを減らす

- 対象: `workflow-tasks-approval.service.ts`(承認・差戻し・取下げ)
- 現状: 同じ履歴(getLogById)と同じ申請(getParentRequestById)を、1回の承認の中で2回ずつ取得している。
- 変更内容: 1回目に取得した値を使い回す。処理の順番・書き込みの内容(BUG-049 の1回の batch)は変えない。
  PERF-01 の計測で承認の API がまだ上位に残る場合は、結果を報告して次の対策を相談する。
- 確認方法: `workflow-tasks-approval.service.test.ts`・`workflow-tasks-approval.index.test.ts` が通る。
- 実装(2026-11-14): `workflow-tasks-approval.service.ts` の approveTask・remandTask で、最初に取得した履歴・申請を最後まで使う
  (書き込みは最後の batch でまとめて行うため、途中で取り直しても同じ値だった)。処理の順番・書き込みの内容は変えていない。
  取下げ(cancelTask)は同じ取得の重複が無かったため変更なし。
  - テスト: `workflow-tasks-approval.service.test.ts` に2件(承認・差戻しで getLogById・getParentRequestById が1回ずつ。直す前は2回ずつ)。
  - 確認の結果: 承認タスク・在庫・見積・購買・受注・売上・マスタのテスト(86ファイル・934件)、`npx tsc --noEmit` が通った。

#### PERF-10 無料プランで残る重い処理を測って対応を決める

- 対象: ログインのパスワード照合(PBKDF2 10万回、CPU 約 20 ms)、Excel 帳票テンプレートの変換(`scheduled/process-report-template-compiles.ts`。コードのコメントに
  2026-08-14 の実測 7〜11 ms とある)、見積のメールに PDF を添付する時の変換(`scheduled/process-notification-outbox.ts` の resolveAttachments)。
- 内容: PERF-07 の完了後に PERF-01 と同じ集計を行い、この3つの失敗の回数を報告する。対応は結果を見て決める(上の「まだ決まっていないこと」)。
  ログインの回数を減らすのは安全性が下がるため、この計画では行わない。
- 計測(PERF-07 を Staging に反映した後。2026-11-14 16:06〜16:13、256 件。生のログは集計後に削除):
  - **exceededCpu は 0 件**(全件 ok)。

    | API | 回数 | CPU 中央値/最大(ms) | 以前(サーバーで PDF を作っていた時) |
    |---|---|---|---|
    | GET /:id/pdf-source(5種類) | 7 | 9〜24 | — |
    | POST /:id/pdf(7種類) | 12 | 12〜35 | 以前の generate-pdf は 1枚 115〜215(作業環境の実測) |
    | POST /bulk-send-email(5種類) | 6 | 14〜21 | 見積の一括送信 1263(2回目の計測) |
    | GET /api/report-assets/font・logo・seal | 26 | 2〜5 | — |
    | POST /download-request(確認コードの発行。直後にメールを送る) | 3 | 37〜73 | 1回目の計測は 9(メールは定期処理が送っていた) |
    | 定期処理(毎分) | 8 | 39.5 / 91 | 1回目 52 / 112、2回目 10 / 69 |
    | POST /api/auth/login | 1 | 70 | 1回目 35.5 / 51 |

  - PDF 関係は、上限の 10 ms は超えるものの、以前の 1/5〜1/40 になった。PDF の受け取り(POST /:id/pdf)の CPU 時間は、受け取ったファイルの読み込みと
    R2 への保存・記録の分と考えられる。
  - 計画の3つ: ログイン 70 ms(1回)、Excel 帳票テンプレートの変換は今回の操作では発生していない、見積のメールの添付は送っていない(見積のメールは
    ダウンロードのリンクを送る形で、添付は付けていない。以前の記録も同じ)。どれも打ち切りは起きていない。
  - 確認コードの発行は、メールの送信(SMTP)の CPU 時間が API 側に入るため 37〜73 ms になった(PERF-08 の影響)。
  - この時間の操作では、10種類のうち請求書・納品書・仕入計上書の PDF の発行(ブラウザで作る流れ)は記録されていない。
- 計測で見つかった不具合と直し(2026-11-14): 一括のメール送信で、PDF が未発行の伝票について「一括送信時の…PDF自動生成処理に失敗しました」の
  失敗のメールの記録(FAILED)を残していた(画面が発行して送り直すため、同じ伝票に失敗と送信済みが2行並んでいた)。7つのメールの処理で、
  未発行の時はメールの記録を残さないようにした(結果の理由は「先に PDF を発行してください」。納品書の「得意先未設定」は今までどおり記録を残す)。
  テスト `delivery-note-mail.test.ts` を今の仕様に直した。backend のテスト全件(199ファイル・2078件)が通った。
- 決定(2026-11-14): **A(そのまま)**。ログインなどで打ち切りは起きていないため、パスワード照合の回数は減らさない。打ち切りが起きるようになったら相談する。
- 計測の時の売上の更新(PUT /api/sales-invoices/:id)の 400(3回)は、画面にエラーは出ていなかった(ユーザー確認)。
- 請求書・納品書・仕入計上書の PDF をブラウザで発行する確認は、他の改修が終わった後にユーザーが行う。

#### PERF-11 進捗確認の一覧を軽くする(2026-11-14 追加。方針は相談)

- 見つけた日: 2026-11-14(PERF-01 の1回目の計測で、`GET /api/progress` が5回とも 10 ms 超え。中央値 22 ms・最大 57 ms)。計画(2026-11-10)には入っていなかった。
- 対象: `backend/src/routes/progress/progress.service.ts`(getProgress・scanRows・buildRows・exportCsv)、`progress.repository.ts`、
  `frontend/app/progress/_hooks/`(一覧の取得。既定は state=in_progress、「完了も表示」で state=all)
- 今の作り(2026-11-14 にコードで確認):
  - buildRows は、起点(受注・発注など)の一団に対して、関連する伝票を表ごとに inArray でまとめて取得している(行ごとの問い合わせではない)。
    ただし表の数が多く、1回の buildRows で約30回の問い合わせを順番に行っている(Promise.all でまとめているのは名前の取得など一部だけ)。
  - state=all は1ページ分(既定30件)の起点だけを組み立てる。
  - 既定の state=in_progress と completed は、完了かどうかを組み立てた後でしか判定できないため、起点を30件ずつ、最大300件まで走査する(SCAN_BATCH_SIZE・MAX_SCAN)。
    完了した案件が多いと、30件ずつの buildRows が最大10回繰り返され、問い合わせが約300回になりうる(D1 は無料プランで1リクエスト50回まで)。
  - CSV 出力は起点を最大2000件走査する(CSV_MAX_SCAN)。
- inArray に渡す番号は、repository の inChunks(fetchInChunks)で分けて問い合わせている(D1 の1文あたりのパラメーター数の上限には当たらない作り)。
- 計測(2026-11-14 09:12、`wrangler tail` で記録。生のログは Cookie を含むため集計後に削除):
  - Staging の起点の件数(読み取りの SELECT で確認): 受注 11・受注になっていない見積 3・受注とつながらない購買申請 6・購買申請の無い発注 11 の計 31 件。
    30件ずつ走査するため、「進行中」の表示は最大2回の組み立てになる。

    | 操作 | 条件 | 状態 | CPU(ms) | 応答までの時間(ms) |
    |---|---|---|---|---|
    | 開く | 進行中(既定) | 200 | 36 | 791 |
    | 種別で絞り込み | 進行中・発注起点 | 200 | 18 | 300 |
    | 完了も表示 | すべて・発注起点 | 200 | 14 | 270 |
    | 完了も表示 | すべて | 200 | 30 | 611 |

  - 4回とも 200 で、エラー・例外の記録は無かった。どれも上限の 10 ms は超えている。31件でもこの重さなので、件数が増えるとさらに重くなる見込み。
  - 同じ 30件分でも「進行中」(36 ms)は「すべて」(30 ms)より重い(走査が2回になるため)。
  - CSV 出力(2026-11-14 09:14 に別に記録。`GET /api/progress/csv-download`):

    | 条件 | 状態 | CPU(ms) | 応答までの時間(ms) |
    |---|---|---|---|
    | すべて(完了も表示) | 200 | 54 | 967 |
    | 進行中 | 200 | 44 | 804 |

    どちらもエラーは無かった。起点 31 件で一覧の表示(30〜36 ms)より重く、上限の 5 倍前後。CSV は最大2000件まで走査するため、件数が増えると最も先に失敗する見込み。
- 確かめていないこと: 1回の表示での D1 の問い合わせ回数(ログには出ない)。対応の時に、テストで `env.DB.prepare` を数えて確かめる。
- 対応案(どれにするかは段階1の後の計測を見て相談する):
  1. buildRows の中で、互いに依存しない問い合わせを Promise.all や D1 の batch にまとめる(順番の待ちを減らす。問い合わせの回数は減らない)。
  2. 完了の判定に必要な最小限の列だけを先に取得して絞り込み、表示する1ページ分だけを buildRows で組み立てる(PERF-02 と同じ考え方)。
  3. 案件の完了状態を DB に持たせ、伝票の更新の時に更新する(SQL で絞り込める。DB変更あり・影響が大きい)。
- 確認方法(案): テストで、完了した案件が多い場合の問い合わせ回数(`env.DB.prepare` を数える)が上限以下であること。既存の progress/index.test.ts が通ること。
  対応後の計測で `GET /api/progress` の CPU 時間が下がること。
- 実装(2026-11-14。案2):
  - `progress.service.ts`: 組み立てを `buildCases`(各工程の伝票・完了の状態(手動設定を反映)・案件全体の状態)と
    `decorateCases`(担当者名・取引先名・プロジェクト名・承認の進み具合・担当設定・次工程)に分けた。進行中/完了の走査(一覧・CSV)は、
    各回で buildCases だけを行って絞り込み、最後に返す行にだけ decorateCases を1回行う。state=all のページングは1ページ分を両方行う(今と同じ)。
    応答の内容・並び・nextOffset は変えていない。
  - テスト: `progress/index.test.ts` に2件(完了済みの案件を2回の走査で読み飛ばしても、取引先名などの取得は1回だけ。CSV も同じ)。
    完了済み45件+進行中1件の例で、問い合わせが 24 回 → 19 回。
  - 確認の結果: progress・document-completion のテスト(43件)、`npx tsc --noEmit` が通った。
  - 残ること: 案件の構成と完了の判定(約20種類の問い合わせ)は、今も走査の回ごとに行う。完了した案件が多いほど走査の回数が増えるため、
    段階1の後の計測で重いままなら、案3(案件の完了状態を DB に持たせる)を相談する。

### BUG-087 消込を保存した後も破棄の確認が出る

- 規模: 小
- 対象: `frontend/app/sales/billing/_components/BillingDetailModal.tsx`、`frontend/app/purchase/payment/_components/PaymentDetailModal.tsx`
- 原因: どちらも `<Modal warnOnDiscard>` だが discardResetKey を渡していない。入力欄を変えた印が、保存に成功しても消えない。
- 変更内容: 商談(`sales/deals/_components/DealFormModal.tsx` の `discardResetKey={f.savedVersion}`、BUG-081)と同じ形にする。入金・支払の記録、消込、取消が成功するたびに
  増やす値を持ち、discardResetKey に渡す。
- 確認方法: BillingDetailModal.test.tsx・PaymentDetailModal.test.tsx に「入力 → 保存成功 → ✕ で確認が出ない」「入力して保存せず ✕ で確認が出る」を足す。

### BUG-088 商談の添付が商談番号のフォルダに入らない

- 規模: 小
- 対象: `backend/src/routes/sales/deals/deals.service.ts`(uploadAttachment、398行目付近)
- 変更内容: generateAttachmentKey に渡す先頭の文字列を、`deals` から `deals/<商談番号>` にする(見積の `quotes/<見積番号>` と同じ)。既に保存済みのファイルは DB にキーを持っているため動かさない。
- 確認方法: deals/index.test.ts で、アップロード後の attachmentR2Path が `deals/<商談番号>/` で始まること。

### BUG-089 承認プレビューが「未対応」になる・項目が足りない

2026-11-10 に範囲を広げた: 全ての種類で、申請の内容を全ての項目で出す。

- 規模: 大(画面とバックエンドの両方。種類ごとに分けて、伝票 → 在庫 → マスタの順に進めてよい)
- 対象: `frontend/app/workflow/_shared/PreviewRenderer.tsx`・`preview-field-configs.ts`、`frontend/app/workflow/tasks/_components/TaskPreviewRow.tsx`、
  `frontend/app/workflow/histories/_components/WorkflowTable.tsx`、`backend/src/workflow-engine/target-adapters/` の各アダプター(getTaskPreview・getHistoryPreview)と registry.ts
- 現状(コードで確認):
  - 専用の表示があるのは、sales_quotes・sales_orders・inventory_stock・inventory_audit とマスタ5種類だけ。
  - purchase_requisitions・purchase_orders・purchase_recognitions・sales_invoices は `{header, items}` の形で届くが、汎用の表示は平らな項目しか扱えず 0 件になり「未対応」が出る。
  - inventory_instructions はバックエンドでは入出庫と同じ処理だが、画面は inventory_stock しか見ていない。
  - 専用の表示がある種類も項目が少ない。見積はヘッダー7項目(QUOTE_HEADER_FIELDS)、入庫は3項目(INVENTORY_RECEIPT_HEADER_FIELDS)で、担当者・自社情報・支払条件・
    プロジェクト・添付などが出ない。取引先・倉庫は名前ではなく番号で出る。
  - マスタは品目・品目単価・勘定科目・倉庫・営業拠点に設定が無く、汎用の表示(英語の項目名)になる。
- 変更内容:
  - 表示する項目の基準: 各画面の入力フォームで利用者が入力・選択できる項目は、ヘッダー・明細・添付の全てを出す。保存時に送っているデータ(例: 仕入は
    usePurchaseRecognitionSaveActions.ts の recognitionJson)をその種類の項目の一覧とする。内部用の列(id・作成日時・更新者・承認の段など)だけを、理由を書いた「表示しない項目」の一覧に入れる。
  - 設定を全種類に足す: preview-field-configs.ts に、全ての申請の種類(今の19種類と BUG-097・098、REQ-011・017・018 で足す種類)のヘッダー項目と明細列を、
    画面と同じ日本語のラベルと書式(日付・金額・数量・税区分・状態)で定義する。`{header, items}` の形を表示する共通の部品(ヘッダーの項目一覧 + 明細の表 + 添付の一覧)を作り、
    今の専用の表示もこれにそろえる。inventory_instructions は inventory_stock と同じ表示に流す。
  - 番号ではなく名前を出す: アダプターのプレビューに、取引先・倉庫・ロケーション・品目・単位・勘定科目・プロジェクト・担当者(従業員番号)・部門の名前を足して返す
    (例: プレビューに displayNames を持たせ、番号と名前の対応を入れる)。名前はテーブルごとに inArray で1回ずつまとめて引く(PERF-02・03 に合わせ、行ごとに問い合わせない)。
    画面は「名前(番号)」で出す。
  - 変更箇所を分かるようにする: 変更申請(変更前のデータがあるもの)は、ヘッダー・明細・添付の全てで、変わった項目を強調し、変更前の値を並べて出す
    (今の FieldGrid の oldData と同じ考え方を明細にも広げる)。明細の追加・削除は行ごとに「追加」「削除」を出す。
  - 設定に無い項目も隠さない: 設定に無い項目がデータにあれば、末尾に「その他」として項目名のまま出す。配列は表、入れ子のデータは項目の一覧として出す。
    「未対応です」は、データが空の時だけにする。
  - 漏れを防ぐテスト(元のメモの「追加が必要になるのも厄介。漏れないようにしてほしい」への対応):
    - バックエンド: registry.ts の全種類が getTaskPreview と getHistoryPreview を持つこと。各種類で、見本の申請から返るプレビューに、参照している番号の名前が入っていること。
    - 画面: 全種類について、その種類の保存データの型の全ての項目が、「表示する項目」か「表示しない項目」のどちらかに入っていること。フォームに項目を足してプレビューの設定を
      忘れると、このテストが失敗するようにする(型のキーを一覧として持ち、型と一覧の食い違いは TypeScript の型チェックで検出する)。
    - 画面: 全種類の見本データで「未対応」が出ないこと、変更申請で変わった項目が強調されること。
  - 新しい申請の種類を足す項目(BUG-097・098、REQ-011・017・018)では、この設定とテストへの追加を完了の条件にする。
- 確認方法: 上のテストが通る。Staging で、承認のスイッチがある全ての画面から新規と変更の申請をし、承認タスクと申請履歴で、入力した内容が全て名前つきで見えること。
- 漏れを防ぐテストの基準(2026-11-14 ユーザー決定): 計画の「保存データの型」は今のコードに無い(各フォームが型の無いオブジェクトで作っている)ため、
  **DB の表の列**を基準にする。設定に書いた表(ヘッダー・明細)の全ての列が「表示する項目」か「表示しない項目(理由つき)」に入っていることを、
  backend のテスト(`workflow-engine/target-adapters/preview-specs-coverage.test.ts`)で確かめる。設定は画面側の `workflow/_shared/preview-specs.ts`
  (他のファイルを import しない)にまとめ、backend のテストから読む。申請の時に退避した保存データにだけある別名(customerId など)は「表示しない項目」に入れる。
- 進み具合:
  - 第1弾(2026-11-14 済み): 伝票の6種類(見積・受注・売上・購買申請・発注・仕入)。
    - backend: `routes/workflow/workflow-tasks/preview-display-names.ts`(プレビューの中の番号を集め、取引先・倉庫・ロケーション・品目・単位・勘定科目・
      税区分・プロジェクト・担当者・ユーザー・部門・営業拠点の名前を表ごとに1回ずつ引く)。承認待ち一覧・申請履歴の応答に `displayNames`
      (「種類:番号」→名前)を足した(項目の追加だけで、既存の項目は変えていない)。
    - 画面: `preview-specs.ts`(6種類のヘッダー・明細の表示する項目・表示しない項目)と `SpecPreview.tsx`(ヘッダーの項目一覧 + 明細の表 + 添付の一覧。
      番号は「名前(番号)」。変更申請は変わった項目を強調して変更前の値を並べ、明細の追加・削除を行ごとに出す。設定に無い項目は「その他」)。
      見積・受注の以前の専用の表示は、この共通の表示に置き換えた。
    - テスト: backend `preview-specs-coverage.test.ts`(12件。項目を1つ外すと失敗することも確かめた)・`preview-display-names.test.ts`(3件)、
      画面 `SpecPreview.test.tsx`(11件)。backend 全件(201ファイル・2093件)・画面全件(218ファイル・1257件)・両方の `npx tsc --noEmit` が通った。
  - 第2弾(2026-11-14 済み): 在庫の8種類(入庫・出庫・品質区分変更・廃棄・返品・入荷指示・出荷指示・棚卸)。
    - 入出庫(inventory_stock)と指示(inventory_instructions)は、1つの申請の種類に複数の伝票が同居しているため、設定は伝票ごとに持ち
      (`inventory_stock:receipt` など)、データの項目から伝票を見分けて選ぶ(`resolvePreviewSpecKey`。以前の PreviewRenderer と同じ見分け方)。
      棚卸の `{audit}` の形も同じ表示で出す。入荷指示・出荷指示は、以前は入出庫と同じ表示に流していたが、指示書の項目(予定日・倉庫・指示数量)で出す。
    - 以前の在庫の専用の表示(PreviewRenderer の InventoryStockPreview・InventoryAuditPreview と preview-field-configs.ts の在庫の設定)は削除した。
    - テスト: 漏れのテストを在庫の8つの表と明細の表に広げた(18件)。画面のテストに8件(伝票の見分け・全ての項目・名前)。
      backend 全件(201ファイル・2099件)・画面全件(218ファイル・1265件)・両方の `npx tsc --noEmit` が通った。
  - 第3弾(2026-11-14 済み): マスタの10種類(取引先・担当者・単位・ロケーション・品目単価・品目・勘定科目・倉庫・営業拠点・品目構成)。
    - 取引先の振込先口座は、ラベルつきの表で出す(書式 list)。
    - **見つけた不具合も直した**: 取引先以外の9種類のマスタは、変更申請で変更後の内容を退避データに持つのに、プレビューは今の行(変更前の内容)だけを
      出していたため、承認待ちの間は何が変わるのか分からなかった。`target-adapters/master-pending-change.ts` で、退避データがあれば今の行に重ねたものを
      新しい内容、今の行を変更前の内容として返す(変更前は、変更申請の申請履歴だけ)。承認の後は今の行が新しい内容になるため、申請履歴の変更前と
      変更後は同じに見える(以前の取引先と同じ)。
  - 仕上げ: 漏れのテストの対象を registry の全ての申請の種類(19種類)にした(registry.ts に listTargetTypes を足した)。設定の無い種類が来ても、
    全ての項目を「その他」に出す(未対応にしない)。以前の preview-field-configs.ts と PreviewRenderer の種類ごとの表示は削除した。
    マニュアル(docs/manual/workflow/tasks.md・histories.md)に、全ての項目が名前つきで出ること・変更の強調を書き足した。
  - 確認の結果: 漏れのテスト(39件)・マスタの変更申請のプレビュー(2件)・画面のプレビューのテスト(在庫・マスタを含め全種類)。
    backend 全件(202ファイル・2122件)・画面全件(218ファイル・1277件)・両方の `npx tsc --noEmit` が通った。変更した画面のファイルの lint のエラーは無い。
  - 確かめていないこと: ラベルは各画面の入力フォームの見出しに合わせたが、全ての画面で1語ずつ一致するかは確かめていない。Staging で、承認のスイッチがある
    画面から新規・変更の申請をし、承認タスクと申請履歴で全て名前つきで見えることを確かめる(計画の確認方法)。

### BUG-090 進捗確認に入荷指示が出ない

- 規模: 小
- 対象: `backend/src/routes/progress/progress.repository.ts`、`progress.service.ts`(256行目付近)
- 原因: 入荷指示を、入庫の receiptInstructionId からしか探していない。入庫がまだ無い入荷指示は見つからない。
- 変更内容: repository に、発注番号(`item_receipt_instructions.order_id`、BUG-071 で追加済み)で入荷指示を探す関数を足す。service は「入庫経由」と「発注番号経由」の両方を
  合わせ(同じ番号は1つにまとめる)、入荷指示の欄に出す。申請中の入庫・入荷指示が、それぞれの欄に「申請中」として出ることもテストで確かめる。
- 確認方法: progress/index.test.ts に「承認済みの発注 + 入庫の無い入荷指示(申請中)」「承認済みの発注 + 申請中の入庫」の2件を足す。

### BUG-091 入荷指示に発注の納品先倉庫が引き継がれない(REQ-010 の後に行う)

- 規模: 小
- 対象: `frontend/app/inventory/receiving/page.tsx`(applyPurchaseOrderPrefill、91行目付近)、`frontend/app/inventory/stock/_hooks/useReceiptInstructionForm.ts`(createPrefill、140行目付近)
- 変更内容: createPrefill に warehouseId を足し、発注の deliveryWarehouseId を入れる。その倉庫が選択肢にある時だけ初期値にする。
- 確認方法: useReceiptInstructionForm.test.ts に、納品先倉庫つきの発注から作ると倉庫が選ばれていること。

### BUG-092 帳票の担当者名と、納品書の登録番号

- 規模: 小
- 対象: `backend/src/routes/inventory/receipts/acceptance-inspection-pdf.service.ts`(48行目 `staffName = header.createdBy`)、`routes/sales/billing/billing-pdf.service.ts`
  (112行目 "営業部 担当者")、`routes/inventory/shipments/delivery-note-pdf.service.ts`、`utils/pdfGenerator.ts`(385行目・398行目)、`jsons/reportLayouts.json`
  (PERF-07 の後は、B-1 で移した packages/report-renderer 側を直す)
- 変更内容:
  - 従業員番号から氏名を引く共通関数を platform/ に置く(progress.repository.ts の findUserNamesByEmployeeNumber と同じ問い合わせ)。
  - 検収書: 検収担当者に、入庫の作成者の氏名を出す。納品書: 担当に、出庫の作成者の氏名を出す。氏名が引けない時は空欄にする。
  - 請求書: 固定の文言をやめ、請求の作成者の氏名を出す。
  - pdfGenerator.ts: 担当者名が空なら「担当:」の行を描かない(今は「営業担当者」と出る)。
  - reportLayouts.json に showInvoiceNo を足し(既定は表示、DELIVERY だけ非表示)、登録番号の行に反映する。
- 確認方法: billing-pdf.test.ts と検収書・納品書の PDF のテストで、渡す担当者名が氏名であること。Staging で3つの PDF を発行して目で確かめる。

### BUG-093 入出庫の履歴の作成者が従業員番号

- 規模: 小
- 対象: `frontend/app/inventory/stock/_components/InventoryHistoryPanel.tsx`(236行目・428行目)と、同じフォルダの ReceiptInstructionPanel・ShipmentInstructionPanel・
  DisposalHistoryPanel・ReturnHistoryPanel
- 変更内容: これらの画面は既に `/api/users` を読んでいる。従業員番号から氏名への対応を作り、「作成者」は氏名を出す(引けない時は番号のまま)。CSV の出力は変えない。
- 確認方法: 各パネルのテストで、作成者の列に氏名が出ること。

### BUG-094 0円の支払を消込できない

- 規模: 小
- 対象: `frontend/app/purchase/payment/_components/PaymentDetailModal.tsx`(44行目・220行目)、`backend/src/routes/purchase/payment/payment-reconciliation.service.ts`
- 原因: 金額が 0 以下だと記録ボタンを押せない。支払額が 0 円(相殺・赤伝など)だと完了にできない。
- 変更内容: 残額が 0 円で未完了の支払にだけ、「0円で消込を完了する」ボタンを出す。バックエンドは、残額が 0 円の時に限り 0 円の支払記録を受け付け、完了の状態にする。
  請求側(BillingDetailModal.tsx・billing-reconciliation.service.ts)に同じ制限があれば、同じように直す。
- 確認方法: payment-reconciliation.test.ts に「残額 0 円 → 0 円で完了できる」「残額がある時は 0 円を拒否する」を足す。

### BUG-095 発注の一覧に発注日が無い

- 規模: 小
- 対象: `frontend/app/purchase/orders/_components/PurchaseOrderTable.tsx`(53行目からの列定義)、発注の一覧 API の並べ替えの許可キー
- 変更内容: 「発注番号」の次に「発注日」(orderDate、並べ替え可)を足す。日付の表示は `_shared/jst-date.ts` を使う。
- 確認方法: PurchaseOrderTable.test.tsx で列と値が出ること。

### BUG-096 商談の担当(自社)の初期値

- 規模: 小
- 対象: `frontend/app/sales/deals/_hooks/useDealForm.ts`(45行目 `ownerEmployeeNumber: ""`)
- 変更内容: 新規登録の時だけ、ログイン中のユーザーの従業員番号(`usePermissionContext().user.employeeNumber`)を初期値にする。編集の時は保存済みの値のまま。
- 確認方法: フックのテストで、新規の初期値がログインユーザーであること。

### BUG-097・BUG-098 プロジェクトマスタ・発注点/安全在庫マスタに承認申請が無い

- 規模: 中(BUG-098 は DB変更あり)
- 原因: どちらも「承認の対象外」として作られている(`backend/src/routes/master/projects/projects.service.ts` 16行目のコメント、`routes/master/item-reorder-settings/index.test.ts`
  10行目)。会社設定にスイッチが無く、申請の種類(registry.ts)も無い。また、会社設定の画面(`frontend/app/admin/company-settings/_components/SecuritySettings.tsx` 200行目付近)に
  「現時点で実際に機能するのは「取引先」のみ」という古い説明が残っている。
- 手本: 単位マスタの承認(`workflow-engine/target-adapters/units.adapter.ts` と `routes/master/units/`)。新規登録は「仮登録(temporary)で保存 → 申請 → 承認で有効」、
  変更は「変更後の内容を退避 → 承認で反映」。
- 変更内容:
  - 会社設定に `is_project_approval_enabled`(プロジェクト)と `is_item_reorder_setting_approval_enabled`(発注点/安全在庫)を足す(既定 OFF、OFF の間は今と同じ動き)。
    会社設定のスキーマ・サービス・画面の「マスタ種別ごとの承認フロー機能」の一覧、workflow-engine/settings.ts、auth/profile の応答(isProjectWfEnabled・isItemReorderSettingWfEnabled)、
    `frontend/app/hooks/use-page-permission.ts` に足す。PERF-04 の後に行い、会社設定の読み取りを増やさない。画面の古い説明は「ON にしたマスタは、新規登録・変更の時に承認申請が必要になります。」に直す。
  - 申請の種類 master_projects・master_item_reorder_settings を足し、アダプター(承認で有効・変更を反映、差戻し・取下げで元に戻す、プレビュー)を registry.ts に登録する。
    承認フローの種類の一覧(approval-flows.schema.ts と画面)にも足す。BUG-089 のテスト(全種類のプレビュー)にも含める。
  - API・画面: `routes/master/projects/`・`routes/master/item-reorder-settings/` の登録・変更に、スイッチ ON の時の仮登録と `POST /:id/submit-for-approval` を足す。
    `frontend/app/master/projects/`・`master/item-reorder-settings/` に「承認申請」ボタンと状態の表示を足す(単位マスタの画面と同じ形)。CSV 取込の扱いも単位マスタと同じにする。
  - プロジェクト: projects には状態の列(status)があるので、temporary を足すだけでよい。仮登録のプロジェクトは、伝票のプロジェクトの選択肢(`/api/projects?status=active`)に出さない。
  - 発注点/安全在庫(DB変更あり): item_reorder_settings に状態の列(status、既定 active、今あるデータはそのまま有効)を足す。発注点の提案(発注・購買申請の「発注点から作成」など、
    itemReorderSettings を読んでいる箇所を grep で洗い出す)は、有効な設定だけを使うようにする。変更の申請中は、承認されるまで変更前の値を使う。
- 確認方法: 単位マスタの承認のテストと同じ観点(新規・変更・差戻し・取下げ)。スイッチ OFF で既存の projects・item-reorder-settings のテストが通ること。
  仮登録・申請中の発注点が提案に使われないこと。承認フローの取込用 CSV に、2つの種類のフローを足す(sampledata/ は変えない)。

### REQ-007 帳票ダウンロードの OTP を「メール入力なし」にそろえる

- 規模: 中
- 現状: 見積書・注文請書・発注書・検収書・売上関連書類・請求書の6種類は、OtpDownloadCard + use-otp-download.ts でメールアドレスを入力させ、登録済みの連絡先と一致すれば
  そのアドレスにコードを送る。納品書・出荷指示書・入荷指示書の3種類は、InstructionDownloadForm + use-instruction-download.ts で入力なし、登録済みの宛先すべてに同じコードを送る。
- 対象: バックエンドは quote-download.service.ts・sales-order-download.service.ts・purchase-order-download.service.ts・acceptance-inspection-download.service.ts・
  sales-invoice-download.service.ts・billing-download.service.ts と各 index.ts の download-request / download-verify。画面は `frontend/app/` の quote-download・order-download・
  purchase-order-download・acceptance-inspection-download・sales-invoice-download・billing-download。
- 変更内容:
  - 手本は receipt-instruction-download.service.ts。各サービスで、今メールの照合に使っている「登録済みの宛先の集まり」を関数に切り出し、その全員に同じコードを送る。
    コードの照合と回数制限は、メールアドレスではなく帳票の単位で行う。
  - download-request・download-verify の email は省略できるようにする(送られてきても使わない)。応答に宛先のアドレスを含めない。
  - 6つの画面を InstructionDownloadForm に切り替える。「コードを発行」を押すと「登録されているメールアドレスに確認コードを送信しました」と出す。使わなくなった OtpDownloadCard・
    use-otp-download.ts は削除する。案内メールの本文の「メールアドレスを入力」という説明を直す。
- API の変更: email が必須から任意になる(認証の方式に関わるため、着手前に利用者へ報告する)。
- 確認方法: 各フォルダの otp-download.test.ts を「入力なしで登録宛先にコードが届く」「宛先が無ければエラー」「回数制限が効く」に直して通す。

### REQ-008 発注・購買申請の保存後の表示を仕入とそろえる

- 規模: 小
- 対象: `frontend/app/purchase/orders/page.tsx`・`_hooks/usePurchaseOrderOperations.ts`、`frontend/app/purchase/requisitions/page.tsx`・`_hooks/usePurchaseRequisitionOperations.ts`
- 変更内容: 仕入(purchase/receipts/page.tsx と usePurchaseRecognitionSaveActions.ts の setSavedRecognitionSummary)と同じく、保存に成功したら `_shared/ui/SavedSummaryModal.tsx` で
  番号・件名・仕入先・合計金額を出す。
- 確認方法: それぞれのフックのテストで、保存後に要約がセットされること。

### REQ-009 発注の納品場所を名称と所在地に分ける(DB変更あり)

- 規模: 中
- 対象: `backend/src/db/schemas/schema-biz.ts`(orders、718行目から)、`routes/purchase/orders/`(スキーマ・保存・CSV・purchase-order-pdf.service.ts 83行目)、
  `platform/report-templates/resolve-purchase-order-placeholders.ts`(98行目)、`frontend/app/purchase/orders/_components/PurchaseOrderFormHeader.tsx`、`_hooks/direct-shipment-place.ts`
- 変更内容:
  - orders に `delivery_place_address`(文字列・空可)を足す。今の delivery_place は「納品場所名」として使う。
  - 画面は「納品場所名」「納品場所の所在地」の2欄にする。拠点・倉庫を選んだ時は、名称と住所をそれぞれの欄に入れる。直送の時は、名称に「直送: 得意先名」、所在地に納品先の住所を入れる。
  - 発注書: 既定のレイアウトは名称と所在地を2行で印字する。Excel テンプレート用に delivery_place_address の差し込み項目を足す。
  - CSV の取込・出力に列を足す(取込では省略可。sampledata/ は変えない)。承認の変更申請・プレビューにも項目を足す。
  - 購買申請に納品場所がある場合は、同じ列を足して発注へ引き継ぐ。
- 確認方法: 発注の保存・取得・CSV のテストと、発注書の差し込みのテスト。docs/database/purchase.md を直す。

### REQ-010 入荷指示で内部倉庫も選べるようにする

- 規模: 中
- 対象: `backend/src/routes/inventory/receipt-instructions/receipt-instructions.service.ts`(165行目の `warehouseType !== "EXTERNAL"`)、receipt-instruction-pdf.service.ts(90行目のラベル)、
  `frontend/app/inventory/stock/_hooks/useReceiptInstructionForm.ts`(101行目の絞り込み)、`_components/ReceiptInstructionPanel.tsx`(263行目・302行目の文言)、
  `frontend/app/inventory/receiving/page.tsx`(186行目・360行目の分岐)
- 変更内容: 外部倉庫だけという制限を外し、直送用の倉庫(区分 DIRECT)だけを除く。文言の「外部倉庫」は「倉庫」にする。内部倉庫でメールの宛先が無い場合は、指示書の発行だけ行い
  メールは送らない(今の宛先なしの扱いのまま)。内部倉庫向けの入荷指示から入庫を登録する流れ(指示とのつながり・発注の入荷済数量)が動くことを確かめ、動かない分岐があれば直す。
- 確認方法: 入荷指示のテストに「内部倉庫で作成できる」「直送用の倉庫は拒否する」「内部倉庫の指示から入庫を登録すると発注の入荷済数量が増える」を足す。マニュアル(docs/manual/inventory/)を直す。

### REQ-011 品目マスタに無い明細は入荷・出荷の対象外にし、一時保管は別の台帳で管理する

今の在庫(stocks・stock_transactions)は品目マスタの品目番号が前提で、引当・棚卸・在庫評価・仕訳がそれを使っている。マスタに無い物は在庫には混ぜず、
在庫管理の画面に別の「一時保管」の台帳を作る。規模: 大。

- (1) 対象外を画面に出す:
  - 対象: 発注・受注から入荷指示・入庫・出荷指示・出庫を作る画面(`frontend/app/inventory/receiving/page.tsx`・`inventory/shipping/page.tsx`・
    `inventory/stock/_hooks/useReceiptInstructionForm.ts`・useShipmentInstructionForm.ts・useStockReceiptForm.ts・useStockShipmentForm.ts)、
    `purchase/orders/_components/PurchaseOrderReceiptProgress.tsx`、受注の出荷状況の表示
  - 変更内容: 直接入力の明細(`inputType = "DIRECT"`)は選べない行として灰色で出し、「品目マスタに無いため対象外(一時保管で管理できます)」と添える。発注の入荷状況・受注の出荷状況の
    計算からは、サービス品(`platform/inventory/service-items.ts` の selectServiceItemIds)と同じく外す。仕入・売上は、会社設定で「入荷(出荷)済み数量まで」にしていても、
    直接入力の明細は発注(受注)の数量まで計上できるようにする(サービス品と同じ)。今の動きを先にテストで確かめ、既にそうなっている箇所は変えない。
  - 確認方法: 直接入力の明細を含む発注・受注で、入荷指示・出荷指示の作成画面にその行が選べない状態で出ること、発注が「入荷済」になれること、仕入・売上を計上できること。
- (2) 一時保管の台帳(DB変更あり):
  - 決定(2026-11-10): 自社の物と、取引先からの預り品の両方を扱う。受入・払出には承認を付けるが、承認フローが設定されていなければ承認なしですぐ確定する。
  - 画面: 「在庫・棚卸管理」(/inventory/audit)に「一時保管」タブを足す。一覧(区分・保管場所・品名・数量・元の伝票・取引先・受入日・払出予定日・状態)、受入、払出、数量の調整、
    履歴、CSV 出力。区分(自社品・預り品)で絞り込める。払出予定日を過ぎたものを赤で出す。画面マスタ(`backend/src/constants/screens.ts`)に inventory_temporary_holdings を足し、権限を設定できるようにする。
  - DB(案): `temporary_holdings`(番号、区分 OWN(自社品)/CUSTODY(預り品)、品名、規格・メモ、数量、単位、倉庫、ロケーション(任意)、元の伝票の種類と番号・明細番号
    (発注明細・受注明細・なし)、取引先(預り品は必須)、受入日、払出予定日、状態(保管中・払出済・在庫へ移行済)、監査の列)と `temporary_holding_movements`
    (受入・払出・調整の1件ずつ: 種類、数量、日付、メモ、作成者、承認の状態(申請中・確定・差戻し))。台帳の数量は「確定」の動きだけを合計する。
  - 承認: 申請の種類 inventory_temporary_holdings を足し(動き1件ごとに申請、金額は 0)、アダプター(承認で「確定」、差戻し・取下げで「差戻し」、プレビューは区分・品名・数量・
    保管場所・取引先・元の伝票)を registry.ts に登録する。登録の時に、この種類の有効な承認フローが1つも無ければ申請を作らずに「確定」で保存する。今の WorkflowEngine はフローが無いと
    「合致する有効な承認フローが定義されていません」を返すため(`workflow-engine/engine.ts` 83行目)、先にフローの有無を調べる関数を engine に足す(他の申請の種類の動きは変えない)。
  - 使い方: 発注の直接入力の明細から「一時保管で受入」できる(品名・数量・取引先を引き継ぐ)。受注の直接入力の明細に紐づけて払出できる。伝票によらない受入・払出(預り品の受け取り・返却など)も手入力できる。
    発注の明細から受け入れても、発注の「入荷済数量」には数えない(台帳に発注番号を残すだけ)。在庫数・引当・棚卸・在庫評価・仕訳には含めない。
  - 確認方法: 「フローが無いと登録ですぐ確定し数量が変わる」「フローがあると申請中になり、承認で数量が変わる」「差戻しでは変わらない」「残りを超える払出は拒否する」
    「預り品は取引先が必須」「在庫照会の数量に入らない」のテスト。docs/database/inventory.md とマニュアルに足す。
- (3) 品目マスタへの切り替え((2) の後): 自社品の行に「品目マスタに登録して在庫へ移す」を付ける(預り品は自社の在庫にしないため対象外)。品目を選ぶ(無ければ品目マスタの登録画面へ)と、
  残りの数量で入庫が作られ(今の入庫と承認の流れを通る)、入庫が確定したら台帳の行は「在庫へ移行済」になる。

### REQ-012 入荷指示書・出荷指示書のメールを明示の操作にする

- 規模: 中
- 現状: receipt-instruction-pdf.service.ts(168行目付近)と shipment-instruction-pdf.service.ts は、PDF を生成すると同時に案内メールを登録している。
  納品書・検収書は、画面の「メール送信」(DeliveryNoteMailModal.tsx・`POST /api/stock-shipments/:id/send-email`)で送る。
- 変更内容: PDF の生成からメールの登録を外す。入荷指示・出荷指示に `POST /:id/send-email` を足し(delivery-note-mail.service.ts と同じ形)、ReceiptInstructionPanel・
  ShipmentInstructionPanel に「メール送信」ボタンと送信画面(`_shared/ui/MailSendModal.tsx`)を足す。宛先の初期値は倉庫の登録済み連絡先。
- API の変更: API を2つ追加。PDF 生成の API はメールを送らなくなる。
- 確認方法: 「PDF を生成してもメールが登録されない」「メール送信で登録される」のテスト。マニュアルを直す。

### REQ-013 進捗確認に「未起票」と担当予定を出す

- 規模: 中
- 対象: `backend/src/routes/progress/progress.service.ts`・progress-next-step.ts・progress.schema.ts、`frontend/app/progress/_components/ProgressTable.tsx`・`_types/index.ts`
- 現状: 工程の並び(販売: 見積→受注→出荷指示→出荷→売上→請求、購買: 購買申請→発注→入荷指示→入荷→仕入→支払)と「次の工程」1つの判定、工程ごとの担当の解決は既にある。
  伝票が無い工程の欄は空白で、未起票なのか対象外なのかが分からない。
- 変更内容:
  - バックエンド: 各行について、その案件が通る流れ(販売・購買)のうち、起点より後で伝票が無い工程を「未起票」として返す(工程キーと担当予定の名前。担当の解決は「次の工程」と同じ処理を使う)。
    入荷指示・出荷指示は任意の工程なので「未起票」にしない。購買の流れは、購買起点の案件か、販売起点でも購買側の伝票がある案件だけを対象にする(今の computeNextStages と同じ条件)。
    見積起点で受注が無い案件は、受注だけを未起票にする。
  - 画面: 未起票の工程の欄に「未起票」と「担当予定: 氏名(未設定なら「未設定」)」を薄い色で出す(CLAUDE.md の文字色の下限を守る)。対象外の工程は「―」を出す。CSV の出力にも同じ区別を入れる。
- API の変更: 応答に項目を足すだけ(既存の項目は変えない)。
- 確認方法: progress/index.test.ts に「受注だけ」「受注 + 発注」「発注だけ」「見積だけ」の4件、ProgressTable.test.tsx に表示のテスト。

### REQ-014 「工程ごとの担当設定」の説明

- 規模: 小(REQ-013 の後に行う)
- 対象: `frontend/app/admin/progress-stage-owners/page.tsx`、docs/manual/admin/ の該当ページ
- 変更内容: 画面の上部に説明を出す。文案: 「進捗確認の画面で、次の工程や未起票の工程の『担当』として表示する人(または部門とロール)を、工程ごとに決めます。
  案件ごとに変える場合は、進捗確認の画面で個別に指定します。」コードの動き(progress.service.ts の担当の解決)と合っていることを確かめ、違う点があれば文案を直す。
- 確認方法: 画面のテストで説明が出ること。

### REQ-015 見積の失注(DB変更あり)

- 決定: 失注日と失注理由を足す。進捗確認では完了扱い。規模: 中
- 対象: `backend/src/db/schemas/schema-biz.ts`(quotes)、`routes/sales/quotes/`(スキーマ・サービス・一覧・CSV)、`routes/progress/progress-completion.ts`・progress.service.ts、
  `frontend/app/sales/quotes/`(一覧・フォーム・状態の表示)、`frontend/app/_shared/status/`
- 変更内容:
  - DB: quotes に `lost_date`(失注日、YYYY-MM-DD)と `lost_reason`(失注理由、文字列)を足す。状態に LOST(失注)を足す。
  - API: `POST /api/quotes/:id/mark-lost`(失注日・失注理由)と `POST /api/quotes/:id/cancel-lost`(失注の取消)。失注にできるのは、承認済み(承認が無効なら下書き以外の確定状態)で、
    受注に使われていない見積だけ。失注日は必須(画面の既定は今日)、理由は任意。取消すると元の状態に戻り、失注日・理由は空にする。どちらも見積の更新権限が要り、監査ログを残す。承認は付けない。
  - 失注の見積は、編集・受注への変換・メール送信をできないようにする(複写の元には使える)。
  - 画面: 見積の詳細に「失注にする」(失注日・理由を入れる小さな画面)と「失注を取り消す」を足す。一覧の状態の絞り込みとバッジに「失注」を足す。
    CSV 出力に失注日・失注理由の列を足す(取込では省略可。sampledata/ は変えない)。
  - 進捗確認: 見積が起点の案件で見積が失注なら、案件を「完了」として扱い(progress-completion.ts)、見積の欄に「失注」を出す。REQ-013 の「未起票」に受注を出さない。
    商談の状態(失注)は自動では変えない。
- 確認方法: 「承認済みの見積を失注にできる」「受注済み・下書きは拒否」「失注の見積は受注にできない」「取消で元に戻る」「進捗確認で完了になる」のテスト。
  docs/database/sales.md とマニュアルに足す。

### REQ-016 承認プレビューから元の伝票を開く(BUG-089 の後に行う)

- 規模: 小
- 対象: `frontend/app/workflow/tasks/_components/TaskPreviewRow.tsx`、`frontend/app/workflow/histories/_components/WorkflowTable.tsx`、`frontend/app/progress/_lib/document-href.ts`
- 変更内容: プレビューの右上に「伝票を開く」(別タブ)のリンクを出す。リンク先は、「修正して再提出」が使っている編集先の解決(バックエンドの resolveEditPath と画面マスタのパス)を
  そのまま使う。進捗確認の buildDocumentHref と同じ editId / openId の形にする。参照する権限が無い画面へのリンクは出さない。
- 確認方法: TaskTable.test.tsx・WorkflowTable.test.tsx で、種類ごとのリンク先が正しいこと。

### REQ-017 請求に承認を付ける

- 決定: 売上と同じ形。請求を作成 → 承認申請 → 承認済みになって初めて PDF の発行・メール送信・取引先のダウンロードができる。会社設定のスイッチで ON/OFF し、OFF の間は今と同じ動き。規模: 大
- 手本: 売上の承認(`backend/src/workflow-engine/target-adapters/sales-invoices.adapter.ts` とそのテスト、`routes/sales/invoices/index.ts` 244行目の `/:id/submit-for-approval`、
  workflow-engine/settings.ts の isSalesInvoiceWorkflowGloballyEnabled)。
- 変更内容:
  - 申請の種類 sales_billing を足す: 承認フローの種類の一覧(`routes/admin/approval-flows/approval-flows.schema.ts` と画面)、`target-adapters/billing.adapter.ts`
    (金額=請求の合計、承認で APPROVED、差戻し・取下げで DRAFT、プレビューはヘッダーと明細)、registry.ts。
  - 会社設定 `is_billing_approval_enabled`(既定 OFF)を settings.ts・会社設定のスキーマと画面・auth/profile の応答(isBillingWfEnabled)・`frontend/app/hooks/use-page-permission.ts` に足す
    (PERF-04 の後に行い、会社設定の読み取りを増やさない)。
  - `routes/sales/billing/index.ts` に `POST /:id/submit-for-approval` を足す。billing-pdf.service.ts・billing-mail.service.ts・billing-download.service.ts は、スイッチが ON の時、
    状態が APPROVED か ISSUED の請求だけを受け付ける。承認待ちの間は編集・削除できない。承認後の変更は、売上と同じ扱い(変更申請)にする。
  - 画面: `frontend/app/sales/billing/_components/BillingDetailModal.tsx` に「承認申請」ボタンと状態の表示を足し、承認前は PDF 発行・メール送信を押せないようにする。
    一覧に状態の絞り込みを足す。進捗確認の請求の欄に「申請中」を出す。
  - DB: 売上(sales_invoices)に承認のための列(承認フロー・現在の段など)があれば、billing_headers にも同じ列を足す(列名を報告してから)。状態の列は既にある。
  - 承認フローのサンプル: sales_billing のフロー(請求の作成者 → 課長 → 経理)を 2026-11-09 に渡した取込用 CSV に足す(sampledata/ は変えない)。
- 確認方法: billing.adapter.test.ts(売上のテストと同じ観点)。スイッチが OFF の時に既存の billing-crud.test.ts・billing-pdf.test.ts・otp-download.test.ts がそのまま通ること。
  ON の時に承認前の PDF 発行・メール送信・ダウンロードが拒否されること。

### REQ-018 入金・支払の消込に承認を付ける(DB変更あり。REQ-017 の後)

- 決定: 入金1件ごとに承認し、承認後に反映。規模: 大
- 対象の操作: 請求への入金の記録(payment_receipts、`POST /api/sales-billing/:id/payment-receipts`)、単体の入金(cash_receipts、`POST /api/cash-receipts/register`・`/:id/link`)、
  支払の消込(payment_disbursements、2026-11-10 に対象に追加)。
- 変更内容:
  - DB: payment_receipts・cash_receipts・payment_disbursements に承認の状態の列(`approval_status`: 申請中・承認済・差戻し。既定は承認済で、今あるデータはそのまま有効)を足す。
  - 会社設定 `is_cash_receipt_approval_enabled`(入金)と `is_payment_disbursement_approval_enabled`(支払の消込)。既定は OFF。ON の時は、登録すると「申請中」になり、
    承認されるまで消込額・消込状態・前受(前払)の充当・仕訳に含めない。
  - 集計している billing-reconciliation.service.ts・`routes/sales/cash-receipts/cash-receipts.service.ts`・`routes/purchase/payment/payment-reconciliation.service.ts`・
    `platform/journal/journal-sources.ts`(入金は253〜268行目、支払は同じファイルの該当箇所)を、承認済みだけにする。差戻したものは修正して再申請するか削除する。
    総合振込データの出力(payment-firm-banking.service.ts)が消込の状態を使っているか確かめ、使っていれば承認済みだけを数える。
  - 申請の種類 sales_payment_receipts(請求への入金)・sales_cash_receipts(単体の入金)・purchase_payment_disbursements(支払の消込)を足す。金額=入金(支払)額。
    プレビューは請求(支払)番号・取引先・日付・金額・方法。BUG-094 の 0 円の消込も同じく申請する。
  - 画面: BillingDetailModal.tsx・CashReceiptsPanel.tsx・PaymentDetailModal.tsx の行に状態を出し、申請中の金額を残高とは別に「承認待ち ¥…」として出す。
- 確認方法: スイッチ OFF で既存の入金・支払・消込・仕訳・総合振込のテストが通ること。ON で「申請中は消込額・仕訳に入らない」「承認で入る」「差戻しで入らないまま」を入金・支払のそれぞれで確かめる。

### REQ-019 購買申請の仕入先をマスタ選択だけにする

- 規模: 小
- 対象: `frontend/app/purchase/requisitions/_components/PurchaseRequisitionForm.tsx`(275〜310行目。「仕入先名(自由入力)」の欄)、購買申請の保存のスキーマ
- 変更内容: 自由入力の欄を無くし、マスタからの選択だけにする。保存する仕入先名はマスタの名称を入れる。自由入力で保存済みの申請はそのまま表示し、次に保存する時にマスタからの選択を求める。
  申請(下書き以外)の時は、バックエンドでも仕入先の指定を必須にする。CSV の取込は、今のサンプルが取り込める状態を保つ。
- 確認方法: 画面と保存のテスト。`packages/backend/test/sampledata-import.test.ts` が通ること。

### REQ-020 発注単体の明細は、希望納期を回答納期に展開する

- 決定: 受注とつながらない発注明細は、希望納期を回答納期の初期値にする。回答納期は修正できる。受注とつながる明細は今のまま(仕入先の回答を入力し、受注の納期へ反映する)。規模: 小
- 対象: `frontend/app/purchase/orders/_components/PurchaseOrderItemsTable.tsx`(270〜300行目の希望・回答の入力欄)、`_hooks/usePurchaseOrderOperations.ts`(392行目・448行目の明細の初期値)、
  `_hooks/parse-delivery-date-text.ts`(applyDeliveryDateTextToItems)、`backend/src/routes/purchase/orders/` の CSV 取込
- 変更内容:
  - 受注明細とつながらない明細(salesOrderItemId が空)で希望納期を入れた・変えた時、回答納期が空か、直前の希望納期と同じなら、回答納期にも同じ日付を入れる
    (applyDeliveryDateTextToItems と同じ考え方)。回答納期を手で別の日にした後は、希望納期を変えても上書きしない。
  - 納期の文言から希望納期を入れる時、購買申請から発注を作る時、過去の発注を複写する時も同じ規則にする。
  - CSV 取込: 回答納期が空で受注とつながらない明細は、希望納期を入れる。
  - 入力欄の近くに説明を出す:「受注とつながらない明細は、希望納期が回答納期に入ります(変更できます)。受注とつながる明細の回答納期は、受注の納期に反映できます。」
- 確認方法: parse-delivery-date-text.test.ts・usePurchaseOrderOperations.test.ts に「受注なしの明細で希望を入れると回答も入る」「回答を変えた後は上書きしない」
  「受注とつながる明細は回答に入らない」を足す。CSV 取込のテストも足す。

### REQ-021・REQ-022 入庫・検収書から発注へ、納品書から受注へのリンク

- 規模: 小
- 対象: `frontend/app/inventory/stock/_components/InventoryHistoryPanel.tsx`・AcceptanceInspectionPanel.tsx・OpenedStockDocumentCard.tsx・DeliveryNotePanel.tsx
- 変更内容: 入庫・検収書の表示に「発注番号」(orderId)を、出庫・納品書の表示に「受注番号」(salesOrderId)を出し、buildDocumentHref で元の発注・受注を開くリンクにする。
  番号が無い入出庫(単独の入庫・出庫)では出さない。一覧の API が番号を返していない場合は、応答に足す。
- 確認方法: DeliveryNotePanel.test.tsx・OpenedStockDocumentCard.test.tsx でリンクが出ること。

### REQ-023 一括承認の結果に、次の段の承認待ちになった件を出す

- 見つけた日: 2026-11-14(Staging の確認で「一括承認で承認しても、すべて承認されていない」とユーザーから指摘)
- 調べた結果(2026-11-14、Staging の DB を読み取りで確認): 一括承認は失敗していなかった。承認フローが2段(1段目 users → 2段目 manager)の見積2件を
  一括承認し、QT-5603-1 は2段目(最後の段)を承認して申請が承認済みになった。QT-2139-1 は1段目を承認し、2段目の承認待ちが作られた。
  操作したユーザーが2段目のロールも持っていたため、同じ一覧に残り「承認されていない」ように見えた(後で個別に承認済み)。
- 今の仕様: 一括承認・個別の承認とも、1回の操作で承認するのは今の段だけ。申請の時に1段目だけ、申請者がそのロールを持っていれば自動で通過する。
- 決定(2026-11-14): 自動で次の段を通過させることはせず、結果の表示を分かりやすくする(案2)。
- 変更内容(案):
  - 一括承認の応答(`workflow-tasks-bulk.service.ts`)で、承認した件を「最後の段まで承認(申請が承認済み)」と「次の段の承認待ちになった」に分けて数え、
    次の段になった件は、その段のロール名(ロールマスタの名称。名称が無ければロール ID)ごとの件数を返す。
  - メッセージの例: 「2件を承認しました(うち1件は次の段「課長」の承認待ちになりました)」。
  - 個別の承認(`workflow-tasks-approval.service.ts`)も同じ考え方で、次の段に回った場合は「次の段「課長」の承認待ちになりました」と出す(同じ見え方のため。
    不要なら一括承認だけにする)。
  - 画面(`workflow/tasks/_hooks/useWorkflowTasks.ts`)は、応答のメッセージをそのまま出しているため、画面の変更は要らない見込み。
- API の変更: 応答に項目を足し、メッセージの文言を変える(既存の項目は変えない)。
- 確認方法: 2段のフローで、1段目の一括承認は「次の段のロール名」が出ること、最後の段の一括承認は申請が承認済みになり出ないこと、
  ロール名が無いロールは ID で出ること、失敗の件数の表示が今と同じであること。

### REQ-006 倉庫間移動(横持ち)を、入庫・出庫とは分けた機能にする(旧 TSK-004)


- 見つけた日: 2026-11-08(ユーザーの質問「倉庫間を横持ちさせる場合はどう入力するか」から)
- 今の作り(2026-11-08 のコードで確認):
  - 移動元の倉庫で「出荷 > 出庫」に **移動先倉庫** を選んで確定する(移動元の在庫が減る)。移動先の倉庫で「入荷 > 入庫」に **移動元倉庫** を
    選んで確定する(移動先の在庫が増える)。出庫から入庫は作られず、2つの記録はつながっていない。
  - 得意先と移動先倉庫・仕入先と移動元倉庫は、どちらか一方しか指定できない。倉庫間移動では得意先・仕入先が入らないため、納品書は作られず、
    仕入計上の「対象検収」にも出ない(倉庫間移動としては正しい)。発注を選んだ入庫では移動元倉庫を選べない(BUG-078)。
  - 出荷指示・入荷指示(外部倉庫向け)には、倉庫間移動の指定が無い。
- 問題: 入庫の入力漏れに気づけない。輸送中の在庫が分からない。出庫と入庫の数量の食い違いを確かめられない。
- ユーザーの方向性(2026-11-08):
  - 倉庫間移動は、入庫・出庫とは分けた機能(画面・記録)にした方がよいかもしれない。
  - 出荷指示・入荷指示からも、倉庫間移動ができるようにした方がよいかもしれない(外部倉庫との横持ちのため)。
- 検討すること(案):
  1. 倉庫間移動の伝票(移動元・移動先・品目・数量・状態: 出庫済み/輸送中/入庫済み)を新しく持つか、今の出庫・入庫の記録のつながりで表すか。
  2. 移動元の出庫を確定したら「入庫待ち」とし、移動先で入庫する時にそこから選んで数量を消し込む(一部入庫・差異の扱い)。
  3. 外部倉庫が絡む場合(自社→外部・外部→自社・外部→外部)に、出荷指示・入荷指示をどう作るか(指示書の宛先・承認の流れ)。
  4. 在庫照会での輸送中の在庫の見え方、棚卸・在庫評価(会計)での扱い。
  5. 今ある倉庫間移動の記録(出庫の移動先倉庫・入庫の移動元倉庫)の移行。
- DB・画面・承認の流れの変更を含むため、設計を相談してから進める。

### TSK-005 TSK-001 で直せなかった依存の脆弱性(exceljs・uuid・zod)

- 見つけた日: 2026-11-08(TSK-001 の対応の中で)
- exceljs(中。依存の archiver・uuid・glob・minimatch などを含む): npm が示す修正は exceljs 3.4.0 への格下げ(メジャーバージョンが変わる)で、
  帳票の Excel テンプレートの読み込みなどが壊れるおそれがあるため見送った。uuid の脆弱性は v3/v5/v6 で buf を渡した場合のもの。
  exceljs の新しい版(依存を更新したもの)が出るのを待つか、使い方(帳票テンプレートの読み込み)を調べて代わりのライブラリを検討する。
- zod(高。大きな入力の検証でメモリを使い切る): テスト用の `@cloudflare/vitest-pool-workers`(最新の 0.23.0 も)が zod 4.4.3 を固定で
  要求している。本番のコードは zod を使っておらず(バンドルにも入らない)、影響はテストの実行環境に限られる。
  vitest-pool-workers の更新を待つ。
