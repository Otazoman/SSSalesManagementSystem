import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { DealsRepository } from "./deals.repository";
import { DealsService } from "./deals.service";
import {
  OpenTasksQuerySchema,
  ProspectContactInputSchema,
  QuoteCandidatesQuerySchema,
  RegisterDealSchema,
  SearchDealsQuerySchema,
  SearchProspectContactsQuerySchema,
  SetTaskDoneSchema,
  UpdateDealSchema,
} from "./deals.schema";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import {
  describeApiRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../../platform/openapi/describe-route";
import { DealsCsvImportService } from "./deals-csv-import.service";
import { DealsCsvExportService } from "./deals-csv-export.service";
import { todayJst } from "../../../platform/date/format-jst-date";

const dealsRouter = new Hono<{ Bindings: Env }>();

dealsRouter.onError((err, c) => respondError(c, err));

const getService = (c: any) => new DealsService(new DealsRepository(c.env.DB_DEALS, c.env.DB));

const TAGS = ["sales-deals"];

// ==========================================
// 追加要望M-1: 商談管理(見込み客への営業活動の記録)。データは専用DB(DB_DEALS)
// 固定パス(/tasks, /prospect-contacts 等)は /:id より前に定義する
// ==========================================
dealsRouter.get(
  "/",
  describeApiRoute({
    summary: "商談の一覧(取引先・状態・期間・キーワード・未完了タスクで絞り込み。新しい順)",
    tags: TAGS,
    query: SearchDealsQuerySchema,
    responses: { 200: { description: "商談の配列(面談者名・未完了タスク数・添付数・紐づけ見積番号を含む)" } },
  }),
  async (c) => {
    const parsed = v.safeParse(SearchDealsQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).list(parsed.output));
  },
);

dealsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({
    summary: "商談CSVダウンロード(検索条件を反映。CSVインポートと同じ形式で、そのまま再インポートできる)",
    tags: TAGS,
  }),
  async (c) => {
    const parsed = v.safeParse(SearchDealsQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    const service = new DealsCsvExportService(new DealsRepository(c.env.DB_DEALS, c.env.DB));
    const { csv, total, included } = await service.exportCsv(c, parsed.output);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      // 取込の書き込み上限に収まらず一部の商談のみ出力した場合に、画面が警告できるよう件数を返す
      "X-Deals-Export-Total": String(total),
      "X-Deals-Export-Included": String(included),
      "Access-Control-Expose-Headers": "X-Deals-Export-Total, X-Deals-Export-Included",
      "Content-Disposition": `attachment; filename="deals_export_${todayJst()}.csv"`,
    });
  },
);

dealsRouter.get(
  "/tasks",
  describeApiRoute({
    summary: "未完了タスクの一覧(期限の早い順。assigneeEmployeeNumberで担当者、partnerIdで取引先を絞り込み)",
    tags: TAGS,
    query: OpenTasksQuerySchema,
    responses: { 200: { description: "タスクの配列(商談番号・商談名・取引先名を含む)" } },
  }),
  async (c) => {
    const parsed = v.safeParse(OpenTasksQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).listOpenTasks(parsed.output));
  },
);

dealsRouter.get(
  "/quote-candidates",
  describeApiRoute({
    summary: "商談に紐づけられる見積の候補(指定した取引先の見積)",
    tags: TAGS,
    query: QuoteCandidatesQuerySchema,
    responses: { 200: { description: "見積の配列" } },
  }),
  async (c) => {
    const parsed = v.safeParse(QuoteCandidatesQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).listQuoteCandidates(parsed.output.partnerId));
  },
);

dealsRouter.get(
  "/attendee-candidates",
  describeApiRoute({
    summary: "面談者として選べる相手(取引先担当者マスタ+見込客担当者)",
    tags: TAGS,
    query: QuoteCandidatesQuerySchema,
    responses: { 200: { description: "{partnerContacts, prospectContacts}" } },
  }),
  async (c) => {
    const parsed = v.safeParse(QuoteCandidatesQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).listAttendeeCandidates(parsed.output.partnerId));
  },
);

// ---------- 見込客担当者(取引先担当者マスタに未登録の相手を、商談入力中にその場で登録できる) ----------
dealsRouter.get(
  "/prospect-contacts",
  describeApiRoute({
    summary: "見込客担当者の一覧(partnerIdで絞り込み)",
    tags: TAGS,
    query: SearchProspectContactsQuerySchema,
    responses: { 200: { description: "見込客担当者の配列" } },
  }),
  async (c) => {
    const parsed = v.safeParse(SearchProspectContactsQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).listProspectContacts(parsed.output.partnerId));
  },
);

dealsRouter.post(
  "/prospect-contacts",
  describeApiRoute({
    summary: "見込客担当者の登録",
    tags: TAGS,
    json: ProspectContactInputSchema,
    responses: { 200: { description: "登録成功({success, id})" }, 400: { description: "入力不正" } },
  }),
  async (c) => {
    const parsed = v.safeParse(ProspectContactInputSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).createProspectContact(c, parsed.output));
  },
);

dealsRouter.put(
  "/prospect-contacts/:id",
  describeApiRoute({
    summary: "見込客担当者の更新",
    tags: TAGS,
    json: ProspectContactInputSchema,
    responses: { 200: { description: "更新成功" }, 400: { description: "入力不正" }, 404: { description: "存在しない" } },
  }),
  async (c) => {
    const parsed = v.safeParse(ProspectContactInputSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).updateProspectContact(c, c.req.param("id"), parsed.output));
  },
);

