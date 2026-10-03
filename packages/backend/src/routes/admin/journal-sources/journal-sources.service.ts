import { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { resolveOperatorEmployeeNumber } from "../../../platform/repository/fallback-operator";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import {
  JOURNAL_SOURCE_DEFINITIONS,
  listUnpostedJournalSources,
  postJournalFromSource,
  prepareJournalFromSource,
} from "../../../platform/journal/journal-sources";
import { pairJournalLines } from "../../../platform/journal/pair-journal-lines";
import { listAdvanceBalances } from "../../../platform/journal/advance-balances";
import {
  postPurchaseRecognitionJournal,
  postSalesInvoiceJournal,
  preparePurchaseRecognitionJournal,
  prepareSalesInvoiceJournal,
} from "./document-posting";
import type { ListJournalSourcesQueryInput, PostJournalSourceInput } from "./journal-sources.schema";

const RESOURCE_KEY = "accounting_journal";

// V-4: 伝票を選んで仕訳を作る。未転記の一覧と、1件ずつの仕訳作成(1リクエスト=1件)
export class JournalSourcesService {
  constructor(private c: Context<{ Bindings: Env }>) {}

  async listUnposted(query: ListJournalSourcesQueryInput) {
    const rows = await listUnpostedJournalSources(this.c.env.DB, query.kind, query);
    return rows.map((r) => ({ ...r, kindLabel: JOURNAL_SOURCE_DEFINITIONS[r.kind].label }));
  }

  // 売上の前受金として充当できる単体入金(前受金として仕訳済みで、未充当残があるもの)
  async listAdvanceCandidates(partnerId: string) {
    const balances = await listAdvanceBalances(this.c.env.DB, { partnerId });
    return balances.filter((b) => b.remainingAmount > 0);
  }

  // 仕訳にする前に、借方・貸方の組を確認する(保存はしない)
  async preview(body: PostJournalSourceInput) {
    if (body.advanceApplications?.length && body.kind !== "sales_invoice") {
      throw new BadRequestError("前受金の充当を指定できるのは売上だけです");
    }
    const common = { db: this.c.env.DB, sourceRefId: body.sourceRefId, companySettings: this.c.env.COMPANY_SETTINGS };
    const prepared =
      body.kind === "sales_invoice"
        ? await prepareSalesInvoiceJournal({ ...common, advanceApplications: body.advanceApplications })
        : body.kind === "purchase_recognition"
          ? await preparePurchaseRecognitionJournal(common)
          : await prepareJournalFromSource({ ...common, kind: body.kind });
    if (!prepared.ok) {
      if (prepared.status === 404) throw new NotFoundError(prepared.message);
      throw new BadRequestError(prepared.message);
    }
    const { draft } = prepared;
    return {
      description: draft.description,
      entryDate: draft.entryDate,
      pairs: pairJournalLines(draft.lines),
    };
  }

  async post(body: PostJournalSourceInput) {
    const db = drizzle(this.c.env.DB, { schema });
    const performedById = await resolveOperatorEmployeeNumber(this.c, db);

    const common = {
      db: this.c.env.DB,
      dbJournal: this.c.env.DB_JOURNAL,
      companySettings: this.c.env.COMPANY_SETTINGS,
      sourceRefId: body.sourceRefId,
      performedById,
    };
    if (body.advanceApplications?.length && body.kind !== "sales_invoice") {
      throw new BadRequestError("前受金の充当を指定できるのは売上だけです");
    }
    const outcome =
      body.kind === "sales_invoice"
        ? await postSalesInvoiceJournal({ ...common, advanceApplications: body.advanceApplications })
        : body.kind === "purchase_recognition"
          ? await postPurchaseRecognitionJournal(common)
          : await postJournalFromSource({ ...common, kind: body.kind });
    if (!outcome.ok) {
      if (outcome.status === 404) throw new NotFoundError(outcome.message);
      throw new BadRequestError(outcome.message);
    }

    const { result } = outcome;
    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "POST_JOURNAL_FROM_SOURCE", RESOURCE_KEY, body.sourceRefId, null, {
        kind: body.kind,
        status: result.status,
        batchId: result.batchId,
      }),
    );

    if (result.status === "FAILED") {
      return { success: false, status: result.status, message: `仕訳の転記に失敗しました: ${result.errorMessage || "不明なエラー"}` };
    }
    if (result.status === "ALREADY_POSTED") {
      return { success: true, status: result.status, message: "この伝票は既に仕訳になっています" };
    }
    return { success: true, status: result.status, batchId: result.batchId, message: "仕訳を作成しました" };
  }
}
