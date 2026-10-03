import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { D1ExplorerService } from "./d1-explorer.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { describeApiRoute } from "../../../platform/openapi/describe-route";
import {
  D1RowQuerySchema,
  D1TableQuerySchema,
  DeleteD1RowPayloadSchema,
  ListD1RowsQuerySchema,
  ListD1TablesQuerySchema,
  UpdateD1RowPayloadSchema,
} from "./d1-explorer.schema";

const d1ExplorerRouter = new Hono<{ Bindings: Env }>();

d1ExplorerRouter.onError((err, c) => respondError(c, err));

const service = new D1ExplorerService();

// ==========================================
// Item13-b: D1参照・編集。DDL(テーブル・列の追加削除)のエンドポイントは意図的に持たない
// ==========================================
d1ExplorerRouter.get(
  "/databases",
  describeApiRoute({
    summary: "D1参照: 閲覧可能なDB一覧",
    tags: ["d1-explorer"],
    responses: { 200: { description: "閲覧可能なD1データベース(バインディングが存在するもののみ)" } },
  }),
  async (c) => c.json(service.listDatabases(c.env)),
);

d1ExplorerRouter.get(
  "/tables",
  describeApiRoute({
    summary: "D1参照: テーブル一覧",
    tags: ["d1-explorer"],
    query: ListD1TablesQuerySchema,
    responses: { 200: { description: "テーブル・ビュー一覧(sqlite_*/_cf_*の内部テーブルは除く)" } },
  }),
  async (c) => {
    const parsed = v.safeParse(ListD1TablesQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.listTables(c, parsed.output));
  },
);

d1ExplorerRouter.get(
  "/schema",
  describeApiRoute({
    summary: "D1参照: テーブルの列定義",
    tags: ["d1-explorer"],
    query: D1TableQuerySchema,
    responses: { 200: { description: "列名・型・NOT NULL・主キー・マスク対象かどうか" } },
  }),
  async (c) => {
    const parsed = v.safeParse(D1TableQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.getTableSchema(c, parsed.output));
  },
);

d1ExplorerRouter.get(
  "/rows",
  describeApiRoute({
    summary: "D1参照: テーブルの行(ページング、最大50行/ページ)",
    tags: ["d1-explorer"],
    query: ListD1RowsQuerySchema,
    responses: {
      200: { description: "{columns, rows, page, pageSize, hasMore}。パスワード/トークン等の列は値をマスクする" },
    },
  }),
  async (c) => {
    const parsed = v.safeParse(ListD1RowsQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.listRows(c, parsed.output));
  },
);

d1ExplorerRouter.get(
  "/count",
  describeApiRoute({
    summary: "D1参照: テーブルの件数(全行スキャンのため明示操作でのみ使用)",
    tags: ["d1-explorer"],
    query: D1TableQuerySchema,
    responses: { 200: { description: "{total}" } },
  }),
  async (c) => {
    const parsed = v.safeParse(D1TableQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.countRows(c, parsed.output));
  },
);

d1ExplorerRouter.get(
  "/row",
  describeApiRoute({
    summary: "D1編集: 対象1行の取得(主キー指定)",
    tags: ["d1-explorer"],
    query: D1RowQuerySchema,
    responses: { 200: { description: "{row, columns}。機密列は伏せ字、長文の切り詰めなし" } },
  }),
  async (c) => {
    const parsed = v.safeParse(D1RowQuerySchema, c.req.query());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.getRow(c, parsed.output));
  },
);

d1ExplorerRouter.post(
  "/rows/update",
  describeApiRoute({
    summary: "D1編集: 主キー指定の1行を更新(メインDBのみ)",
    tags: ["d1-explorer"],
    json: UpdateD1RowPayloadSchema,
    responses: { 200: { description: "{success, changes}" }, 400: { description: "検証エラー・変更不可" } },
  }),
  async (c) => {
    const parsed = v.safeParse(UpdateD1RowPayloadSchema, await c.req.json());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.updateRow(c, parsed.output));
  },
);

d1ExplorerRouter.post(
  "/rows/delete",
  describeApiRoute({
    summary: "D1編集: 主キー指定の1行を削除(メインDBのみ、テーブル名の再入力が必要)",
    tags: ["d1-explorer"],
    json: DeleteD1RowPayloadSchema,
    responses: { 200: { description: "{success, changes}" }, 400: { description: "検証エラー・変更不可" } },
  }),
  async (c) => {
    const parsed = v.safeParse(DeleteD1RowPayloadSchema, await c.req.json());
    if (!parsed.success) return respondValidationError(c, parsed.issues);
    return c.json(await service.deleteRow(c, parsed.output));
  },
);

export { d1ExplorerRouter };
