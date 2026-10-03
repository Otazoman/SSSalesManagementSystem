import { Context } from "hono";
import { PartnersRepository } from "./partners.repository";
import {
  CreatePartnerInput,
  UpdatePartnerInput,
  QueryInput,
} from "./partners.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { deleteOrphanedR2Attachments } from "../../../platform/r2/delete-orphaned-attachments";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { Env } from "../../../types/env";
import { withBom, buildCsvContent } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import {
  BadRequestError,
  NotFoundError,
} from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { determineInitialStatus } from "../../../workflow-engine/settings";
import { generateUniqueMasterCode } from "../../../platform/id/resolve-master-id";
import { SortQuery } from "../../../platform/http/sort";
import { csvField } from "../../../platform/csv/csv-writer";

const RESOURCE_KEY = "master_partners";

export class PartnersService {
  private repo: PartnersRepository;

  constructor(private c: Context<{ Bindings: Env }>) {
    this.repo = new PartnersRepository(c.env.DB);
  }

  async getList(query: QueryInput, sort?: SortQuery) {
    return await this.repo.findMany(query, sort);
  }

  async getListPage(
    query: QueryInput,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.findManyPage(query, params, sort),
      this.repo.countMany(query),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async create(data: CreatePartnerInput) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);

    // マスタコード自動採番: コード未入力時のみmaster_code_formatsの設定に基づき自動採番する。
    // 手入力されたコードが重複していた場合は従来通り明示的なエラーで弾く(黙って差し替えない)
    const resolvedId =
      data.id?.trim() ||
      (await generateUniqueMasterCode(this.c, "partners", (id) =>
        this.repo.findById(id).then((r) => !!r),
      ));

    const existing = await this.repo.findById(resolvedId);
    if (existing) {
      throw new BadRequestError(
        "登録エラー: 指定された取引先コードは既に存在します",
      );
    }

    // 追加要望A/Item5: クライアントが送ってきたstatusは信用せず、会社設定の承認フラグから
    // サーバー側で強制する(quotesのcreateQuote()がstatus:"DRAFT"を固定するのと同じ考え方)。
    const serverStatus = await determineInitialStatus(
      this.c.env.COMPANY_SETTINGS,
    );
    const dataWithServerStatus = { ...data, id: resolvedId, status: serverStatus };

