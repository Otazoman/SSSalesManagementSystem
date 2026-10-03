// 仕訳ルールマスタ(journal_posting_rules)のvariableAccountPriorityに基づき、
// 品目に連動する変動科目(仕入高/売上高)を1件解決する純粋関数。
// 2026-09-09ユーザー確定: 品目マスタ(items.accountCode)と伝票ヘッダーのどちらを優先するかを
// 選べるようにし、どちらにも値が無ければルールマスタの既定科目(fallback)を使う。
// 受注(sales_orders)にはヘッダー科目の概念自体が無いため、呼び出し元はheaderAccountCodeに
// 常にnullを渡す(結果としてHEADER_FIRSTを選んでもITEM_MASTER_FIRSTと同じ挙動になる)。
// J-2-e(2026-09-13ユーザー確認済み): 購買申請・発注のヘッダー科目列(accountCode)自体を
// プロジェクト欄に置き換えて廃止したため、現状HEADER_FIRSTには実データの供給元が無い
// (この関数は未配線の将来機能でもあり、呼び出し元は依然として存在しない)。関数自体は
// headerAccountCodeを外部から注入される純粋なnull許容引数として扱う設計のため変更不要だが、
// 将来この優先度を実際に使う場合は、ヘッダー科目に相当する別のデータソースを検討すること

export type VariableAccountPriority = "ITEM_MASTER_FIRST" | "HEADER_FIRST";

export type VariableAccountSource = "ITEM_MASTER" | "HEADER" | "FALLBACK" | "NONE";

export interface ResolveVariableAccountInput {
  priority: VariableAccountPriority;
  // 品目マスタ(items.accountCode)から、対象明細のitemIdで引いた値。手入力(DIRECT)明細等で
  // 品目マスタに解決できない場合や、品目自体にaccountCode未設定の場合はnull
  itemAccountCode: string | null;
  // 伝票ヘッダー(purchaseRequests.accountCode / orders.accountCode)の値。
  // 受注系(sales_orders)には該当列が無いため常にnullを渡す
  headerAccountCode: string | null;
  // ルールマスタのvariableAccountFallbackCode
  fallbackAccountCode: string | null;
}

export interface ResolveVariableAccountResult {
  // 解決できなければnull(呼び出し元は、この行の仕訳生成をスキップするかエラーとして
  // journal_posting_events.status='FAILED'にする)
  accountCode: string | null;
  source: VariableAccountSource;
}

export function resolveVariableAccount(
  input: ResolveVariableAccountInput,
): ResolveVariableAccountResult {
  const searchOrder: Array<[Exclude<VariableAccountSource, "FALLBACK" | "NONE">, string | null]> =
    input.priority === "ITEM_MASTER_FIRST"
      ? [
          ["ITEM_MASTER", input.itemAccountCode],
          ["HEADER", input.headerAccountCode],
        ]
      : [
          ["HEADER", input.headerAccountCode],
          ["ITEM_MASTER", input.itemAccountCode],
        ];

  for (const [source, code] of searchOrder) {
    if (code) return { accountCode: code, source };
  }

  if (input.fallbackAccountCode) {
    return { accountCode: input.fallbackAccountCode, source: "FALLBACK" };
  }

  return { accountCode: null, source: "NONE" };
}
