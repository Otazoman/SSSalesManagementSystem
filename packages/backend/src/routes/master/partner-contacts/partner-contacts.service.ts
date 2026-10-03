import { Context } from "hono";
import { PartnerContactsRepository } from "./partner-contacts.repository";
import {
  CreateContactInput,
  UpdateContactInput,
  QueryInput,
} from "./partner-contacts.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { withBom, buildCsvContent } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { determinePartnerContactInitialStatus } from "../../../workflow-engine/settings";
import { generateUniqueMasterCode } from "../../../platform/id/resolve-master-id";
import { SortQuery } from "../../../platform/http/sort";
import {
  PARTNER_CONTACT_DOCUMENT_TYPES,
  normalizeDocumentTypes,
  type PartnerContactDocumentType,
} from "../../../constants/contact-document-types";
import { csvField } from "../../../platform/csv/csv-writer";

const RESOURCE_KEY = "master_contacts";

// V-5: 帳票の指定が無い新規担当者の既定。従来の「メール送信対象」フラグに従う(ONなら全帳票)
function defaultDocumentTypes(isEmailTarget: boolean): PartnerContactDocumentType[] {
  return isEmailTarget ? [...PARTNER_CONTACT_DOCUMENT_TYPES] : [];
}

// CSVの帳票列の区切り(カンマはCSVの区切りと衝突するため使わない)。取込では「:」「;」のどちらも受け付ける
const DOCUMENT_TYPES_CSV_SEPARATOR = ":";
const DOCUMENT_TYPES_HEADER = "documentTypes";

function parseDocumentTypesCell(cell: string, rowNo: number): PartnerContactDocumentType[] {
  const keys = cell
    .split(/[:;]/)
    .map((k) => k.trim())
    .filter((k) => k !== "");
  const invalid = keys.find((k) => !(PARTNER_CONTACT_DOCUMENT_TYPES as readonly string[]).includes(k));
  if (invalid) {
    throw new BadRequestError(
      `CSVの${rowNo}行目: 帳票の指定「${invalid}」は不正です(指定できる値: ${PARTNER_CONTACT_DOCUMENT_TYPES.join(", ")})`,
    );
  }
  return normalizeDocumentTypes(PARTNER_CONTACT_DOCUMENT_TYPES, keys);
}

export class PartnerContactsService {
  private repo: PartnerContactsRepository;

  constructor(private c: Context<{ Bindings: Env }>) {
    this.repo = new PartnerContactsRepository(c.env.DB);
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

  async create(data: CreateContactInput) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);

    const targetPartner = await this.repo.findPartnerById(data.partnerId);
    if (!targetPartner) {
      throw new BadRequestError(
        "登録エラー: 指定された取引先コードがマスタに存在しません",
      );
    }

    if (targetPartner.status === "suspended") {
      throw new BadRequestError(
        `登録拒否: 取引先「${targetPartner.name}」は現在取引停止中のため、新しく担当者を登録することはできません`,
      );
    }

    // Item5: クライアントの送信値は受け付けず、会社設定の承認フラグからサーバー側で強制する
    const status = await determinePartnerContactInitialStatus(
      this.c.env.COMPANY_SETTINGS,
    );

    // マスタコード自動採番: コード未入力時のみmaster_code_formatsの設定に基づき自動採番する
    const resolvedId =
      data.id?.trim() ||
      (await generateUniqueMasterCode(this.c, "partner_contacts", (id) =>
        this.repo.findById(id).then((r) => !!r),
      ));
    const { documentTypes, ...contactData } = data;
    const resolvedData = { ...contactData, id: resolvedId };

