import type { Context } from "hono";
import type { Env } from "../../../types/env";
import { DealsRepository, type BulkDealOperation, type DealTaskRow } from "./deals.repository";
import { ATTENDEE_KINDS, DEAL_STATUSES, type AttendeeKind, type DealStatus } from "./deals.schema";
import { RESOURCE_KEY } from "./deals.service";
import { parseCsvRecords, type CsvRecord } from "../../../platform/csv/csv-parser";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError } from "../../../platform/http/http-error";
import { getDocumentNumberFormatConfig } from "../../../platform/id/resolve-document-id";
import { generateFormattedCode } from "../../../platform/id/generate-short-code";
import { MAX_WRITE_STATEMENTS, estimateWriteStatements } from "./deals-batch-budget";
import { formatJstDate } from "../../../platform/date/format-jst-date";

// 商談のCSV一括取込。1商談を複数行に展開する形式(同じgroupKeyの行を1商談にまとめる):
//   - 商談本体の項目(取引先・件名・日付など)は先頭行の値を使う。以降の行は空欄か同じ値のみ可
//   - 各行は面談者を1件(attendee*)・次回までのタスクを1件(task*)まで持てる(互いに独立した一覧)
//   - dealIdが空=新規登録(商談番号は自動採番)、既存の商談番号=その商談の全項目置き換え
// 書き込み前に全行を検証し、1件でも不正なら何も登録しない。書き込みは1回のバッチ(原子的)。
export const DEALS_CSV_HEADERS = [
  "groupKey",
  "dealId",
  "partnerId",
  "title",
  "dealDate",
  "startTime",
  "endTime",
  "location",
  "memo",
  "status",
  "ownerEmployeeNumber",
  "quoteIds",
  "attendeeKind",
  "attendeeValue",
  "attendeeNote",
  "taskTitle",
  "taskDueDate",
  "taskAssigneeEmployeeNumber",
  "taskIsDone",
] as const;

// 1回に取り込める商談数・行数の上限。これとは別に、D1の書き込み文数の上限(deals-batch-budget.ts)でも制限される
export const MAX_IMPORT_DEALS = 50;
export const MAX_IMPORT_ROWS = 500;
const MAX_REPORTED_ERRORS = 20;

const DEAL_LEVEL_COLUMNS = [
  "dealId",
  "partnerId",
  "title",
  "dealDate",
  "startTime",
  "endTime",
  "location",
  "memo",
  "status",
  "ownerEmployeeNumber",
  "quoteIds",
] as const;
type DealLevelColumn = (typeof DEAL_LEVEL_COLUMNS)[number];

const DONE_TRUE = new Set(["1", "true", "y", "yes", "完了"]);
const DONE_FALSE = new Set(["", "0", "false", "n", "no", "未完了"]);

interface ParsedAttendee {
  kind: AttendeeKind;
  value: string;
  note: string | null;
  line: number;
}

interface ParsedTask {
  title: string;
  dueDate: string | null;
  assignee: string | null;
  isDone: boolean;
}

export interface ParsedDealGroup {
  groupKey: string;
  line: number;
  dealId: string | null;
  partnerId: string;
  title: string;
  dealDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  memo: string | null;
  status: DealStatus | null;
  ownerEmployeeNumber: string | null;
  quoteIds: string[];
  attendees: ParsedAttendee[];
  tasks: ParsedTask[];
}

const jstDateToDate = (s: string) => new Date(`${s}T00:00:00+09:00`);

