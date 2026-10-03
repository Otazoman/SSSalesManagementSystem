import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../types/env";
import { ProgressRepository } from "./progress.repository";
import { ProgressService } from "./progress.service";
import {
  CaseAssignmentPayloadSchema,
  ProgressQuerySchema,
  StageOwnersPayloadSchema,
} from "./progress.schema";
import { respondError, respondValidationError } from "../../platform/http/error-handler";
import {
  describeApiRoute,
  describeCsvDownloadRoute,
  describeCsvImportRoute,
} from "../../platform/openapi/describe-route";
import { StageOwnersCsvService } from "./progress-stage-owners-csv.service";
import { todayJst } from "../../platform/date/format-jst-date";

const progressRouter = new Hono<{ Bindings: Env }>();

progressRouter.onError((err, c) => respondError(c, err));

// ==========================================
// Item12-1/12-3: 進捗確認(見積〜支払の一気通貫ビュー)。読み取り専用
// ==========================================
progressRouter.get(
  "/",
  describeApiRoute({
    summary: "進捗一覧(見積〜支払の一気通貫、承認進捗付き)",
    tags: ["progress"],
    query: ProgressQuerySchema,
    responses: {
      200: {
        description:
          "{items, total, page, pageSize, nextOffset}。1件=1案件(起点伝票)で、工程ごとの伝票・担当者・承認進捗・完了/進行中の状態を含む。stateの既定は進行中のみ(この場合totalはnull、続きはnextOffsetをoffsetに指定して取得)",
      },
    },
  }),
  async (c) => {
    const parsed = v.safeParse(ProgressQuerySchema, c.req.query());
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const service = new ProgressService(new ProgressRepository(c.env.DB));
    return c.json(await service.getProgress(parsed.output));
  },
);

const getService = (c: any) => new ProgressService(new ProgressRepository(c.env.DB));

// 追加要望M-2-c: 検索結果のCSVエクスポート(同じ検索条件。件数上限あり)
progressRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "進捗一覧CSVダウンロード(検索条件を反映)", tags: ["progress"] }),
  async (c) => {
    const parsed = v.safeParse(ProgressQuerySchema, c.req.query());
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const csv = await getService(c).exportCsv(c, parsed.output);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="progress_export_${todayJst()}.csv"`,
    });
  },
);

// Item12-2/12-4: 工程ごとの既定担当(誰が何をするか)
progressRouter.get(
  "/stage-owners",
  describeApiRoute({
    summary: "進捗確認: 工程ごとの既定担当の取得",
    tags: ["progress"],
    responses: { 200: { description: "設定済みの工程のみ。assigneeTypeはUSER(従業員番号)/ROLE(ロールID)" } },
  }),
  async (c) => c.json(await getService(c).getStageOwners()),
);

progressRouter.put(
  "/stage-owners",
  describeApiRoute({
    summary: "進捗確認: 工程ごとの既定担当の一括保存(指定の無い工程は未設定になる)",
    tags: ["progress"],
    json: StageOwnersPayloadSchema,
    responses: { 200: { description: "保存成功" }, 400: { description: "入力不正・存在しないユーザー/ロール" } },
  }),
  async (c) => {
    const parsed = v.safeParse(StageOwnersPayloadSchema, await c.req.json());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).saveStageOwners(c, parsed.output));
  },
);

// 工程ごとの既定担当のCSV出力/取込(出力したファイルをそのまま編集して再取込できる)
progressRouter.get(
  "/stage-owners/csv-download",
  describeCsvDownloadRoute({
    summary: "進捗確認: 工程ごとの既定担当のCSVダウンロード(全工程。未設定の工程は担当が空欄。CSVインポートと同じ形式)",
    tags: ["progress"],
  }),
  async (c) => {
    const csv = await new StageOwnersCsvService(getService(c)).exportCsv();
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="progress_stage_owners_${todayJst()}.csv"`,
    });
  },
);

progressRouter.post(
  "/stage-owners/bulk-register",
  describeCsvImportRoute({
    summary: "進捗確認: 工程ごとの既定担当のCSV一括インポート(CSVに含まれる工程のみ更新。担当が空欄の工程は未設定に戻す)",
    tags: ["progress"],
    successDescription: "CSVインポート成功({success, updated, cleared, message})",
    errors: [{ status: 400, description: "CSVファイル未添付・形式不正・行の内容不正・存在しないユーザー/ロール/部署(1件でも不正なら反映しない)" }],
  }),
  async (c) => {
    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
      return c.json({ success: false, message: "CSVファイルが添付されていません" }, 400);
    }
    return c.json(await new StageOwnersCsvService(getService(c)).importCsv(c, file));
  },
);

// 案件×工程の個別割当(既定担当を上書き)
progressRouter.put(
  "/case-assignment",
  describeApiRoute({
    summary: "進捗確認: 案件×工程の担当者の個別割当(employeeNumber=nullで解除)",
    tags: ["progress"],
    json: CaseAssignmentPayloadSchema,
    responses: { 200: { description: "保存成功" }, 400: { description: "入力不正・存在しないユーザー" } },
  }),
  async (c) => {
    const parsed = v.safeParse(CaseAssignmentPayloadSchema, await c.req.json());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await getService(c).saveCaseAssignment(c, parsed.output));
  },
);

export { progressRouter };
