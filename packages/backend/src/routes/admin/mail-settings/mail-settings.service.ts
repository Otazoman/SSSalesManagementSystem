import { Context } from "hono";
import { MailSettingsRepository } from "./mail-settings.repository";
import {
  UpdateTemplateInput,
  SendTestEmailInput,
} from "./mail-settings.schema";
import { writeAuditLog } from "../../../utils/logger";
import { sendEmail } from "../../../utils/mailer";
import { Env } from "../../../types/env";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { isValidFileNamePrefix, MAX_FILE_NAME_PREFIX_LENGTH } from "../../../platform/documents/document-file-name";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import {
  BadRequestError,
  NotFoundError,
  HttpError,
} from "../../../platform/http/http-error";
import { PaginationParams, toOffset, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";

const RESOURCE_KEY = "admin_mail_settings";

const INITIAL_TEMPLATES = [
  {
    id: "sales_quote",
    name: "見積書",
    subject: "【御中】見積書のご送付について",
  },
  {
    id: "order_acknowledgement",
    name: "注文請書",
    subject: "【御中】ご注文請書のご送付について",
  },
  {
    id: "shipping_instruction",
    name: "出荷指示書",
    subject: "【出荷指示】出荷業務対応のお願い",
  },
  {
    id: "sales_invoice",
    name: "納品書",
    subject: "【御中】納品書のご送付について",
  },
  {
    id: "billing_invoice",
    name: "請求書",
    subject: "【御中】ご請求書のご送付について",
  },
  {
    id: "purchase_order",
    name: "発注書",
    subject: "【注文依頼】発注書のご送付について",
  },
  {
    // K-4-1: id"sales_invoice"は既に納品書(上記)が使用済みのため、売上計上の
    // 個別/一括メール送信には新規idを割り当てる
    id: "sales_recognition",
    name: "売上計上",
    subject: "【御中】売上計上書類のご送付について",
  },
  {
    id: "receiving_instruction",
    name: "入荷指示書",
    subject: "【入荷指示】入荷受け入れ対応のお願い",
  },
  {
    id: "acceptance_inspection",
    name: "検収書",
    subject: "【御中】検収書のご送付について",
  },
  {
    // 追加要望L-3-b/c: 仕入計上書のPDFファイル名プレフィックスを設定できるようにするための項目
    id: "purchase_recognition",
    name: "仕入計上書",
    subject: "【御中】仕入計上書類のご送付について",
  },
];

export class MailSettingsService {
  private repo: MailSettingsRepository;

  constructor(env: Env) {
    this.repo = new MailSettingsRepository(env);
  }

  // 1. 全帳票メール設定取得 & 初回自動セットアップ
  // K-4-1: 従来は空テーブル時のみ全件シードする全有無判定だったが、これだと後からINITIAL_TEMPLATESに
  // 追加した種別(例: sales_recognition)が既存環境(既に8件シード済み)には永久に作られなかった。
  // 未作成のidのみを都度差分シードする方式に変更し、新規種別追加時も自動的に補完されるようにする
  async getOrInitTemplates(c: Context<{ Bindings: Env }>) {
    let templates = await this.repo.findAllTemplates();

    const existingIds = new Set(templates.map((t) => t.id));
    const missing = INITIAL_TEMPLATES.filter((item) => !existingIds.has(item.id));

    if (missing.length > 0) {
      const defaultRecords = missing.map((item) => ({
        id: item.id,
        name: item.name,
        smtpFrom: "",
        ccAddress: "",
        bccAddress: "",
        subjectTemplate: item.subject,
        bodyTemplate:
          "いつもお世話になっております。\n\n添付にて帳票書類をお送りいたしますので、ご査収のほどよろしくお願い申し上げます。",
        updatedAt: new Date(),
        updatedBy: "SYSTEM_INIT",
      }));

      await this.repo.insertDefaultTemplates(defaultRecords);

      await writeAuditLog(
        c,
        "INIT_MAIL_TEMPLATE_SETTINGS",
        RESOURCE_KEY,
        "ALL_CHANNELS",
        null,
        { message: `画面アクセスによる${missing.length}個の帳票マスタ初期枠の自動構築` },
        true,
      );

      templates = await this.repo.findAllTemplates();
    }

    return templates;
  }

  async getTemplatesPage(c: Context<{ Bindings: Env }>, params: PaginationParams) {
    const all = await this.getOrInitTemplates(c);
    const start = toOffset(params);
    const data = all.slice(start, start + params.limit);
    return buildListResponse(data, buildPaginationMeta(params, all.length));
  }

  // 2. 設定の更新
  async updateTemplate(
    c: Context<{ Bindings: Env }>,
    data: UpdateTemplateInput,
  ) {
    const {
      id,
      smtpFrom,
      ccAddress,
      bccAddress,
      subjectTemplate,
      bodyTemplate,
      fileNamePrefix,
    } = data;

    // 追加要望L-3-b/c: ファイル名プレフィックスの検証(ファイル名に使えない文字・長さ)
    const trimmedPrefix = fileNamePrefix === undefined ? undefined : (fileNamePrefix ?? "").trim();
    if (trimmedPrefix !== undefined && !isValidFileNamePrefix(trimmedPrefix)) {
      throw new BadRequestError(
        `ファイル名プレフィックスは${MAX_FILE_NAME_PREFIX_LENGTH}文字以内で、次の文字は使用できません: \\ / : * ? " < > |`,
      );
    }

    const oldSnapshot = await this.repo.findTemplateById(id);

    const updatedData = {
      smtpFrom: (smtpFrom || "").trim(),
      ccAddress: (ccAddress || "").trim(),
      bccAddress: (bccAddress || "").trim(),
      subjectTemplate: subjectTemplate.trim(),
      bodyTemplate: bodyTemplate || "",
      ...(trimmedPrefix !== undefined && { fileNamePrefix: trimmedPrefix || null }),
      updatedAt: new Date(),
    };

    await this.repo.updateTemplate(id, updatedData);

    await writeAuditLog(
      c,
      "UPDATE_MAIL_TEMPLATE_SETTINGS",
      RESOURCE_KEY,
      id,
      oldSnapshot,
      { id, ...updatedData },
      true,
    );

    return {
      success: true,
      message: "メール・帳票配信フォーマットを設定しました",
    };
  }

  // 3. 送信テスト
  async sendTestEmail(c: Context<{ Bindings: Env }>, data: SendTestEmailInput) {
    const { id, testToEmail, attachedR2Path } = data;

    const systemConfig = await getCompanySettings(c.env.COMPANY_SETTINGS);
    if (!systemConfig) {
      throw new BadRequestError("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");
    }

    const template = await this.repo.findTemplateById(id);
    if (!template) {
      throw new NotFoundError("指定された帳票マスタが存在しません");
    }

    const sampleCompanyName = "株式会社サンプル取引先";
    const sampleDocId =
      id === "sales_quote" ? "QT-202606-0001" : "INV-202606-0001";
    const sampleTotalAmount = "165,000円";

    const replacedSubject = `【テスト】${template.subjectTemplate}`
      .replace(/{company_name}/g, sampleCompanyName)
      .replace(/{doc_id}/g, sampleDocId)
      .replace(/{total_amount}/g, sampleTotalAmount);

    const replacedBody = [
      `--------- ※これは配信設定画面からの送信テストメールです ---------`,
      `宛先(To)確認用: ${testToEmail}`,
      `設定上のCc: ${template.ccAddress || "(未設定)"}`,
      `添付ファイルソース: ${attachedR2Path || "添付なし"}`,
      `--------------------------------------------------`,
      ``,
      template.bodyTemplate
        .replace(/{company_name}/g, sampleCompanyName)
        .replace(/{doc_id}/g, sampleDocId)
        .replace(/{total_amount}/g, sampleTotalAmount),
    ].join("\n");

    const testAttachments = [];
    if (attachedR2Path) {
      try {
        const isQuotesFile = attachedR2Path.startsWith("quotes/");
        const attachSourceBucket = isQuotesFile
          ? c.env.QUATES_BUCKET
          : c.env.SYSTEM_BUCKET;

        const r2Object = await attachSourceBucket.get(attachedR2Path);
        if (!r2Object) {
          throw new BadRequestError(
            `指定されたR2ファイルが見つかりません (検索対象バケット: ${isQuotesFile ? "quotes" : "system"}): ${attachedR2Path}`,
          );
        }

        const arrayBuffer = await r2Object.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        let binaryString = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          binaryString += String.fromCharCode.apply(
            null,
            uint8Array.subarray(i, i + chunkSize) as unknown as number[],
          );
        }
        const base64Str = btoa(binaryString);

        const filename = attachedR2Path.split("/").pop() || "attached_file";
        const contentType =
          r2Object.httpMetadata?.contentType || "application/octet-stream";

        testAttachments.push({
          filename,
          contentType,
          base64Content: base64Str,
        });
      } catch (r2Err: any) {
        if (r2Err instanceof BadRequestError) throw r2Err;
        console.error("R2 attachment process error:", r2Err);
        throw new HttpError(
          500,
          `R2からのファイルデコードに失敗しました: ${r2Err.message}`,
        );
      }
    }

    const activeFrom =
      template.smtpFrom?.trim() ||
      systemConfig.smtp_from ||
      systemConfig.smtp_user;

    await sendEmail({
      smtpHost: systemConfig.smtp_host,
      smtpPort: systemConfig.smtp_port,
      smtpUser: systemConfig.smtp_user,
      smtpPass: systemConfig.smtp_pass,
      smtpFrom: activeFrom,
      to: testToEmail,
      cc: template.ccAddress || undefined,
      bcc: template.bccAddress || undefined,
      subject: replacedSubject,
      text: replacedBody,
      attachments: testAttachments.length > 0 ? testAttachments : undefined,
    });

    await writeAuditLog(
      c,
      "EXECUTE_MAIL_TEMPLATE_TEST_EMAIL",
      RESOURCE_KEY,
      id,
      null,
      {
        testRecipientTo: testToEmail,
        testedCc: template.ccAddress,
        attachedR2Path: attachedR2Path || null,
      },
      systemConfig.is_audit_log_enabled !== false,
    );

    return {
      success: true,
      message: `「${template.name}」のテストメールを送信しました。宛先およびCcをご確認ください。`,
    };
  }

  // 4. R2 エクスプローラー（フォルダ・ファイル一覧）
  async listR2Objects(
    c: Context<{ Bindings: Env }>,
    prefix: string,
    targetBucket: string,
  ) {
    const bucket =
      targetBucket === "quotes" ? c.env.QUATES_BUCKET : c.env.SYSTEM_BUCKET;

    const options: R2ListOptions = {
      prefix,
      delimiter: "/",
    };

    const listed = await bucket.list(options);

    const folders = listed.delimitedPrefixes.map((p) => ({
      name: p.slice(prefix.length).replace(/\/$/, ""),
      path: p,
      type: "folder",
    }));

    const files = listed.objects
      .filter((obj) => obj.key !== prefix)
      .map((obj) => ({
        name: obj.key.slice(prefix.length),
        path: obj.key,
        type: "file",
        size: obj.size,
        contentType:
          obj.httpMetadata?.contentType || "application/octet-stream",
      }));

    return {
      currentPrefix: prefix,
      parentPrefix: prefix
        ? prefix.split("/").slice(0, -2).join("/") +
          (prefix.split("/").slice(0, -2).length ? "/" : "")
        : null,
      items: [...folders, ...files],
    };
  }

  // 5. アセットファイル（フォント・ロゴ・印影・帳票Excelテンプレート）のアップロード
  async uploadSystemAsset(
    c: Context<{ Bindings: Env }>,
    fileType: string,
    file: File,
    documentTypeId?: string,
  ) {
    let r2Path = "";
    let contentType = "";

    if (fileType === "font") {
      r2Path = "fonts/company_fonts.ttf";
      contentType = "font/ttf";
    } else if (fileType === "logo") {
      r2Path = "company/company_logo.png";
      contentType = "image/png";
    } else if (fileType === "seal") {
      r2Path = "company/company_seal.png";
      contentType = "image/png";
    } else if (fileType === "report_template") {
      if (!documentTypeId) {
        throw new BadRequestError("対象の帳票種別(documentTypeId)が指定されていません");
      }
      const template = await this.repo.findTemplateById(documentTypeId);
      if (!template) {
        throw new NotFoundError("指定された帳票マスタが存在しません");
      }
      r2Path = `report_templates/${documentTypeId}.xlsx`;
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else {
      throw new BadRequestError("無効なファイルタイプ指定です");
    }

    const arrayBuffer = await file.arrayBuffer();
    await c.env.SYSTEM_BUCKET.put(r2Path, arrayBuffer, {
      httpMetadata: { contentType },
    });

    if (fileType === "report_template" && documentTypeId) {
      await this.repo.updateReportTemplatePath(documentTypeId, r2Path, new Date());
    }

    await logAuditEvent(
      c,
      "UPLOAD_SYSTEM_ASSET",
      RESOURCE_KEY,
      fileType === "report_template" ? documentTypeId! : fileType,
      null,
      { r2Path },
    );

    return { success: true, path: r2Path };
  }

  // 6. 帳票Excelテンプレートの削除(既定のpdf-lib描画へフォールバックさせる)
  async deleteReportTemplate(
    c: Context<{ Bindings: Env }>,
    documentTypeId: string,
  ) {
    const template = await this.repo.findTemplateById(documentTypeId);
    if (!template) {
      throw new NotFoundError("指定された帳票マスタが存在しません");
    }
    if (!template.reportTemplatePath) {
      throw new BadRequestError("この帳票にはテンプレートが登録されていません");
    }

    await c.env.SYSTEM_BUCKET.delete(template.reportTemplatePath);
    if (template.reportLayoutPath) {
      await c.env.SYSTEM_BUCKET.delete(template.reportLayoutPath);
    }
    await this.repo.clearReportTemplatePath(documentTypeId, new Date());

    await logAuditEvent(
      c,
      "DELETE_REPORT_TEMPLATE",
      RESOURCE_KEY,
      documentTypeId,
      { reportTemplatePath: template.reportTemplatePath },
      null,
    );

    return { success: true };
  }
}
