import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import ExcelJS from "exceljs";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { mailSettingsRouter } from "../routes/admin/mail-settings/index";
import { processReportTemplateCompiles } from "./process-report-template-compiles";

async function buildSampleXlsx(): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "{{quote_no}}";
  sheet.getCell("A2").value = "{{item.name}}";
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("processReportTemplateCompiles", () => {
  it("PENDING行が無ければ何もしない", async () => {
    await expect(processReportTemplateCompiles(env)).resolves.toBeUndefined();
  });

  it("正常系: R2からxlsxを読み込みlayout.jsonを生成しREADYへ更新する", async () => {
    await mailSettingsRouter.request("/", {}, env);

    const formData = new FormData();
    formData.append("fileType", "report_template");
    formData.append("documentTypeId", "purchase_order");
    formData.append("file", await buildSampleXlsx(), "template.xlsx");
    await mailSettingsRouter.request(
      "/upload-file",
      { method: "POST", body: formData },
      env,
    );

    // アップロード直後はPENDINGのはず
    const db = drizzle(env.DB, { schema });
    const beforeRows = await db
      .select()
      .from(schema.mailTemplateSettings)
      .where(eq(schema.mailTemplateSettings.id, "purchase_order"));
    expect(beforeRows[0]?.reportLayoutStatus).toBe("PENDING");

    await processReportTemplateCompiles(env);

    const afterRows = await db
      .select()
      .from(schema.mailTemplateSettings)
      .where(eq(schema.mailTemplateSettings.id, "purchase_order"));
    expect(afterRows[0]?.reportLayoutStatus).toBe("READY");
    expect(afterRows[0]?.reportLayoutPath).toBe(
      "report_templates/purchase_order.layout.json",
    );
    expect(afterRows[0]?.reportLayoutError).toBeNull();

    const layoutObj = await env.SYSTEM_BUCKET.get(
      "report_templates/purchase_order.layout.json",
    );
    expect(layoutObj).not.toBeNull();
    const layout = JSON.parse(await layoutObj!.text());
    expect(layout.version).toBe(1);
    expect(layout.itemTemplateRow).toBe(2);
  });

  it("異常系: R2にxlsxが存在しない場合はFAILEDへ更新する", async () => {
    await mailSettingsRouter.request("/", {}, env);

    const db = drizzle(env.DB, { schema });
    await db
      .update(schema.mailTemplateSettings)
      .set({
        reportTemplatePath: "report_templates/missing_doc.xlsx",
        reportLayoutStatus: "PENDING",
      })
      .where(eq(schema.mailTemplateSettings.id, "receiving_instruction"));

    await processReportTemplateCompiles(env);

    const rows = await db
      .select()
      .from(schema.mailTemplateSettings)
      .where(eq(schema.mailTemplateSettings.id, "receiving_instruction"));
    expect(rows[0]?.reportLayoutStatus).toBe("FAILED");
    expect(rows[0]?.reportLayoutError).toContain("見つかりません");
  });
});