    await this.repo.create(dataWithServerStatus, operatorId);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "CREATE_PARTNER", RESOURCE_KEY, resolvedId, null, {
      id: resolvedId,
      name: data.name,
      status: serverStatus,
    }),
    );

    return { success: true, message: "取引先を登録しました", id: resolvedId };
  }

  async update(id: string, data: UpdatePartnerInput) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);
    const oldSnapshot = await this.repo.findById(id);

    if (!oldSnapshot) {
      throw new NotFoundError("更新対象の取引先が存在しません");
    }

    // ➕ 【R2クリーンアップ】不要になった旧R2ファイルをバケットから削除
    const oldAttachments = await this.repo.findAttachmentsByPartnerId(id);
    await deleteOrphanedR2Attachments(
      this.c.env.PARTNERS_BUCKET,
      oldAttachments,
      (data.attachments || []).map((att) => att.attachmentR2Path),
    );

    await this.repo.update(id, data, operatorId);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "UPDATE_PARTNER", RESOURCE_KEY, id, oldSnapshot, {
      id,
      name: data.name,
      status: data.status,
    }),
    );

    return { success: true, message: "取引先情報を更新しました" };
  }

  async suspend(id: string) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);
    const oldSnapshot = await this.repo.findById(id);

    if (!oldSnapshot) {
      throw new NotFoundError("対象の取引先が存在しません");
    }

    await this.repo.updateStatus(id, "suspended", operatorId);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "SUSPEND_PARTNER", RESOURCE_KEY, id, oldSnapshot, {
      id,
      status: "suspended",
    }),
    );

    return { success: true, message: "取引先を停止状態に変更しました" };
  }

  async purge(id: string) {
    const oldSnapshot = await this.repo.findById(id);

    if (!oldSnapshot) {
      throw new NotFoundError("削除対象の取引先が存在しません");
    }

    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効状態の取引先のみ物理削除できます",
      );
    }

    // ➕ 物理削除前に、紐づく全R2ファイルを削除
    const attachments = await this.repo.findAttachmentsByPartnerId(id);
    for (const att of attachments) {
      if (att.storageType === "R2" && att.attachmentR2Path) {
        const cleanKey = att.attachmentR2Path.replace(/^partners\//, "");
        try {
          await this.c.env.PARTNERS_BUCKET.delete(`partners/${cleanKey}`);
        } catch (e) {
          console.error("物理削除時のR2ファイル削除失敗", e);
        }
      }
    }

    await this.repo.delete(id);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "PURGE_PARTNER", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return { success: true, message: "取引先データを完全削除しました" };
  }

  // ➕ ファイルアップロード処理（partners/ プレフィックスに変更）
  async uploadFile(file: File) {
    const r2Key = generateAttachmentKey("partners", file.name);

    await this.c.env.PARTNERS_BUCKET.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    return {
      success: true,
      fileName: file.name,
      attachmentR2Path: r2Key,
    };
  }

  // ➕ ファイル配信処理(DB経由: partnerId + attachmentId から添付ファイルレコードを引いてR2から配信)
  async getFile(
    partnerId: string,
    attachmentId: string,
  ): Promise<
    | { type: "redirect"; redirectUrl: string }
    | {
        type: "file";
        body: ReadableStream | null;
        contentType: string;
        contentDisposition: string;
      }
    | null
  > {
    const attachment = await this.repo.findAttachmentByIdAndPartnerId(
      attachmentId,
      partnerId,
    );
    if (!attachment) return null;

    if (attachment.storageType !== "R2" || !attachment.attachmentR2Path) {
      if (attachment.externalUrl) {
        return { type: "redirect", redirectUrl: attachment.externalUrl };
      }
      return null;
    }

    const object = await this.c.env.PARTNERS_BUCKET.get(
      attachment.attachmentR2Path,
    );

    if (!object) return null;

    const contentType =
      object.httpMetadata?.contentType || "application/octet-stream";
    const isPreviewable =
      contentType.startsWith("image/") || contentType === "application/pdf";
    const contentDisposition = isPreviewable
      ? "inline"
      : `attachment; filename="${encodeURIComponent(attachment.fileName)}"`;

    return {
      type: "file",
      body: object.body,
      contentType,
      contentDisposition,
    };
  }

  async downloadCsv(query: QueryInput) {
    const data = await this.repo.findMany(query);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "EXPORT_PARTNERS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      recordCount: data.length,
    }),
    );

    const headers = [
      "id",
      "name",
      "type",
      "postalCode",
      "address",
      "phone",
      "fax",
      "creditLimit",
      "closingDay",
      "paymentMonthOffset",
      "paymentDay",
      "paymentMethod",
      "status",
      "memo",
      "qualifiedInvoiceNumber",
      "corporateNumber",
    ];

    const rows = data.map((x) =>
      [
        csvField(`${x.id}`),
        csvField(`${x.name || ""}`),
        csvField(`${x.type || "CUSTOMER"}`),
        csvField(`${x.postalCode || ""}`),
        csvField(`${x.address || ""}`),
        csvField(`${x.phone || ""}`),
        csvField(`${x.fax || ""}`),
        x.creditLimit ?? 0,
        x.closingDay ?? 0,
        x.paymentMonthOffset ?? 0,
        x.paymentDay ?? 0,
        csvField(`${x.paymentMethod || ""}`),
        csvField(`${x.status || "active"}`),
        csvField(`${x.memo || ""}`),
        csvField(`${x.qualifiedInvoiceNumber || ""}`),
        csvField(`${x.corporateNumber || ""}`),
      ].join(","),
    );

    return withBom(buildCsvContent(headers, rows));
  }

  async bulkRegister(file: File) {
    const opId = await this.repo.getFallbackOperatorId(this.c);
    const now = new Date();

    const text = await file.text();
    const allRows = parseCsv(text);

    let successCount = 0;

    // 追加要望L-4-a: 番号の形式は書き込み前に全行を検証する(途中で失敗して一部だけ反映されるのを防ぐ)
    for (const cols of allRows.slice(1)) {
      if (cols.length <= 14 || !cols[0] || !cols[1]) continue;
      const qualified = (cols[14] || "").trim();
      const corporate = (cols[15] || "").trim();
      if (qualified && !/^T\d{13}$/.test(qualified)) {
        throw new BadRequestError(`${cols[0]}: 適格事業者番号は「T」+13桁の数字で指定してください`);
      }
      if (corporate && !/^\d{13}$/.test(corporate)) {
        throw new BadRequestError(`${cols[0]}: 法人番号は13桁の数字で指定してください`);
      }
    }

    for (const cols of allRows.slice(1)) {
      const [
        id,
        name,
        type,
        postalCode,
        address,
        phone,
        fax,
        creditLimit,
        closingDay,
        paymentMonthOffset,
        paymentDay,
        paymentMethod,
        status,
        memo,
        qualifiedInvoiceNumber,
        corporateNumber,
      ] = cols;

      if (!id || !name) continue;

      // 追加要望L-4-a: 番号列(末尾2列)がある新形式CSVのみ反映する(検証は上の事前ループで実施済み)。
      // 旧形式CSVでは既存の番号を変更しない
      const hasNumberColumns = cols.length > 14;
      const normalizedQualified = (qualifiedInvoiceNumber || "").trim();
      const normalizedCorporate = (corporateNumber || "").trim();

      const safeStatus =
        status && status.trim() !== "" ? status.trim() : "active";

      await this.repo.upsertBulkItem(
        {
          id,
          name,
          type: type || "CUSTOMER",
          postalCode: postalCode || null,
          address: address || null,
          phone: phone || null,
          fax: fax || null,
          creditLimit: creditLimit ? Number(creditLimit) : 0,
          closingDay: closingDay ? Number(closingDay) : 0,
          paymentMonthOffset: paymentMonthOffset
            ? Number(paymentMonthOffset)
            : 0,
          paymentDay: paymentDay ? Number(paymentDay) : 0,
          paymentMethod: paymentMethod || null,
          status: safeStatus,
          memo: memo || null,
          ...(hasNumberColumns && {
            qualifiedInvoiceNumber: normalizedQualified || null,
            corporateNumber: normalizedCorporate || null,
          }),
        },
        opId,
        now,
      );
      successCount++;
    }

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "BULK_IMPORT_PARTNERS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
      processedCount: successCount,
    }),
    );

    return {
      success: true,
      message: `CSVから ${successCount} 件の取引先データを同期しました`,
    };
  }
}
