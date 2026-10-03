import type { Context } from "hono";
import type { Env } from "../../../types/env";
import { buildPaginationMeta, parsePaginationParams } from "../../../platform/http/pagination";
import { DealsRepository, DealAttachmentRow, DealAttendeeRow, DealRow, DealTaskRow } from "./deals.repository";
import type {
  AttendeeInput,
  ProspectContactInput,
  RegisterDealPayload,
  OpenTasksQuery,
  SearchDealsQuery,
  TaskInput,
  UpdateDealPayload,
} from "./deals.schema";
import { resolveConfiguredDocumentId } from "../../../platform/id/resolve-document-id";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { formatJstDate } from "../../../platform/date/format-jst-date";

export const RESOURCE_KEY = "sales_deals";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const jstDate = formatJstDate;
const parseJstDate = (s: string) => new Date(`${s}T00:00:00+09:00`);

// 追加要望M-1: 商談管理。見込み客(取引先マスタの種別PROSPECT)への営業活動の記録。
// 商談(日付・時間・場所・メモ)・面談者・次回までのタスク・添付(専用R2バケット)・見積の紐づけを持ち、
// 1見込み客に複数の商談を管理する。データは専用DB(DB_DEALS)に保存し、取引先・見積・社員は
// メインDBを参照する(DB跨ぎのFKは張らないため、存在確認はここで行う)
export class DealsService {
  private repo: DealsRepository;

  constructor(repo: DealsRepository) {
    this.repo = repo;
  }

  // ---------- 参照 ----------
  async list(query: SearchDealsQuery) {
    // BUG-032: page を指定した場合は、他の一覧と同じく {data, pagination} で返す
    if (query.page) {
      const pagination = parsePaginationParams({ page: query.page, limit: query.limit });
      const { rows, total } = await this.repo.findPage(query, pagination);
      return { data: await this.toSummaries(rows), pagination: buildPaginationMeta(pagination, total) };
    }
    const deals = await this.repo.findMany(query);
    return this.toSummaries(deals);
  }

  private async toSummaries(deals: DealRow[]) {
    const ids = deals.map((d) => d.id);
    const [attendees, tasks, attachments, quoteLinks, partnerNames, userNames] = await Promise.all([
      this.repo.findAttendees(ids),
      this.repo.findTasks(ids),
      this.repo.findAttachments(ids),
      this.repo.findQuoteLinks(ids),
      this.repo.findPartnerNames(deals.map((d) => d.partnerId)),
      this.repo.findUserNames(deals.map((d) => d.ownerEmployeeNumber).filter((n): n is string => !!n)),
    ]);
    const by = <T extends { dealId: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) map.set(row.dealId, [...(map.get(row.dealId) ?? []), row]);
      return map;
    };
    const attendeesBy = by(attendees);
    const tasksBy = by(tasks);
    const attachmentsBy = by(attachments);
    const quotesBy = by(quoteLinks);