// Excelで保存し直された「2026/9/21」「9:00」も受け付けて、内部形式(YYYY-MM-DD / HH:MM)にそろえる
function normalizeDate(raw: string): string | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeTime(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return null;
  const [h, mi] = [Number(m[1]), Number(m[2])];
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const jstDay = formatJstDate;

// 既存の完了済みタスクのうち、タスク名・期限・担当が同じもの1件から完了日時を取り出す(使った分は候補から外す)
function takePriorDoneAt(pool: DealTaskRow[], task: ParsedTask): Date | null {
  const index = pool.findIndex(
    (p) =>
      p.title === task.title &&
      (p.dueDate ? jstDay(p.dueDate) : null) === task.dueDate &&
      (p.assigneeEmployeeNumber ?? null) === task.assignee,
  );
  if (index < 0) return null;
  return pool.splice(index, 1)[0].doneAt;
}

function throwErrors(errors: string[], heading: string): never {
  const shown = errors.slice(0, MAX_REPORTED_ERRORS);
  const rest = errors.length - shown.length;
  throw new BadRequestError(
    `${heading}(${errors.length}件)\n${shown.join("\n")}${rest > 0 ? `\n...ほか${rest}件` : ""}`,
  );
}

// CSV文字列を検証しながら商談ごとのグループにまとめる(DBは参照しない純粋な処理)
export function parseDealsCsv(text: string): ParsedDealGroup[] {
  let rows: CsvRecord[];
  try {
    rows = parseCsvRecords(text);
  } catch (err) {
    throw new BadRequestError(err instanceof Error ? err.message : "CSVを読み取れませんでした");
  }
  if (rows.length === 0 || rows[0].fields.join(",") !== DEALS_CSV_HEADERS.join(",")) {
    throw new BadRequestError(`CSVヘッダー書式が正しくありません(期待: ${DEALS_CSV_HEADERS.join(",")})`);
  }
  const dataRows = rows.slice(1);
  if (dataRows.length === 0) throw new BadRequestError("取り込むデータ行がありません");
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new BadRequestError(`1回に取り込める行数は${MAX_IMPORT_ROWS}行までです(${dataRows.length}行)`);
  }

  const errors: string[] = [];
  const groups = new Map<string, ParsedDealGroup>();
  // 同じgroupKeyの各行でDBの商談本体の値が食い違わないよう、先頭行の正規化済みの値を保持する
  const firstValues = new Map<string, Partial<Record<DealLevelColumn, string>>>();

  dataRows.forEach((record) => {
    // 引用符内の改行(複数行のメモ)があっても、レコードが始まる物理行番号で報告する
    const columns = record.fields;
    const line = record.line;
    const cell = (name: (typeof DEALS_CSV_HEADERS)[number]) =>
      (columns[DEALS_CSV_HEADERS.indexOf(name)] ?? "").trim();
    const fail = (message: string) => errors.push(`${line}行目: ${message}`);
    if (columns.length > DEALS_CSV_HEADERS.length) fail("列数がヘッダーより多くなっています");

    const groupKey = cell("groupKey");
    if (!groupKey) return fail("groupKey(同じ商談の行をまとめるキー)は必須です");

    // --- 商談本体の項目(正規化して比較する) ---
    const dealLevel: Partial<Record<DealLevelColumn, string>> = {};
    for (const name of DEAL_LEVEL_COLUMNS) dealLevel[name] = cell(name);
    if (dealLevel.dealDate) {
      const normalized = normalizeDate(dealLevel.dealDate);
      if (!normalized) fail("dealDateはYYYY-MM-DD形式の実在する日付で指定してください");
      else dealLevel.dealDate = normalized;
    }
    for (const name of ["startTime", "endTime"] as const) {
      const raw = dealLevel[name];
      if (!raw) continue;
      const normalized = normalizeTime(raw);
      if (!normalized) fail(`${name}はHH:MM形式で指定してください`);
      else dealLevel[name] = normalized;
    }
    if (dealLevel.status && !(DEAL_STATUSES as readonly string[]).includes(dealLevel.status)) {
      fail(`statusは${DEAL_STATUSES.join(" / ")}のいずれかを指定してください(空欄は新規=OPEN・更新=現状維持)`);
    }

    let group = groups.get(groupKey);
    if (!group) {
      // 先頭行: 必須項目と長さの検証
      if (!dealLevel.partnerId) fail("partnerId(取引先)は必須です");
      if (!dealLevel.title) fail("title(商談名)は必須です");
      else if (dealLevel.title.length > 200) fail("titleは200文字以内で指定してください");
      if (!dealLevel.dealDate) fail("dealDate(商談日)は必須です");
      if ((dealLevel.location ?? "").length > 200) fail("locationは200文字以内で指定してください");
      if ((dealLevel.memo ?? "").length > 10000) fail("memoは10000文字以内で指定してください");
      if (dealLevel.startTime && dealLevel.endTime && dealLevel.endTime < dealLevel.startTime) {
        fail("endTimeはstartTimeより後にしてください");
      }
      group = {
        groupKey,
        line,
        dealId: dealLevel.dealId || null,
        partnerId: dealLevel.partnerId ?? "",
        title: dealLevel.title ?? "",
        dealDate: dealLevel.dealDate ?? "",
        startTime: dealLevel.startTime || null,
        endTime: dealLevel.endTime || null,
        location: dealLevel.location || null,
        memo: dealLevel.memo || null,
        status: (dealLevel.status || null) as DealStatus | null,
        ownerEmployeeNumber: dealLevel.ownerEmployeeNumber || null,
        quoteIds: [...new Set((dealLevel.quoteIds ?? "").split(/\s+/).filter(Boolean))],
        attendees: [],
        tasks: [],
      };
      groups.set(groupKey, group);
      firstValues.set(groupKey, dealLevel);
    } else {
      // 2行目以降: 商談本体の項目は空欄か先頭行と同じ値のみ可(黙って食い違わせない)
      const first = firstValues.get(groupKey) ?? {};
      for (const name of DEAL_LEVEL_COLUMNS) {
        const value = dealLevel[name] ?? "";
        if (value && value !== (first[name] ?? "")) {
          fail(`groupKey「${groupKey}」の${name}が先頭行(${group.line}行目)と異なります。2行目以降は空欄にするか同じ値にしてください`);
        }
      }
    }

    // --- 面談者(1行に1件まで) ---
    const attendeeKind = cell("attendeeKind");
    const attendeeValue = cell("attendeeValue");
    const attendeeNote = cell("attendeeNote");
    if (attendeeKind || attendeeValue || attendeeNote) {
      if (!(ATTENDEE_KINDS as readonly string[]).includes(attendeeKind)) {
        fail(`attendeeKindは${ATTENDEE_KINDS.join(" / ")}のいずれかを指定してください`);
      } else if (!attendeeValue) {
        fail("attendeeValue(従業員番号または氏名)は必須です");
      } else if (attendeeNote.length > 200) {
        fail("attendeeNoteは200文字以内で指定してください");
      } else {
        group.attendees.push({
          kind: attendeeKind as AttendeeKind,
          value: attendeeValue,
          note: attendeeNote || null,
          line,
        });
      }
    }

    // --- 次回までのタスク(1行に1件まで) ---
    const taskTitle = cell("taskTitle");
    const taskDueRaw = cell("taskDueDate");
    const taskAssignee = cell("taskAssigneeEmployeeNumber");
    const taskDoneRaw = cell("taskIsDone").toLowerCase();
    if (taskTitle || taskDueRaw || taskAssignee || taskDoneRaw) {
      const dueDate = taskDueRaw ? normalizeDate(taskDueRaw) : null;
      if (!taskTitle) fail("taskTitle(タスク名)は必須です");
      else if (taskTitle.length > 200) fail("taskTitleは200文字以内で指定してください");
      else if (taskDueRaw && !dueDate) fail("taskDueDateはYYYY-MM-DD形式の実在する日付で指定してください");
      else if (!DONE_TRUE.has(taskDoneRaw) && !DONE_FALSE.has(taskDoneRaw)) {
        fail("taskIsDoneは 1/0・true/false・完了/未完了 のいずれかで指定してください");
      } else {
        group.tasks.push({
          title: taskTitle,
          dueDate,
          assignee: taskAssignee || null,
          isDone: DONE_TRUE.has(taskDoneRaw),
        });
      }
    }
  });

  if (errors.length > 0) throwErrors(errors, "CSVに不正な行があります。修正して再度取り込んでください");
  if (groups.size > MAX_IMPORT_DEALS) {
    throw new BadRequestError(`1回に取り込める商談数は${MAX_IMPORT_DEALS}件までです(${groups.size}件)`);
  }
  return [...groups.values()];
}