    // V-5: 帳票の指定が無い場合(旧クライアント等)は、isEmailTargetに従い全帳票/送らない
    await this.repo.create(
      resolvedData,
      documentTypes ?? defaultDocumentTypes(data.isEmailTarget),
      operatorId,
      status,
    );

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "CREATE_PARTNER_CONTACT", RESOURCE_KEY, resolvedId, null, {
      id: resolvedId,
      partnerId: data.partnerId,
      contactType: data.contactType,
      name: data.name,
      email: data.email,
      status,
    }),
    );

    return { success: true, message: "担当者を登録しました", status, id: resolvedId };
  }

  async suspend(id: string) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の担当者が見つかりません");
    }

    await this.repo.updateStatus(id, "suspended", operatorId, new Date());

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "SUSPEND_PARTNER_CONTACT", RESOURCE_KEY, id, oldSnapshot, {
      id,
      status: "suspended",
    }),
    );

    return { success: true, message: "担当者を無効化しました" };
  }

  async update(id: string, data: UpdateContactInput) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);
    const oldSnapshot = await this.repo.findById(id);

    await this.repo.update(id, data, operatorId);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "UPDATE_PARTNER_CONTACT", RESOURCE_KEY, id, oldSnapshot, {
      id,
      partnerId: data.partnerId,
      contactType: data.contactType,
      name: data.name,
      email: data.email,
    }),
    );

    return { success: true, message: "担当者情報を更新しました" };
  }

  async delete(id: string) {
    const oldSnapshot = await this.repo.findById(id);

    if (!oldSnapshot) {
      throw new NotFoundError("削除対象の担当者が見つかりません");
    }

    // Item5: partners.purge()と同じ制約。無効化(suspended)済みのデータのみ物理削除できる
    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効化状態の担当者のみ物理削除できます",
      );
    }

    await this.repo.delete(id);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "DELETE_PARTNER_CONTACT", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return { success: true, message: "担当者を削除しました" };
  }

  async downloadCsv(query: QueryInput) {
    const data = await this.repo.findMany(query);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "EXPORT_PARTNER_CONTACTS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      recordCount: data.length,
    }),
    );

    const headers = [
      "id",
      "partnerId",
      "contactType",
      "internalUserId",
      "name",
      "email",
      "phone",
      "fax",
      "departmentName",
      "isEmailTarget",
      "memo",
      DOCUMENT_TYPES_HEADER,
    ];

    const rows = data.map((x) =>
      [
        csvField(`${x.id}`),
        csvField(`${x.partnerId}`),
        csvField(`${x.contactType}`),
        csvField(`${x.internalUserId || ""}`),
        csvField(`${x.name || ""}`),
        csvField(`${x.email || ""}`),
        csvField(`${x.phone || ""}`),
        csvField(`${x.fax || ""}`),
        csvField(`${x.departmentName || ""}`),
        x.isEmailTarget ? 1 : 0,
        csvField(`${x.memo || ""}`),
        csvField(`${x.documentTypes.join(DOCUMENT_TYPES_CSV_SEPARATOR)}`),
      ].join(","),
    );

    return withBom(buildCsvContent(headers, rows));
  }

  async bulkRegister(file: File) {
    const opId = await this.repo.getFallbackOperatorId(this.c);
    const now = new Date();

    const text = await file.text();
    const allRows = parseCsv(text);

    const partnerStatusMap = await this.repo.getAllPartnerStatusMap();

    // V-5: 帳票列(documentTypes)がある場合はその内容で置き換える(空欄=どの帳票も送らない)。
    // 列が無い旧形式のCSVでは、既存の担当者は帳票の設定を変えず、新規の担当者はisEmailTargetに従う。
    // 不正な帳票の指定は、1件も書き込む前にエラーにする
    const documentTypesColumn = allRows[0]?.findIndex((h) => h.trim() === DOCUMENT_TYPES_HEADER) ?? -1;
    const documentTypesByRow = new Map<number, PartnerContactDocumentType[]>();
    if (documentTypesColumn >= 0) {
      allRows.slice(1).forEach((cols, index) => {
        documentTypesByRow.set(index, parseDocumentTypesCell(cols[documentTypesColumn] ?? "", index + 2));
      });
    }
    const existingIds = await this.repo.findAllIds();
    // BUG-008: 新規の担当者は、画面の登録と同じく承認機能の有効/無効で状態を決める(無効なら有効)。
    // 以前は状態を設定せず、DB の既定値(仮登録)で登録されていた
    const initialStatus = await determinePartnerContactInitialStatus(this.c.env.COMPANY_SETTINGS);

    let successCount = 0;
    let skipCount = 0;
    const skipDetails: string[] = [];

    for (const [rowIndex, cols] of allRows.slice(1).entries()) {
      const [
        id,
        partnerId,
        contactType,
        internalUserId,
        name,
        email,
        phone,
        fax,
        departmentName,
        isEmailTarget,
        memo,
      ] = cols;

      if (!id || !partnerId || !contactType) continue;

      const partnerInfo = partnerStatusMap.get(partnerId);
      if (!partnerInfo) continue;

      if (partnerInfo.status === "suspended") {
        const isExisting = await this.repo.findById(id);
        if (!isExisting) {
          skipCount++;
          if (skipDetails.length < 3)
            skipDetails.push(`${id}(${partnerInfo.name})`);
          continue;
        }
      }

      await this.repo.upsertBulkItem(
        {
          id,
          partnerId,
          contactType,
          internalUserId: internalUserId || null,
          name: name || null,
          email: email || null,
          phone: phone || null,
          fax: fax || null,
          departmentName: departmentName || null,
          isEmailTarget: isEmailTarget === "1",
          memo: memo || null,
          status: initialStatus,
        },
        opId,
        now,
        documentTypesColumn >= 0
          ? documentTypesByRow.get(rowIndex)
          : existingIds.has(id)
            ? undefined
            : defaultDocumentTypes(isEmailTarget === "1"),
      );
      successCount++;
    }

    this.c.executionCtx.waitUntil(
      logAuditEvent(
      this.c,
      "BULK_IMPORT_PARTNER_CONTACTS_CSV",
      RESOURCE_KEY,
      "BULK_OPERATION",
      null,
      {
        processedCount: successCount,
        skippedSuspendedCount: skipCount,
      },
    ),
    );

    let returnMessage = `CSVから ${successCount} 件の担当者データを同期しました。`;
    if (skipCount > 0) {
      returnMessage += ` なお、取引停止中のアカウントに紐づく新規担当者 ${skipCount} 件 [対象コード例: ${skipDetails.join(", ")}] の追加処理をビジネスロジックに基づき安全にスキップしました。`;
    }

    return { success: true, message: returnMessage };
  }
}
