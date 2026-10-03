import { Hono } from "hono";
import * as v from "valibot";
import { Env } from "../../../types/env";
import { JournalExportRepository } from "./journal-export.repository";
import { JournalExportService } from "./journal-export.service";
import { JournalExportFormatService } from "../journal-export-format/journal-export-format.service";
import { respondError, respondValidationError } from "../../../platform/http/error-handler";
import { describeCsvDownloadRoute } from "../../../platform/openapi/describe-route";
import { JournalExportQuerySchema } from "./journal-export.schema";
import { todayJst } from "../../../platform/date/format-jst-date";

const journalExportRouter = new Hono<{ Bindings: Env }>();

journalExportRouter.onError((err, c) => respondError(c, err));

const getService = (c: any): JournalExportService =>
  new JournalExportService(new JournalExportRepository(c.env.DB, c.env.DB_JOURNAL));

// ==========================================
// Item11-1: 仕訳データCSV出力(検索条件を指定して該当する全仕訳を出力)
// ==========================================
journalExportRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "仕訳データCSV出力(汎用フォーマット)", tags: ["journal-export"] }),
  async (c) => {
    const queryParams = c.req.query();
    const parsed = v.safeParse(JournalExportQuerySchema, queryParams);
    if (!parsed.success) {
      return respondValidationError(c, parsed.issues);
    }
    const format = await new JournalExportFormatService(c.env).getFormat();
    const csvContent = await getService(c).exportCsv(c, parsed.output, format);
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="journal_export_${todayJst()}.csv"`,
    });
  },
);

export { journalExportRouter };
