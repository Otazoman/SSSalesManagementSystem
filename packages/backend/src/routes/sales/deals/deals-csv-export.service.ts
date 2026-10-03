import type { Context } from "hono";
import type { Env } from "../../../types/env";
import { DealsRepository } from "./deals.repository";
import type { SearchDealsQuery } from "./deals.schema";
import { RESOURCE_KEY } from "./deals.service";
import { DEALS_CSV_HEADERS } from "./deals-csv-import.service";
import { MAX_WRITE_STATEMENTS, estimateWriteStatements } from "./deals-batch-budget";
import { CRLF, csvField, withBom } from "../../../platform/csv/csv-writer";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { formatJstDate } from "../../../platform/date/format-jst-date";

// 出力の対象にする商談数の上限(検索条件に一致するものを新しい順に取得する)
const EXPORT_FETCH_LIMIT = 300;

const jstDate = formatJstDate;

export interface DealsCsvExportResult {
  csv: string;
  /** 検索条件に一致した商談数(上限300件まで) */
  total: number;
  /** 実際にCSVへ出力した商談数(取込の書き込み上限に収まる範囲) */
  included: number;
}

// 商談CSVの出力。**インポートと同じ形式**(deals-csv-import.service.ts)で出すため、出力したファイルを
// そのまま(編集して)再取込できる。dealIdとgroupKeyに商談番号を入れるので、再取込は同じ商談の更新になる。
// 取込は1回の書き込み文数に上限があるため(deals-batch-budget.ts)、出力もその範囲に収まる先頭の商談までとし、
// 超える場合は呼び出し側が件数の差で警告できるよう total / included を返す
export class DealsCsvExportService {
  private repo: DealsRepository;

  constructor(repo: DealsRepository) {
    this.repo = repo;
  }

  async exportCsv(c: Context<{ Bindings: Env }>, query: SearchDealsQuery): Promise<DealsCsvExportResult> {
    const matched = await this.repo.findMany({ ...query, limit: String(EXPORT_FETCH_LIMIT) });
    const ids = matched.map((d) => d.id);
    const [allAttendees, allTasks, allQuoteLinks] = await Promise.all([
      this.repo.findAttendees(ids),
      this.repo.findTasks(ids),
      this.repo.findQuoteLinks(ids),
    ]);
    const by = <T extends { dealId: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) map.set(row.dealId, [...(map.get(row.dealId) ?? []), row]);
      return map;
    };
    const attendeesBy = by(allAttendees);
    const tasksBy = by(allTasks);
    const quotesBy = by(allQuoteLinks);

    // 取込の書き込み上限に収まる先頭の商談まで(全件を「既存商談の置き換え」として数える)
    const volume = { deals: 0, updates: 0, attendees: 0, tasks: 0, quotes: 0 };
    const deals = [];
    for (const deal of matched) {
      const next = {
        deals: volume.deals + 1,
        updates: volume.updates + 1,
        attendees: volume.attendees + (attendeesBy.get(deal.id)?.length ?? 0),
        tasks: volume.tasks + (tasksBy.get(deal.id)?.length ?? 0),
        quotes: volume.quotes + (quotesBy.get(deal.id)?.length ?? 0),
      };
      if (estimateWriteStatements(next) > MAX_WRITE_STATEMENTS && deals.length > 0) break;
      Object.assign(volume, next);
      deals.push(deal);
    }

    // 担当者は氏名で書く(読みやすい)。ただし氏名で一意に同じ担当者へ戻せない場合(改名・同姓同名)は担当者IDで書く
    const partnerIds = deals.map((d) => d.partnerId);
    const included = new Set(deals.map((d) => d.id));
    const includedAttendees = allAttendees.filter((a) => included.has(a.dealId));
    const [prospectContacts, partnerContacts] = await Promise.all([
      includedAttendees.some((a) => a.kind === "PROSPECT_CONTACT")
        ? this.repo.findProspectContactsByPartnerIds(partnerIds)
        : Promise.resolve([]),
      includedAttendees.some((a) => a.kind === "PARTNER_CONTACT")
        ? this.repo.findPartnerContactsByPartnerIds(partnerIds)
        : Promise.resolve([]),
    ]);
    const contactValue = (
      contacts: { id: string; partnerId: string; name: string | null }[],
      partnerId: string,
      attendee: { refId: string | null; name: string },
    ) => {
      const contact = contacts.find((p) => p.id === attendee.refId && p.partnerId === partnerId);
      if (!contact) return attendee.name;
      const sameName = contacts.filter((p) => p.partnerId === partnerId && p.name === contact.name);
      return sameName.length === 1 && contact.name === attendee.name ? attendee.name : contact.id;
    };

    const lines: string[] = [];
    for (const deal of deals) {
      const attendees = attendeesBy.get(deal.id) ?? [];
      const tasks = tasksBy.get(deal.id) ?? [];
      const quoteIds = (quotesBy.get(deal.id) ?? []).map((q) => q.quoteId).join(" ");
      const rowCount = Math.max(1, attendees.length, tasks.length);

      for (let i = 0; i < rowCount; i++) {
        const attendee = attendees[i];
        const task = tasks[i];
        const attendeeValue = !attendee
          ? ""
          : attendee.kind === "EMPLOYEE"
            ? (attendee.refId ?? attendee.name)
            : attendee.kind === "PROSPECT_CONTACT"
              ? contactValue(prospectContacts, deal.partnerId, attendee)
              : attendee.kind === "PARTNER_CONTACT"
                ? contactValue(partnerContacts, deal.partnerId, attendee)
                : attendee.name;
        // 商談本体の項目は先頭行にだけ書く(2行目以降は空欄)
        const first = i === 0;
        const cells: Record<(typeof DEALS_CSV_HEADERS)[number], string | number | null> = {
          groupKey: deal.id,
          dealId: first ? deal.id : "",
          partnerId: first ? deal.partnerId : "",
          title: first ? deal.title : "",
          dealDate: first ? jstDate(deal.dealDate) : "",
          startTime: first ? deal.startTime : "",
          endTime: first ? deal.endTime : "",
          location: first ? deal.location : "",
          memo: first ? deal.memo : "",
          status: first ? deal.status : "",
          ownerEmployeeNumber: first ? deal.ownerEmployeeNumber : "",
          quoteIds: first ? quoteIds : "",
          attendeeKind: attendee?.kind ?? "",
          attendeeValue,
          attendeeNote: attendee?.note ?? "",
          taskTitle: task?.title ?? "",
          taskDueDate: task?.dueDate ? jstDate(task.dueDate) : "",
          taskAssigneeEmployeeNumber: task?.assigneeEmployeeNumber ?? "",
          taskIsDone: task ? (task.isDone ? "1" : "0") : "",
        };
        lines.push(DEALS_CSV_HEADERS.map((h) => csvField(cells[h])).join(","));
      }
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_DEALS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
        recordCount: deals.length,
        matchedCount: matched.length,
      }),
    );
    return {
      csv: withBom([DEALS_CSV_HEADERS.join(","), ...lines].join(CRLF) + CRLF),
      total: matched.length,
      included: deals.length,
    };
  }
}