export class DealsCsvImportService {
  private repo: DealsRepository;

  constructor(repo: DealsRepository) {
    this.repo = repo;
  }

  async importCsv(c: Context<{ Bindings: Env }>, file: File) {
    const groups = parseDealsCsv(await file.text());
    const errors: string[] = [];
    const fail = (group: ParsedDealGroup, message: string) =>
      errors.push(`商談「${group.groupKey}」(${group.line}行目〜): ${message}`);

    // --- 参照先をまとめて取得(無料プランのクエリ数を抑えるため、商談ごとには引かない) ---
    const partnerIds = groups.map((g) => g.partnerId);
    const employeeNumbers = groups.flatMap((g) => [
      g.ownerEmployeeNumber,
      ...g.tasks.map((t) => t.assignee),
      ...g.attendees.filter((a) => a.kind === "EMPLOYEE").map((a) => a.value),
    ]).filter((n): n is string => !!n);
    const quoteIds = groups.flatMap((g) => g.quoteIds);
    const dealIds = groups.map((g) => g.dealId).filter((id): id is string => !!id);
    const needsProspectContacts = groups.some((g) => g.attendees.some((a) => a.kind === "PROSPECT_CONTACT"));
    const needsPartnerContacts = groups.some((g) => g.attendees.some((a) => a.kind === "PARTNER_CONTACT"));

    const [partnerNames, userNames, quotes, existingDeals, existingTasks, prospectContacts, partnerContacts] = await Promise.all([
      this.repo.findPartnerNames(partnerIds),
      this.repo.findUserNames(employeeNumbers),
      this.repo.findQuotesByIds(quoteIds),
      this.repo.findDealsByIds(dealIds),
      // 更新する商談の完了済みタスク(同じタスクの完了日時を再取込で失わないよう引き継ぐ)
      this.repo.findTasks(dealIds),
      needsProspectContacts ? this.repo.findProspectContactsByPartnerIds(partnerIds) : Promise.resolve([]),
      needsPartnerContacts ? this.repo.findPartnerContactsByPartnerIds(partnerIds) : Promise.resolve([]),
    ]);
    const existingById = new Map(existingDeals.map((d) => [d.id, d]));
    const quoteById = new Map(quotes.map((q) => [q.id, q]));

    const seenDealIds = new Set<string>();
    const resolved = groups.map((group) => {
      if (!partnerNames.has(group.partnerId)) fail(group, `取引先[${group.partnerId}]が見つかりません`);
      if (group.dealId) {
        if (seenDealIds.has(group.dealId)) fail(group, `dealId[${group.dealId}]がCSV内で重複しています`);
        seenDealIds.add(group.dealId);
        if (!existingById.has(group.dealId)) fail(group, `dealId[${group.dealId}]の商談が見つかりません(新規登録はdealIdを空欄にしてください)`);
      }
      for (const n of new Set([group.ownerEmployeeNumber, ...group.tasks.map((t) => t.assignee)])) {
        if (n && !userNames.has(n)) fail(group, `ユーザー[${n}]が見つかりません`);
      }
      for (const quoteId of group.quoteIds) {
        const quote = quoteById.get(quoteId);
        if (!quote) fail(group, `見積[${quoteId}]が見つかりません`);
        else if (quote.partnerId !== group.partnerId) fail(group, `見積[${quoteId}]は別の取引先の見積のため紐づけできません`);
      }

      const attendees = group.attendees.map((a, index) => {
        const base = { kind: a.kind, sortOrder: index };
        switch (a.kind) {
          case "FREE":
            return { ...base, refId: null, name: a.value, note: a.note };
          case "EMPLOYEE": {
            if (!userNames.has(a.value)) fail(group, `${a.line}行目: ユーザー[${a.value}]が見つかりません`);
            return { ...base, refId: a.value, name: userNames.get(a.value) ?? a.value, note: a.note };
          }
          case "PROSPECT_CONTACT": {
            const inPartner = prospectContacts.filter((p) => p.partnerId === group.partnerId);
            // 出力CSVは、氏名で一意に特定できない担当者を担当者IDで書く。IDに一致すればそれを優先する
            const matches = inPartner.some((p) => p.id === a.value)
              ? inPartner.filter((p) => p.id === a.value)
              : inPartner.filter((p) => p.name === a.value);
            if (matches.length !== 1) {
              fail(group, `${a.line}行目: 見込客担当者「${a.value}」が${matches.length === 0 ? "見つかりません(先に見込客担当者を登録してください)" : "複数あり特定できません"}`);
              return { ...base, refId: null, name: a.value, note: a.note };
            }
            const p = matches[0];
            const defaultNote = [p.departmentName, p.position].filter(Boolean).join(" ");
            return { ...base, refId: p.id, name: p.name, note: a.note || defaultNote || null };
          }
          case "PARTNER_CONTACT": {
            const inPartner = partnerContacts.filter((p) => p.partnerId === group.partnerId);
            const matches = inPartner.some((p) => p.id === a.value)
              ? inPartner.filter((p) => p.id === a.value)
              : inPartner.filter((p) => p.name === a.value);
            if (matches.length !== 1) {
              fail(group, `${a.line}行目: 取引先担当者「${a.value}」が${matches.length === 0 ? "見つかりません" : "複数あり特定できません"}`);
              return { ...base, refId: null, name: a.value, note: a.note };
            }
            const p = matches[0];
            return { ...base, refId: p.id, name: p.name ?? "(氏名未登録)", note: a.note || p.departmentName || null };
          }
        }
      });
      return { group, attendees };
    });
    if (errors.length > 0) throwErrors(errors, "CSVの内容に不正があるため、1件も取り込んでいません");

    // --- 1回のWorker呼び出しで使えるD1クエリ数(無料プランは50本、batch内の各文も1本)に収まるか ---
    const writeStatements = estimateWriteStatements({
      deals: groups.length,
      updates: groups.filter((g) => g.dealId).length,
      attendees: resolved.reduce((n, r) => n + r.attendees.length, 0),
      tasks: groups.reduce((n, g) => n + g.tasks.length, 0),
      quotes: groups.reduce((n, g) => n + g.quoteIds.length, 0),
    });
    if (writeStatements > MAX_WRITE_STATEMENTS) {
      throw new BadRequestError(
        `1回に取り込める量を超えています(書き込み${writeStatements}件相当・上限${MAX_WRITE_STATEMENTS})。CSVを分けて取り込んでください`,
      );
    }

    // --- 新規商談の番号をまとめて採番(1ラウンド1クエリ。衝突分だけ末尾に-1,-2...を付けて再試行) ---
    const newCount = groups.filter((g) => !g.dealId).length;
    const newIds = await this.allocateDealIds(c, newCount);
    const operator = await this.repo.getOperatorEmployeeNumber(c);
    const now = new Date();

    const doneTasksByDeal = new Map<string, typeof existingTasks>();
    for (const t of existingTasks.filter((t) => t.isDone)) {
      doneTasksByDeal.set(t.dealId, [...(doneTasksByDeal.get(t.dealId) ?? []), t]);
    }
    let newIdIndex = 0;
    const ops: BulkDealOperation[] = resolved.map(({ group, attendees }) => {
      const id = group.dealId ?? newIds[newIdIndex++];
      const existing = group.dealId ? existingById.get(group.dealId) : undefined;
      const dealFields = {
        partnerId: group.partnerId,
        title: group.title,
        dealDate: jstDateToDate(group.dealDate),
        startTime: group.startTime,
        endTime: group.endTime,
        location: group.location,
        memo: group.memo,
        // 空欄: 新規はOPEN、更新は現状維持
        status: group.status ?? existing?.status ?? "OPEN",
        ownerEmployeeNumber: group.ownerEmployeeNumber,
        // 競合(更新)時に上書きされるのは上記の項目と更新者・更新日時のみ。作成者・作成日時は既存の値のまま
        createdBy: existing?.createdBy ?? operator,
        createdAt: existing?.createdAt ?? now,
        updatedBy: operator,
        updatedAt: now,
      };
      // 完了済みのタスクは、既存の同じタスク(タスク名・期限・担当が同じ)の完了日時を引き継ぐ
      const remainingDone = [...(doneTasksByDeal.get(id) ?? [])];
      const children = {
        attendees: attendees.map((a) => ({ ...a, id: crypto.randomUUID(), dealId: id })),
        tasks: group.tasks.map((t, index) => ({
          id: crypto.randomUUID(),
          dealId: id,
          title: t.title,
          dueDate: t.dueDate ? jstDateToDate(t.dueDate) : null,
          assigneeEmployeeNumber: t.assignee,
          isDone: t.isDone,
          doneAt: t.isDone ? (takePriorDoneAt(remainingDone, t) ?? now) : null,
          sortOrder: index,
        })),
        quotes: group.quoteIds.map((quoteId) => ({
          id: crypto.randomUUID(),
          dealId: id,
          quoteId,
          linkedBy: operator,
          linkedAt: now,
        })),
      };
      return { mode: existing ? ("update" as const) : ("insert" as const), deal: { id, ...dealFields }, ...children };
    });

    await this.repo.bulkSaveDeals(ops);

    const created = ops.filter((o) => o.mode === "insert").length;
    const updated = ops.length - created;
    c.executionCtx.waitUntil(
      logAuditEvent(c, "IMPORT_DEALS_CSV", RESOURCE_KEY, "BULK_IMPORT", null, {
        created,
        updated,
        dealIds: ops.map((o) => o.deal.id),
      }),
    );
    return {
      success: true,
      created,
      updated,
      message: `商談${ops.length}件を取り込みました(新規${created}件・更新${updated}件)`,
    };
  }

  // 会社設定の伝票番号ルール(種別deal)で、未使用の商談番号をcount件まとめて用意する
  private async allocateDealIds(c: Context<{ Bindings: Env }>, count: number): Promise<string[]> {
    if (count === 0) return [];
    const config = await getDocumentNumberFormatConfig(c, "deal");
    const ids: string[] = [];
    const used = new Set<string>();
    for (let round = 0; ids.length < count; round++) {
      if (round > 20) throw new Error("商談番号の採番に失敗しました");
      const candidates = Array.from({ length: count - ids.length }, () => {
        const id = generateFormattedCode(config);
        return round === 0 ? id : `${id}-${round}`;
      });
      const taken = new Set((await this.repo.findDealsByIds(candidates)).map((d) => d.id));
      for (const id of candidates) {
        if (!taken.has(id) && !used.has(id)) {
          used.add(id);
          ids.push(id);
        }
      }
    }
    return ids;
  }
}
