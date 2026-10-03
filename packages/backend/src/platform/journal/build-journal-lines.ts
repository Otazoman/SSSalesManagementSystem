import { drizzle } from "drizzle-orm/d1";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { JournalLineInput } from "./post-journal-batch";
import { resolveVariableAccount } from "./resolve-variable-account";
import { findSlot, loadPatterns, slotLabel, type PatternLineKind } from "./posting-patterns";

// 仕訳の行の組み立て(V-4、V-5で組の形に変更)。仕訳ルールマスタ(journal_posting_rules)・仕訳パターン
// (journal_posting_patterns)と元伝票の金額から、「借方〇〇/貸方〇〇」の組を並べた明細行を作る。
// 転記(postJournalBatch)は行わず、行だけを返す。伝票を選んで仕訳を作る機能(前払・前受・売上・仕入・入金・支払。
// journal-sources.ts / routes/admin/journal-sources/document-posting.ts)が使う。
// (V-4④で、発注・受注の保存や売上・仕入の承認確定時の自動転記は廃止した)
// 組み立てられない場合は、理由つきで失敗を返す(呼び出し側が画面にエラーを出す)

export type BuildJournalLinesResult =
  | { ok: true; lines: JournalLineInput[] }
  | { ok: false; kind: "RULE_UNAVAILABLE" | "ACCOUNT_UNRESOLVED"; reason: string };

// 品目に連動しない、借方1行・貸方1行の仕訳
export type TwoLineEventType = "PREPAYMENT" | "ADVANCE_RECEIPT" | "RECEIPT" | "DISBURSEMENT";

type PostingRule = typeof schema.journalPostingRules.$inferSelect;

const RULE_UNAVAILABLE = (eventType: string): BuildJournalLinesResult => ({
  ok: false,
  kind: "RULE_UNAVAILABLE",
  reason: `仕訳ルール(${eventType})が未設定、または無効です`,
});

const PAIR_UNAVAILABLE = (eventType: string, label: string): BuildJournalLinesResult => ({
  ok: false,
  kind: "RULE_UNAVAILABLE",
  reason: `仕訳ルール(${eventType})の「${label}」の借方・貸方の勘定科目が未設定です`,
});

export async function findEnabledRule(db: D1Database, eventType: string): Promise<PostingRule | null> {
  const mainDb = drizzle(db, { schema });
  const rows = await mainDb
    .select()
    .from(schema.journalPostingRules)
    .where(eq(schema.journalPostingRules.eventType, eventType as PostingRule["eventType"]))
    .limit(1);
  const rule = rows[0];
  return rule && rule.enabled ? rule : null;
}

