import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { JournalExportFormatService } from "./journal-export-format.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { describeApiRoute } from "../../../platform/openapi/describe-route";
import { JournalExportFormatSchema } from "./journal-export-format.schema";

const journalExportFormatRouter = new Hono<{ Bindings: Env }>();

journalExportFormatRouter.onError((err, c) => respondError(c, err));

const getService = (c: any): JournalExportFormatService => new JournalExportFormatService(c.env);

journalExportFormatRouter.get(
  "/",
  describeApiRoute({
    summary: "仕訳CSV出力フォーマット設定の取得(未設定時は既定値)",
    tags: ["journal-export-format"],
    responses: { 200: { description: "取得成功" } },
  }),
  async (c) => {
    const format = await getService(c).getFormat();
    return c.json(format);
  },
);

journalExportFormatRouter.put(
  "/",
  describeApiRoute({
    summary: "仕訳CSV出力フォーマット設定の保存",
    tags: ["journal-export-format"],
    json: JournalExportFormatSchema,
    responses: {
      200: { description: "保存成功" },
      400: { description: "入力内容に不備(列の過不足・重複等)" },
    },
  }),
  async (c) => {
    const rawBody = await c.req.json().catch(() => null);
    if (!rawBody) {
      return c.json({ success: false, message: "JSONフォーマットが不正です" }, 400);
    }
    const parsed = v.safeParse(JournalExportFormatSchema, rawBody);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const result = await getService(c).updateFormat(c, parsed.output);
    return c.json(result);
  },
);

export { journalExportFormatRouter };