    return deals.map((d) => {
      const dealTasks = tasksBy.get(d.id) ?? [];
      return {
        id: d.id,
        partnerId: d.partnerId,
        partnerName: partnerNames.get(d.partnerId) ?? null,
        title: d.title,
        dealDate: jstDate(d.dealDate),
        startTime: d.startTime,
        endTime: d.endTime,
        location: d.location,
        status: d.status,
        ownerEmployeeNumber: d.ownerEmployeeNumber,
        ownerName: d.ownerEmployeeNumber ? (userNames.get(d.ownerEmployeeNumber) ?? d.ownerEmployeeNumber) : null,
        attendeeNames: (attendeesBy.get(d.id) ?? []).map((a) => a.name),
        taskCount: dealTasks.length,
        openTaskCount: dealTasks.filter((t) => !t.isDone).length,
        attachmentCount: (attachmentsBy.get(d.id) ?? []).length,
        quoteIds: (quotesBy.get(d.id) ?? []).map((q) => q.quoteId),
      };
    });
  }

  async getById(id: string) {
    const deal = await this.repo.findById(id);
    if (!deal) throw new NotFoundError("対象の商談が見つかりません");
    const [attendees, tasks, attachments, quoteLinks] = await Promise.all([
      this.repo.findAttendees([id]),
      this.repo.findTasks([id]),
      this.repo.findAttachments([id]),
      this.repo.findQuoteLinks([id]),
    ]);
    const [partnerNames, userNames, quotes] = await Promise.all([
      this.repo.findPartnerNames([deal.partnerId]),
      this.repo.findUserNames(
        [deal.ownerEmployeeNumber, ...tasks.map((t) => t.assigneeEmployeeNumber)].filter((n): n is string => !!n),
      ),
      this.repo.findQuotesByIds(quoteLinks.map((q) => q.quoteId)),
    ]);
    const nameOf = (n: string | null) => (n ? (userNames.get(n) ?? n) : null);
    return {
      id: deal.id,
      partnerId: deal.partnerId,
      partnerName: partnerNames.get(deal.partnerId) ?? null,
      title: deal.title,
      dealDate: jstDate(deal.dealDate),
      startTime: deal.startTime,
      endTime: deal.endTime,
      location: deal.location,
      memo: deal.memo,
      status: deal.status,
      ownerEmployeeNumber: deal.ownerEmployeeNumber,
      ownerName: nameOf(deal.ownerEmployeeNumber),
      attendees: attendees.map((a) => ({ id: a.id, kind: a.kind, refId: a.refId, name: a.name, note: a.note })),
      tasks: tasks.map((t) => this.toTaskView(t, nameOf(t.assigneeEmployeeNumber))),
      attachments: attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        fileType: a.fileType,
        uploadedAt: a.uploadedAt.toISOString(),
      })),
      quotes: quotes.map((q) => ({
        id: q.id,
        title: q.title,
        status: q.status,
        quoteDate: q.quoteDate ? jstDate(q.quoteDate) : null,
        totalAmount: q.totalAmount,
      })),
      createdBy: deal.createdBy,
      createdAt: deal.createdAt.toISOString(),
      updatedBy: deal.updatedBy,
      updatedAt: deal.updatedAt.toISOString(),
    };
  }

  private toTaskView(t: DealTaskRow, assigneeName: string | null) {
    return {
      id: t.id,
      title: t.title,
      dueDate: t.dueDate ? jstDate(t.dueDate) : null,
      assigneeEmployeeNumber: t.assigneeEmployeeNumber,
      assigneeName,
      isDone: t.isDone,
      doneAt: t.doneAt ? t.doneAt.toISOString() : null,
    };
  }

  // 未完了タスクの一覧(「次回までのタスク」の消し込み漏れ確認用)。期限の早い順
  async listOpenTasks(filters: OpenTasksQuery = {}) {
    const tasks = await this.repo.findOpenTasks(filters);
    const deals = await this.repo.findDealsByIds(tasks.map((t) => t.dealId));
    const dealById = new Map(deals.map((d) => [d.id, d]));
    const [partnerNames, userNames] = await Promise.all([
      this.repo.findPartnerNames(deals.map((d) => d.partnerId)),
      this.repo.findUserNames(tasks.map((t) => t.assigneeEmployeeNumber).filter((n): n is string => !!n)),
    ]);
    return tasks.map((t) => {
      const deal = dealById.get(t.dealId);
      const assigneeName = t.assigneeEmployeeNumber ? (userNames.get(t.assigneeEmployeeNumber) ?? t.assigneeEmployeeNumber) : null;
      return {
        ...this.toTaskView(t, assigneeName),
        dealId: t.dealId,
        dealTitle: deal?.title ?? null,
        partnerId: deal?.partnerId ?? null,
        partnerName: deal ? (partnerNames.get(deal.partnerId) ?? null) : null,
      };
    });
  }

  // 商談に紐づけられる見積の候補(同じ取引先の見積)
  async listQuoteCandidates(partnerId: string) {
    const quotes = await this.repo.findQuotesByPartner(partnerId);
    return quotes.map((q) => ({
      id: q.id,
      title: q.title,
      status: q.status,
      quoteDate: q.quoteDate ? jstDate(q.quoteDate) : null,
      totalAmount: q.totalAmount,
    }));
  }

  // 面談者として選べる相手(取引先担当者マスタ+見込客担当者)
  async listAttendeeCandidates(partnerId: string) {
    const [partnerContacts, prospectContacts] = await Promise.all([
      this.repo.findPartnerContactsByPartner(partnerId),
      this.repo.findProspectContacts(partnerId),
    ]);
    return {
      partnerContacts: partnerContacts.map((c) => ({ id: c.id, name: c.name ?? "(氏名未登録)", departmentName: c.departmentName })),
      prospectContacts,
    };
  }

  // ---------- 登録・更新 ----------
  async register(c: Context<{ Bindings: Env }>, body: RegisterDealPayload) {
    const prepared = await this.prepare(body, null);
    const operator = await this.repo.getOperatorEmployeeNumber(c);
    const id = await resolveConfiguredDocumentId(c, "deal", (candidate) => this.repo.existsId(candidate), null);
    const now = new Date();
    await this.repo.insertDeal(
      {
        id,
        ...prepared.deal,
        createdBy: operator,
        createdAt: now,
        updatedBy: operator,
        updatedAt: now,
      },
      prepared.attendees.map((a) => ({ ...a, id: crypto.randomUUID(), dealId: id })),
      prepared.tasks.map((t) => ({ ...t, dealId: id })),
      prepared.quoteIds.map((quoteId) => ({
        id: crypto.randomUUID(),
        dealId: id,
        quoteId,
        linkedBy: operator,
        linkedAt: now,
      })),
    );
    c.executionCtx.waitUntil(logAuditEvent(c, "CREATE_DEAL", RESOURCE_KEY, id, null, { ...body, id }));
    return { success: true, id, message: "商談を登録しました" };
  }

  // 全項目の置き換え(面談者・タスク・見積紐づけは指定した内容が最終状態になる)
  async update(c: Context<{ Bindings: Env }>, id: string, body: UpdateDealPayload) {
    const before = await this.getById(id);
    const existingTasks = new Map(before.tasks.map((t) => [t.id, t]));
    const prepared = await this.prepare(body, existingTasks);
    const operator = await this.repo.getOperatorEmployeeNumber(c);
    const now = new Date();
    await this.repo.updateDeal(
      id,
      { ...prepared.deal, updatedBy: operator, updatedAt: now },
      prepared.attendees.map((a) => ({ ...a, id: crypto.randomUUID(), dealId: id })),
      prepared.tasks.map((t) => ({ ...t, dealId: id })),
      prepared.quoteIds.map((quoteId) => ({
        id: crypto.randomUUID(),
        dealId: id,
        quoteId,
        linkedBy: operator,
        linkedAt: now,
      })),
    );
    c.executionCtx.waitUntil(logAuditEvent(c, "UPDATE_DEAL", RESOURCE_KEY, id, before, body));
    return { success: true, id, message: "商談を更新しました" };
  }

  // 入力の検証と、参照先(取引先・社員・見込客担当者・取引先担当者・見積)の解決
  private async prepare(body: RegisterDealPayload, existingTasks: Map<string, { doneAt: string | null; isDone: boolean }> | null) {
    if (!(await this.repo.partnerExists(body.partnerId))) {
      throw new BadRequestError(`取引先[${body.partnerId}]が見つかりません`);
    }
    if (body.startTime && body.endTime && body.endTime < body.startTime) {
      throw new BadRequestError("終了時刻は開始時刻より後にしてください");
    }
    const tasks = body.tasks ?? [];
    const employeeNumbers = [
      body.ownerEmployeeNumber,
      ...tasks.map((t) => t.assigneeEmployeeNumber),
      ...(body.attendees ?? []).filter((a) => a.kind === "EMPLOYEE").map((a) => a.refId),
    ].filter((n): n is string => !!n);
    const userNames = await this.repo.findUserNames(employeeNumbers);
    for (const n of new Set(employeeNumbers)) {
      if (!userNames.has(n)) throw new BadRequestError(`ユーザー[${n}]が見つかりません`);
    }

    const attendees = await this.resolveAttendees(body.partnerId, body.attendees ?? [], userNames);

    const quoteIds = [...new Set(body.quoteIds ?? [])];
    const quotes = await this.repo.findQuotesByIds(quoteIds);
    for (const quoteId of quoteIds) {
      const quote = quotes.find((q) => q.id === quoteId);
      if (!quote) throw new BadRequestError(`見積[${quoteId}]が見つかりません`);
      if (quote.partnerId !== body.partnerId) {
        throw new BadRequestError(`見積[${quoteId}]は別の取引先の見積のため紐づけできません`);
      }
    }

    const now = new Date();
    return {
      deal: {
        partnerId: body.partnerId,
        title: body.title.trim(),
        dealDate: parseJstDate(body.dealDate),
        startTime: body.startTime || null,
        endTime: body.endTime || null,
        location: body.location || null,
        memo: body.memo || null,
        status: body.status ?? "OPEN",
        ownerEmployeeNumber: body.ownerEmployeeNumber || null,
      },
      attendees,
      tasks: tasks.map((t, index) => this.toTaskRow(t, index, existingTasks, now)),
      quoteIds,
    };
  }

  private toTaskRow(
    t: TaskInput,
    index: number,
    existingTasks: Map<string, { doneAt: string | null; isDone: boolean }> | null,
    now: Date,
  ) {
    const prior = t.id && existingTasks ? existingTasks.get(t.id) : undefined;
    const isDone = t.isDone ?? prior?.isDone ?? false;
    // 既に完了していたタスクは完了日時を保持し、新たに完了にした場合のみ現在時刻を記録する
    const doneAt = !isDone ? null : prior?.isDone && prior.doneAt ? new Date(prior.doneAt) : now;
    return {
      id: prior && t.id ? t.id : crypto.randomUUID(),
      title: t.title.trim(),
      dueDate: t.dueDate ? parseJstDate(t.dueDate) : null,
      assigneeEmployeeNumber: t.assigneeEmployeeNumber || null,
      isDone,
      doneAt,
      sortOrder: index,
    };
  }

  private async resolveAttendees(partnerId: string, inputs: AttendeeInput[], userNames: Map<string, string>) {
    const prospectIds = inputs.filter((a) => a.kind === "PROSPECT_CONTACT" && a.refId).map((a) => a.refId as string);
    const partnerContactIds = inputs.filter((a) => a.kind === "PARTNER_CONTACT" && a.refId).map((a) => a.refId as string);
    const [prospectContacts, partnerContacts] = await Promise.all([
      this.repo.findProspectContactsByIds(prospectIds),
      this.repo.findPartnerContactsByIds(partnerContactIds),
    ]);

    return inputs.map((a, index) => {
      const base = { kind: a.kind, sortOrder: index };
      switch (a.kind) {
        case "FREE": {
          const name = a.name?.trim();
          if (!name) throw new BadRequestError("面談者(その他)は氏名を入力してください");
          return { ...base, refId: null, name, note: a.note || null };
        }
        case "EMPLOYEE": {
          if (!a.refId) throw new BadRequestError("自社の同席者はユーザーを選択してください");
          return { ...base, refId: a.refId, name: userNames.get(a.refId) ?? a.refId, note: a.note || null };
        }
        case "PROSPECT_CONTACT": {
          const contact = prospectContacts.find((p) => p.id === a.refId);
          if (!contact || contact.partnerId !== partnerId) {
            throw new BadRequestError("見込客担当者が見つからない、または別の取引先の担当者です");
          }
          const defaultNote = [contact.departmentName, contact.position].filter(Boolean).join(" ");
          return { ...base, refId: contact.id, name: contact.name, note: a.note || defaultNote || null };
        }
        case "PARTNER_CONTACT": {
          const contact = partnerContacts.find((p) => p.id === a.refId);
          if (!contact || contact.partnerId !== partnerId) {
            throw new BadRequestError("取引先担当者が見つからない、または別の取引先の担当者です");
          }
          return {
            ...base,
            refId: contact.id,
            name: contact.name ?? "(氏名未登録)",
            note: a.note || contact.departmentName || null,
          };
        }
      }
    });
  }

  // ---------- タスク ----------
  async setTaskDone(c: Context<{ Bindings: Env }>, dealId: string, taskId: string, isDone: boolean) {
    const task = await this.repo.findTask(dealId, taskId);
    if (!task) throw new NotFoundError("対象のタスクが見つかりません");
    if (task.isDone !== isDone) await this.repo.setTaskDone(taskId, isDone);
    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_DEAL_TASK", RESOURCE_KEY, dealId, { taskId, isDone: task.isDone }, { taskId, isDone }),
    );
    return { success: true, message: isDone ? "タスクを完了にしました" : "タスクを未完了に戻しました" };
  }

  // ---------- 削除 ----------
  async remove(c: Context<{ Bindings: Env }>, id: string) {
    const before = await this.getById(id);
    const attachments = await this.repo.findAttachments([id]);
    // R2の実体を先に削除する(DB削除後に失敗すると孤児ファイルが残るため)。R2は存在しないキーの削除も成功する
    for (const a of attachments) await c.env.DEALS_BUCKET.delete(a.attachmentR2Path);
    await this.repo.deleteDeal(id);
    c.executionCtx.waitUntil(logAuditEvent(c, "DELETE_DEAL", RESOURCE_KEY, id, before, null));
    return { success: true, message: "商談を削除しました" };
  }

  // ---------- 添付ファイル(専用バケット DEALS_BUCKET) ----------
  async uploadAttachment(c: Context<{ Bindings: Env }>, dealId: string, file: File) {
    if (!(await this.repo.existsId(dealId))) throw new NotFoundError("対象の商談が見つかりません");
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestError("ファイルサイズは20MB以下にしてください");
    }
    const key = generateAttachmentKey("deals", file.name);
    await c.env.DEALS_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });

    const operator = await this.repo.getOperatorEmployeeNumber(c);
    const id = crypto.randomUUID();
    try {
      await this.repo.insertAttachment({
        id,
        dealId,
        fileName: file.name,
        attachmentR2Path: key,
        fileType: file.type.startsWith("image/") ? "IMAGE" : file.type === "application/pdf" ? "PDF" : "OTHER",
        uploadedById: operator,
        uploadedAt: new Date(),
      });
    } catch (err) {
      await c.env.DEALS_BUCKET.delete(key);
      throw err;
    }
    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPLOAD_DEAL_ATTACHMENT", RESOURCE_KEY, dealId, null, { attachmentId: id, fileName: file.name }),
    );
    return { success: true, id, fileName: file.name, message: "ファイルを添付しました" };
  }

  async getAttachment(c: Context<{ Bindings: Env }>, dealId: string, attachmentId: string) {
    const attachment: DealAttachmentRow | null = await this.repo.findAttachment(dealId, attachmentId);
    if (!attachment) return null;
    const object = await c.env.DEALS_BUCKET.get(attachment.attachmentR2Path);
    if (!object) return null;
    const contentType = object.httpMetadata?.contentType || "application/octet-stream";
    const previewable = contentType.startsWith("image/") || contentType === "application/pdf";
    return {
      body: object.body,
      contentType,
      contentDisposition: previewable
        ? "inline"
        : `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    };
  }

  async removeAttachment(c: Context<{ Bindings: Env }>, dealId: string, attachmentId: string) {
    const attachment = await this.repo.findAttachment(dealId, attachmentId);
    if (!attachment) throw new NotFoundError("対象の添付ファイルが見つかりません");
    await c.env.DEALS_BUCKET.delete(attachment.attachmentR2Path);
    await this.repo.deleteAttachment(attachmentId);
    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_DEAL_ATTACHMENT", RESOURCE_KEY, dealId, { attachmentId, fileName: attachment.fileName }, null),
    );
    return { success: true, message: "添付ファイルを削除しました" };
  }

  // ---------- 見込客担当者 ----------
  listProspectContacts(partnerId?: string) {
    return this.repo.findProspectContacts(partnerId);
  }

  async createProspectContact(c: Context<{ Bindings: Env }>, body: ProspectContactInput) {
    if (!(await this.repo.partnerExists(body.partnerId))) {
      throw new BadRequestError(`取引先[${body.partnerId}]が見つかりません`);
    }
    const operator = await this.repo.getOperatorEmployeeNumber(c);
    const now = new Date();
    const id = crypto.randomUUID();
    await this.repo.insertProspectContact({
      id,
      partnerId: body.partnerId,
      name: body.name.trim(),
      departmentName: body.departmentName || null,
      position: body.position || null,
      email: body.email || null,
      phone: body.phone || null,
      memo: body.memo || null,
      createdBy: operator,
      createdAt: now,
      updatedBy: operator,
      updatedAt: now,
    });
    c.executionCtx.waitUntil(logAuditEvent(c, "CREATE_PROSPECT_CONTACT", RESOURCE_KEY, id, null, body));
    return { success: true, id, message: "見込客担当者を登録しました" };
  }

  async updateProspectContact(c: Context<{ Bindings: Env }>, id: string, body: ProspectContactInput) {
    const before = await this.repo.findProspectContact(id);
    if (!before) throw new NotFoundError("対象の見込客担当者が見つかりません");
    // 商談の面談者から参照されている可能性があるため、所属する取引先は変更させない
    if (before.partnerId !== body.partnerId) {
      throw new BadRequestError("見込客担当者の取引先は変更できません");
    }
    const operator = await this.repo.getOperatorEmployeeNumber(c);
    await this.repo.updateProspectContact(id, {
      name: body.name.trim(),
      departmentName: body.departmentName || null,
      position: body.position || null,
      email: body.email || null,
      phone: body.phone || null,
      memo: body.memo || null,
      updatedBy: operator,
      updatedAt: new Date(),
    });
    c.executionCtx.waitUntil(logAuditEvent(c, "UPDATE_PROSPECT_CONTACT", RESOURCE_KEY, id, before, body));
    return { success: true, id, message: "見込客担当者を更新しました" };
  }

  // 面談者の氏名はスナップショットで商談に保存済みのため、担当者を削除しても過去の商談記録は読める
  async removeProspectContact(c: Context<{ Bindings: Env }>, id: string) {
    const before = await this.repo.findProspectContact(id);
    if (!before) throw new NotFoundError("対象の見込客担当者が見つかりません");
    await this.repo.deleteProspectContact(id);
    c.executionCtx.waitUntil(logAuditEvent(c, "DELETE_PROSPECT_CONTACT", RESOURCE_KEY, id, before, null));
    return { success: true, message: "見込客担当者を削除しました" };
  }
}