// 元伝票(発注/受注/入金消込/支払消込)のプロジェクト名(転記時点のスナップショット用)
export async function resolveProjectName(db: D1Database, projectId: string | null | undefined): Promise<string | null> {
  if (!projectId) return null;
  const mainDb = drizzle(db, { schema });
  const rows = await mainDb
    .select({ name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  return rows[0]?.name ?? null;
}

type AccountSnapshot = { code: string; name: string; externalMappingCode: string | null };

// 使う勘定科目の名前・外部連携コードをまとめて引く(仕訳には転記時点の名前を保存する)
async function loadAccounts(db: D1Database, codes: string[]): Promise<Map<string, AccountSnapshot>> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return new Map();
  const mainDb = drizzle(db, { schema });
  const rows = await mainDb
    .select({
      code: schema.accounts.code,
      name: schema.accounts.name,
      externalMappingCode: schema.accounts.externalMappingCode,
    })
    .from(schema.accounts)
    .where(inArray(schema.accounts.code, unique));
  return new Map(rows.map((r) => [r.code, r]));
}

// 借方・貸方が同じ金額の1組(科目はコードのまま。名前は最後にまとめて入れる)
interface DraftPair {
  amount: number;
  debitCode: string;
  creditCode: string;
  // 税区分を持たせる側(売上高・仕入高の側)。消費税・充当の組は持たない
  taxSide: "DEBIT" | "CREDIT" | null;
  taxCategoryCode?: string | null;
  taxRate?: number | null;
  item?: { itemId: string | null; itemName: string; sourceRefItemId: string | null };
}

// 組を、借方行・貸方行の順に並べた仕訳の明細にする。組ごとに同じ順で並べるので、
// 表示・出力のときに pairJournalLines() でそのまま組に戻せる
async function toJournalLines(db: D1Database, eventType: string, pairs: DraftPair[]): Promise<BuildJournalLinesResult> {
  const accounts = await loadAccounts(
    db,
    pairs.flatMap((p) => [p.debitCode, p.creditCode]),
  );
  const lines: JournalLineInput[] = [];
  for (const p of pairs) {
    for (const side of ["DEBIT", "CREDIT"] as const) {
      const code = side === "DEBIT" ? p.debitCode : p.creditCode;
      const account = accounts.get(code);
      if (!account) {
        // 科目が削除済み等、想定外
        return {
          ok: false,
          kind: "ACCOUNT_UNRESOLVED",
          reason: `仕訳ルール(${eventType})の勘定科目[${code}]がマスタに存在しません`,
        };
      }
      lines.push({
        side,
        accountCode: account.code,
        accountName: account.name,
        externalMappingCode: account.externalMappingCode,
        amount: p.amount,
        ...(p.taxSide === side ? { taxCategoryCode: p.taxCategoryCode ?? null, taxRate: p.taxRate ?? null } : {}),
        ...(p.item ?? {}),
      });
    }
  }
  return { ok: true, lines };
}

export async function buildTwoLineJournalLines(
  db: D1Database,
  eventType: TwoLineEventType,
  amount: number,
): Promise<BuildJournalLinesResult> {
  const rule = await findEnabledRule(db, eventType);
  if (!rule) return RULE_UNAVAILABLE(eventType);

  const patterns = await loadPatterns(db, eventType, rule);
  const body = patterns.find((p) => p.documentType === "DEFAULT" && p.lineKind === "BODY");
  // ルール保存時にenabled=trueなら必要な科目が揃うことを検証しているが、念のため防御的にチェックする
  if (!body?.debitAccountCode || !body.creditAccountCode) {
    return { ok: false, kind: "RULE_UNAVAILABLE", reason: `仕訳ルール(${eventType})の勘定科目が未設定です` };
  }
  return toJournalLines(db, eventType, [
    { amount, debitCode: body.debitAccountCode, creditCode: body.creditAccountCode, taxSide: null },
  ]);
}

// ---- 品目に連動する仕訳(売上・仕入) ----

export interface ItemLinkedJournalLineInput {
  itemId: string | null; // DIRECT入力等で品目マスタに解決できない場合はnull
  itemName: string;
  itemAccountCode: string | null; // items.accountCode(呼び出し元で解決済みの値を渡す)
  amount: number; // 税抜金額
  taxCategoryCode: string | null;
  taxRate: number | null;
  taxAmount: number;
  sourceRefItemId: string | null; // 元伝票明細行のid
}

export interface BuildItemLinkedJournalLinesInput {
  eventType: "PURCHASE" | "SALES";
  // 売上: SALE/RETURN/DISCOUNT/CORRECTION、仕入: PURCHASE/RETURN/DISCOUNT/CORRECTION。
  // 区分ごとの仕訳パターン(返品は借方・貸方が逆、など)を使う
  documentType: string;
  lines: ItemLinkedJournalLineInput[];
  // 前受金/前渡金からの充当額(0円以上、合計金額を超えない範囲で呼び出し元が算出する)。
  // 明細は通常どおり売掛金/買掛金で計上し、充当額を「前受金/売掛金」(仕入は「買掛金/前渡金」)の組で振り替える
  advanceAppliedAmount?: number;
}

/**
 * 売上・仕入の仕訳(V-5)。明細1行ごとに「本体」「消費税」の組を作り、前受金・前渡金の充当は最後に1組で振り替える。
 * 例(売上): 売掛金1,000/売上高1,000(品目A)、売掛金100/仮受消費税100、…、前受金500/売掛金500
 */
export async function buildItemLinkedJournalLines(
  db: D1Database,
  input: BuildItemLinkedJournalLinesInput,
): Promise<BuildJournalLinesResult> {
  const rule = await findEnabledRule(db, input.eventType);
  if (!rule) return RULE_UNAVAILABLE(input.eventType);

  const bodySlot = findSlot(input.eventType, input.documentType, "BODY");
  if (!bodySlot) {
    return { ok: false, kind: "RULE_UNAVAILABLE", reason: `伝票の区分[${input.documentType}]の仕訳パターンがありません` };
  }
  const patterns = await loadPatterns(db, input.eventType, rule);
  const patternOf = (lineKind: PatternLineKind) =>
    patterns.find((p) => p.documentType === input.documentType && p.lineKind === lineKind);

  // 組の片側の科目。品目の科目を使う側は、品目(明細)の科目→無ければパターンの科目
  const sideCode = (fromItem: boolean, code: string | null, itemAccountCode: string | null) =>
    fromItem
      ? resolveVariableAccount({
          priority: rule.variableAccountPriority,
          itemAccountCode,
          headerAccountCode: null,
          fallbackAccountCode: code,
        }).accountCode
      : code;

  const pairs: DraftPair[] = [];
  for (const line of input.lines) {
    for (const lineKind of ["BODY", "TAX"] as const) {
      const amount = lineKind === "BODY" ? line.amount : line.taxAmount;
      if (!amount) continue;
      const label = slotLabel({ documentType: input.documentType, lineKind });
      const p = patternOf(lineKind);
      if (!p) return PAIR_UNAVAILABLE(input.eventType, label);
      const debitCode = sideCode(p.debitFromItem, p.debitAccountCode, line.itemAccountCode);
      const creditCode = sideCode(p.creditFromItem, p.creditAccountCode, line.itemAccountCode);
      if (!debitCode || !creditCode) {
        if ((p.debitFromItem && !debitCode) || (p.creditFromItem && !creditCode)) {
          return { ok: false, kind: "ACCOUNT_UNRESOLVED", reason: `品目「${line.itemName}」に有効な勘定科目がありません` };
        }
        return PAIR_UNAVAILABLE(input.eventType, label);
      }
      // マイナスの明細(値引行など)は、金額を正にして借方・貸方を入れ替える
      const negative = amount < 0;
      const flip = (side: "DEBIT" | "CREDIT") => (side === "DEBIT" ? "CREDIT" : "DEBIT");
      const taxSide = lineKind === "BODY" ? bodySlot.itemSide : null;
      pairs.push({
        amount: Math.abs(amount),
        debitCode: negative ? creditCode : debitCode,
        creditCode: negative ? debitCode : creditCode,
        taxSide: taxSide && negative ? flip(taxSide) : taxSide,
        taxCategoryCode: line.taxCategoryCode,
        taxRate: line.taxRate,
        item: { itemId: line.itemId, itemName: line.itemName, sourceRefItemId: line.sourceRefItemId },
      });
    }
  }

  const totalAmount = input.lines.reduce((s, l) => s + l.amount + l.taxAmount, 0);
  const advanceApplied = Math.min(Math.max(input.advanceAppliedAmount ?? 0, 0), Math.max(totalAmount, 0));
  if (advanceApplied > 0) {
    // 充当の組は通常の区分(売上・仕入)にだけある。返品・値引・赤伝(訂正)の受注が前受済みの場合は、
    // 通常の充当の借方・貸方を入れ替えて前受金へ戻す(V-5より前と同じ扱い)
    const normalDocumentType = input.eventType === "SALES" ? "SALE" : "PURCHASE";
    const own = patternOf("ADVANCE");
    const normal = patterns.find((p) => p.documentType === normalDocumentType && p.lineKind === "ADVANCE");
    const [debitCode, creditCode] = own
      ? [own.debitAccountCode, own.creditAccountCode]
      : [normal?.creditAccountCode, normal?.debitAccountCode];
    if (!debitCode || !creditCode) {
      return PAIR_UNAVAILABLE(input.eventType, slotLabel({ documentType: input.documentType, lineKind: "ADVANCE" }));
    }
    pairs.push({ amount: advanceApplied, debitCode, creditCode, taxSide: null });
  }

  return toJournalLines(db, input.eventType, pairs);
}
