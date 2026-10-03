import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema";
import { Env } from "../../../types/env";

export class MailSettingsRepository {
  private db;

  constructor(env: Env) {
    this.db = drizzle(env.DB, { schema });
  }

  // 全テンプレート取得
  async findAllTemplates() {
    return await this.db.select().from(schema.mailTemplateSettings);
  }

  // ID指定でテンプレート取得
  async findTemplateById(id: string) {
    const result = await this.db
      .select()
      .from(schema.mailTemplateSettings)
      .where(eq(schema.mailTemplateSettings.id, id))
      .limit(1);
    return result[0] || null;
  }

  // デフォルトレコードの初期挿入
  async insertDefaultTemplates(
    records: Array<{
      id: string;
      name: string;
      smtpFrom: string;
      ccAddress: string;
      bccAddress: string;
      subjectTemplate: string;
      bodyTemplate: string;
      updatedAt: Date;
      updatedBy: string;
    }>,
  ) {
    return await this.db.insert(schema.mailTemplateSettings).values(records);
  }

  // テンプレート更新
  async updateTemplate(
    id: string,
    data: {
      smtpFrom: string;
      ccAddress: string;
      bccAddress: string;
      subjectTemplate: string;
      bodyTemplate: string;
      fileNamePrefix?: string | null;
      updatedAt: Date;
    },
  ) {
    return await this.db
      .update(schema.mailTemplateSettings)
      .set(data)
      .where(eq(schema.mailTemplateSettings.id, id));
  }

  // 帳票Excelテンプレートのパス更新。同時にコンパイル状態をPENDINGへ戻す(古いlayout.jsonは無効化)
  async updateReportTemplatePath(id: string, reportTemplatePath: string, updatedAt: Date) {
    return await this.db
      .update(schema.mailTemplateSettings)
      .set({
        reportTemplatePath,
        reportLayoutPath: null,
        reportLayoutStatus: "PENDING",
        reportLayoutError: null,
        updatedAt,
      })
      .where(eq(schema.mailTemplateSettings.id, id));
  }

  // 帳票Excelテンプレートのパスをクリア(削除時、既定のpdf-lib描画へフォールバックさせる)
  async clearReportTemplatePath(id: string, updatedAt: Date) {
    return await this.db
      .update(schema.mailTemplateSettings)
      .set({
        reportTemplatePath: null,
        reportLayoutPath: null,
        reportLayoutStatus: null,
        reportLayoutError: null,
        updatedAt,
      })
      .where(eq(schema.mailTemplateSettings.id, id));
  }
}
