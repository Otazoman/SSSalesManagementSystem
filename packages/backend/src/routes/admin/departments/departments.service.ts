import { Context } from "hono";
import {
  DepartmentsRepository,
  DepartmentWithParent,
  DepartmentRecord,
  DepartmentCsvRow,
} from "./departments.repository";
import { getActiveDepartmentById } from "../../../utils/department";
import { writeAuditLog } from "../../../utils/logger";
import { checkAuditLogEnabled } from "../../../utils/auditcheck";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { toCsvBytes, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import {
  CreateDepartmentInput,
  UpdateDepartmentInput,
} from "./departments.schema";
import { BadRequestError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "admin_departments";

function toDepartmentDto(row: DepartmentWithParent) {
  return {
    surrogateId: row.surrogateId,
    id: row.id,
    name: row.name,
    parentDepartmentId:
      row.parentHumanId || row.parentDepartmentSurrogateId || null,
    parentDepartmentSurrogateId: row.parentDepartmentSurrogateId || null,
    memo: row.memo || null,
    validFrom: row.validFrom,
    validTo: row.validTo || null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export class DepartmentsService {
  private repo: DepartmentsRepository;

  constructor(env: Env) {
    this.repo = new DepartmentsRepository(env);
  }

  // 1. 一覧取得
  async getDepartments(
    status?: string,
    filter?: string,
    targetDateParam?: string,
    sort?: SortQuery,
  ) {
    const results: DepartmentWithParent[] = await this.repo.findDepartments(
      status,
      filter,
      targetDateParam,
      sort,
    );

    return results.map(toDepartmentDto);
  }

  async getDepartmentsPage(
    status: string | undefined,
    filter: string | undefined,
    targetDateParam: string | undefined,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [results, total] = await Promise.all([
      this.repo.findDepartmentsPage(status, filter, targetDateParam, params, sort),
      this.repo.countDepartments(status, filter, targetDateParam),
    ]);
    return buildListResponse(results.map(toDepartmentDto), buildPaginationMeta(params, total));
  }

  // 2. 個別追加
  async createDepartment(
    c: Context<{ Bindings: Env }>,
    body: CreateDepartmentInput,
  ) {
    const now = new Date();
    const db = this.repo.getDbInstance();
    const opId = await this.repo.getFallbackOperatorId(c);

    const validFromDate = body.validFrom ?? now;
    const validToDate = body.validTo ?? null;
    const newSurrogateId = String(crypto.randomUUID());

    const parentDept = body.parentDepartmentId
      ? await getActiveDepartmentById(
          db,
          String(body.parentDepartmentId),
          validFromDate,
        )
      : null;

    await this.repo.insertDepartment({
      surrogateId: newSurrogateId,
      id: body.id.trim(),
      name: body.name.trim(),
      parentDepartmentSurrogateId: parentDept?.surrogateId
        ? String(parentDept.surrogateId)
        : null,
      memo: body.memo ? body.memo.trim() : null,
      validFrom: validFromDate,
      validTo: validToDate,
      createdBy: opId,
      createdAt: now,
      updatedBy: opId,
      updatedAt: now,
    });

    await logAuditEvent(c, "CREATE_DEPARTMENT", RESOURCE_KEY, newSurrogateId, null, {
      id: body.id.trim(),
      name: body.name.trim(),
      parentDepartmentId: body.parentDepartmentId ?? null,
      validFrom: validFromDate,
    });

    return { success: true, message: "部署マスタを追加しました" };
  }

  // 3. 変更
  async updateDepartment(
    c: Context<{ Bindings: Env }>,
    idOrSurrogate: string,
    body: UpdateDepartmentInput,
  ) {
    const now = new Date();
    const db = this.repo.getDbInstance();
    const opId = await this.repo.getFallbackOperatorId(c);

    const validFromDate = body.validFrom ?? now;
    const validToDate = body.validTo ?? null;

    const activeDept = await getActiveDepartmentById(db, idOrSurrogate, now);
    const targetSurrogateId = activeDept
      ? activeDept.surrogateId
      : idOrSurrogate;
    const targetHumanId = activeDept ? activeDept.id : idOrSurrogate;

    const oldSnapshot = await this.repo.findBySurrogateId(targetSurrogateId);

    const proposedParentHumanId = body.parentDepartmentId
      ? body.parentDepartmentId.trim()
      : null;

    if (proposedParentHumanId) {
      const allDepartments: DepartmentRecord[] = await this.repo.findAll();
      const getChildIdsRecursive = (currentId: string): Set<string> => {
        const childIds = new Set<string>();
        const findChildren = (parentId: string) => {
          const children = allDepartments.filter((d: DepartmentRecord) => {
            const parentRec = allDepartments.find(
              (p: DepartmentRecord) =>
                p.surrogateId === d.parentDepartmentSurrogateId,
            );
            return parentRec && parentRec.id === parentId;
          });
          children.forEach((child: DepartmentRecord) => {
            if (!childIds.has(child.id)) {
              childIds.add(child.id);
              findChildren(child.id);
            }
          });
        };
        findChildren(currentId);
        return childIds;
      };

      const currentChildrenSet = getChildIdsRecursive(targetHumanId);
      if (currentChildrenSet.has(proposedParentHumanId)) {
        throw new BadRequestError("エラー: 組織階層のループが検出されました");
      }
    }

    const parentDept = proposedParentHumanId
      ? await getActiveDepartmentById(db, proposedParentHumanId, validFromDate)
      : null;

    await this.repo.updateDepartment(targetSurrogateId, {
      id: (body.id || idOrSurrogate).trim(),
      name: body.name.trim(),
      parentDepartmentSurrogateId: parentDept?.surrogateId
        ? String(parentDept.surrogateId)
        : null,
      memo: body.memo ? body.memo.trim() : null,
      validFrom: validFromDate,
      validTo: validToDate,
      updatedBy: opId,
      updatedAt: now,
    });

    await logAuditEvent(
      c,
      "UPDATE_DEPARTMENT",
      RESOURCE_KEY,
      targetSurrogateId,
      oldSnapshot,
      {
        id: body.id,
        name: body.name,
        parentDepartmentId: body.parentDepartmentId ?? null,
        validFrom: validFromDate,
        validTo: validToDate,
      },
    );

    return { success: true, message: "部署情報を変更しました" };
  }

  // 4. 無効化
  async suspendDepartment(
    c: Context<{ Bindings: Env }>,
    idOrSurrogate: string,
  ) {
    const now = new Date();
    const db = this.repo.getDbInstance();
    const opId = await this.repo.getFallbackOperatorId(c);

    // 過去に無効化された部署も復元/再操作できるように、無効化対象の判定は「現在まで有効なもの」またはサロゲートキー直接指定を許容
    const activeDept = await getActiveDepartmentById(db, idOrSurrogate, now);
    const targetSurrogateId = activeDept
      ? activeDept.surrogateId
      : idOrSurrogate;

    const oldSnapshot = await this.repo.findBySurrogateId(targetSurrogateId);

    // 【修正点】即時無効化（廃止）とするため、validTo に現在時刻 (now) をセットする
    // (※業務要件で「本日いっぱいは有効」とする場合は 23:59:59.999 に設定してください)
    const disableValidTo = now;

    await this.repo.updateDepartment(targetSurrogateId, {
      validTo: disableValidTo,
      updatedBy: opId,
      updatedAt: now,
    });

    await logAuditEvent(
      c,
      "SUSPEND_DEPARTMENT",
      RESOURCE_KEY,
      targetSurrogateId,
      oldSnapshot,
      { validTo: disableValidTo },
    );

    return { success: true, message: "部署を無効化しました" };
  }

  // 5. 復元
  async restoreDepartment(
    c: Context<{ Bindings: Env }>,
    idOrSurrogate: string,
  ) {
    const now = new Date();
    const db = this.repo.getDbInstance();
    const opId = await this.repo.getFallbackOperatorId(c);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const activeDept = await getActiveDepartmentById(db, idOrSurrogate, now);
    const targetSurrogateId = activeDept
      ? activeDept.surrogateId
      : idOrSurrogate;

    const oldSnapshot = await this.repo.findBySurrogateId(targetSurrogateId);

    await this.repo.updateDepartment(targetSurrogateId, {
      validFrom: todayStart,
      validTo: null,
      updatedBy: opId,
      updatedAt: now,
    });

    await logAuditEvent(
      c,
      "RESTORE_DEPARTMENT",
      RESOURCE_KEY,
      targetSurrogateId,
      oldSnapshot,
      { validFrom: todayStart, validTo: null },
    );

    return { success: true, message: "部署を無期限として復元しました" };
  }

  // 6. CSVダウンロード
  async generateCsv(
    c: Context<{ Bindings: Env }>,
    status?: string,
    filter?: string,
    targetDateParam?: string,
  ) {
    const result: DepartmentCsvRow[] = await this.repo.findForCsvExport(
      status,
      filter,
      targetDateParam,
    );

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_DEPARTMENTS_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      recordCount: result.length,
    }),
    );

    const headers = [
      "id",
      "name",
      "parentDepartmentId",
      "memo",
      "validFrom",
      "validTo",
    ];

    const rows = result.map((d: DepartmentCsvRow) => {
      let fromStr = "";
      if (d.validFrom) {
        fromStr =
          d.validFrom instanceof Date
            ? d.validFrom.toISOString().split("T")[0]
            : String(d.validFrom).split("T")[0];
      }

      let toStr = "";
      if (d.validTo) {
        toStr =
          d.validTo instanceof Date
            ? d.validTo.toISOString().split("T")[0]
            : String(d.validTo).split("T")[0];
      }

      const cleanId = csvField(d.id || "");
      const cleanName = csvField(d.name || "");
      const cleanParentId = csvField(d.parentHumanId || "");
      const cleanMemo = csvField(d.memo || "");
      const cleanFrom = csvField(fromStr);
      const cleanTo = csvField(toStr);

      return [
        cleanId,
        cleanName,
        cleanParentId,
        cleanMemo,
        cleanFrom,
        cleanTo,
      ].join(",");
    });

    return toCsvBytes(buildCsvContent(headers, rows));
  }

  // 7. CSV一括インポート
  async bulkRegister(c: Context<{ Bindings: Env }>, file: File) {
    const now = new Date();
    const opId = await this.repo.getFallbackOperatorId(c);

    const text = await file.text();
    const allRows = parseCsv(text);

    if (allRows.length <= 1) {
      throw new BadRequestError("インポートするデータがありません");
    }

    if (
      allRows[0].join(",") !==
      "id,name,parentDepartmentId,memo,validFrom,validTo"
    ) {
      throw new BadRequestError("CSVヘッダー書式が正しくありません");
    }

    const dataRows = allRows.slice(1);
    const parsedRows = [];
    const initialDepts: DepartmentRecord[] = await this.repo.findAll();

    for (const columns of dataRows) {
      const [id, name, parentDepartmentId, memo, validFrom, validTo] = columns;
      if (!id || !name) continue;

      const cleanId = id.trim();
      const cleanName = name.trim();
      const cleanParentId = parentDepartmentId?.trim() || null;
      const cleanMemo = memo?.trim() || null;

      const csvFromDate = validFrom ? new Date(validFrom) : now;
      const csvToDate = validTo ? new Date(validTo) : null;

      const existingExactPeriodDept = initialDepts.find(
        (d: DepartmentRecord) =>
          d.id === cleanId &&
          new Date(d.validFrom).getTime() === csvFromDate.getTime(),
      );

      let finalSurrogateId = "";

      if (existingExactPeriodDept) {
        finalSurrogateId = existingExactPeriodDept.surrogateId;
        await this.repo.updateDepartment(finalSurrogateId, {
          name: cleanName,
          memo: cleanMemo,
          validTo: csvToDate,
          updatedBy: opId,
          updatedAt: now,
        });
      } else {
        finalSurrogateId = String(crypto.randomUUID());
        await this.repo.insertDepartment({
          surrogateId: finalSurrogateId,
          id: cleanId,
          name: cleanName,
          parentDepartmentSurrogateId: null,
          memo: cleanMemo,
          validFrom: csvFromDate,
          validTo: csvToDate,
          createdBy: opId,
          createdAt: now,
          updatedBy: opId,
          updatedAt: now,
        });
      }

      parsedRows.push({
        surrogateId: finalSurrogateId,
        id: cleanId,
        name: cleanName,
        parentDepartmentId: cleanParentId,
        csvFromDate,
      });
    }

    const allLatestDepts: DepartmentRecord[] = await this.repo.findAll();
    let successCount = 0;
    const isAuditEnabled = await checkAuditLogEnabled(c.env.COMPANY_SETTINGS);

    for (const row of parsedRows) {
      let parentSurrogateId: string | null = null;

      if (row.parentDepartmentId && row.parentDepartmentId !== "") {
        const targetTime = row.csvFromDate.getTime();

        const matchedParent = allLatestDepts.find((d: DepartmentRecord) => {
          if (d.id !== row.parentDepartmentId) return false;

          const pFrom = new Date(d.validFrom).getTime();
          const isFromValid = pFrom <= targetTime;
          const isToValid =
            d.validTo === null || new Date(d.validTo).getTime() >= targetTime;

          return isFromValid && isToValid;
        });

        parentSurrogateId = matchedParent ? matchedParent.surrogateId : null;
      }

      await this.repo.updateDepartment(row.surrogateId, {
        parentDepartmentSurrogateId: parentSurrogateId,
        updatedBy: opId,
        updatedAt: now,
      });

      const currentFinal = allLatestDepts.find(
        (d: DepartmentRecord) => d.surrogateId === row.surrogateId,
      );

      await writeAuditLog(
        c,
        "BULK_IMPORT_DEPARTMENT",
        RESOURCE_KEY,
        row.surrogateId,
        null,
        currentFinal,
        isAuditEnabled,
      );
      successCount++;
    }

    return {
      success: true,
      message: `CSVから ${successCount} 件の組織マスタ(期間リレーション含む)を完全同期しました`,
    };
  }
}