dealsRouter.delete(
  "/prospect-contacts/:id",
  describeApiRoute({
    summary: "見込客担当者の削除(過去の商談の面談者名は残る)",
    tags: TAGS,
    responses: { 200: { description: "削除成功" }, 404: { description: "存在しない" } },
  }),
  async (c) => c.json(await getService(c).removeProspectContact(c, c.req.param("id"))),
);

// ---------- 商談本体 ----------
dealsRouter.post(
  "/register",
  describeApiRoute({
    summary: "商談の登録(面談者・次回までのタスク・紐づけ見積を含む)",
    tags: TAGS,
    json: RegisterDealSchema,
    responses: { 200: { description: "登録成功({success, id})" }, 400: { description: "入力不正・存在しない取引先/ユーザー/見積" } },
  }),
  async (c) => {
    const parsed = v.safeParse(RegisterDealSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).register(c, parsed.output));
  },
);

dealsRouter.post(
  "/bulk-register",
  describeCsvImportRoute({
    summary: "商談CSV一括インポート(同じgroupKeyの行を1商談にまとめる。dealId指定で既存商談を全項目置き換え)",
    tags: TAGS,
    successDescription: "CSVインポート成功({success, created, updated, message})",
    errors: [{ status: 400, description: "CSVファイル未添付・形式不正・行の内容不正(不正がある場合は1件も登録しない)" }],
  }),
  async (c) => {
    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) return c.json({ success: false, message: "CSVファイルが添付されていません" }, 400);
    const service = new DealsCsvImportService(new DealsRepository(c.env.DB_DEALS, c.env.DB));
    return c.json(await service.importCsv(c, file));
  },
);

dealsRouter.get(
  "/:id",
  describeApiRoute({
    summary: "商談の詳細(面談者・タスク・添付・紐づけ見積を含む)",
    tags: TAGS,
    responses: { 200: { description: "商談" }, 404: { description: "存在しない" } },
  }),
  async (c) => c.json(await getService(c).getById(c.req.param("id"))),
);

dealsRouter.put(
  "/:id",
  describeApiRoute({
    summary: "商談の更新(全項目の置き換え。面談者・タスク・紐づけ見積は指定した内容が最終状態になる)",
    tags: TAGS,
    json: UpdateDealSchema,
    responses: { 200: { description: "更新成功" }, 400: { description: "入力不正" }, 404: { description: "存在しない" } },
  }),
  async (c) => {
    const parsed = v.safeParse(UpdateDealSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).update(c, c.req.param("id"), parsed.output));
  },
);

dealsRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "商談の削除(面談者・タスク・添付・見積紐づけも削除。添付の実体もR2から削除)",
    tags: TAGS,
    responses: { 200: { description: "削除成功" }, 404: { description: "存在しない" } },
  }),
  async (c) => c.json(await getService(c).remove(c, c.req.param("id"))),
);

dealsRouter.put(
  "/:id/tasks/:taskId/done",
  describeApiRoute({
    summary: "次回までのタスクの完了/未完了の切替",
    tags: TAGS,
    json: SetTaskDoneSchema,
    responses: { 200: { description: "更新成功" }, 404: { description: "存在しない" } },
  }),
  async (c) => {
    const parsed = v.safeParse(SetTaskDoneSchema, await c.req.json().catch(() => null));
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).setTaskDone(c, c.req.param("id"), c.req.param("taskId"), parsed.output.isDone));
  },
);

// ---------- 添付ファイル(専用バケット) ----------
dealsRouter.post(
  "/:id/attachments",
  describeApiRoute({
    summary: "商談への添付ファイルのアップロード(multipart/form-data の file。20MBまで)",
    tags: TAGS,
    responses: { 200: { description: "添付成功({success, id, fileName})" }, 400: { description: "ファイルなし・サイズ超過" }, 404: { description: "商談が存在しない" } },
  }),
  async (c) => {
    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) return c.json({ success: false, message: "ファイルがありません" }, 400);
    return c.json(await getService(c).uploadAttachment(c, c.req.param("id"), file));
  },
);

dealsRouter.get(
  "/:id/attachments/:attachmentId",
  describeApiRoute({
    summary: "商談の添付ファイルの取得(画像/PDFはインライン表示)",
    tags: TAGS,
    responses: { 200: { description: "ファイル本体" }, 404: { description: "存在しない" } },
  }),
  async (c) => {
    const file = await getService(c).getAttachment(c, c.req.param("id"), c.req.param("attachmentId"));
    if (!file) return c.text("ファイルが見つかりません", 404);
    return new Response(file.body, {
      headers: { "content-type": file.contentType, "content-disposition": file.contentDisposition },
    });
  },
);

dealsRouter.delete(
  "/:id/attachments/:attachmentId",
  describeApiRoute({
    summary: "商談の添付ファイルの削除",
    tags: TAGS,
    responses: { 200: { description: "削除成功" }, 404: { description: "存在しない" } },
  }),
  async (c) => c.json(await getService(c).removeAttachment(c, c.req.param("id"), c.req.param("attachmentId"))),
);

export { dealsRouter };
