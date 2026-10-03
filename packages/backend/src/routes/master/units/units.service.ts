import { Context } from "hono";
import { UnitsRepository } from "./units.repository";
import { CreateUnitInput, UpdateUnitInput } from "./units.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { withBom, buildCsvContent, csvField } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import {
  BadRequestError,
  NotFoundError,
  isForeignKeyConstraintError,
} from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { determineUnitInitialStatus } from "../../../workflow-engine/settings";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "master_units";

const UNIT_CSV_STATUSES = ["active", "temporary", "suspended"];

export class UnitsService {
  private repo: UnitsRepository;

  constructor(d1: D1Database) {
    this.repo = new UnitsRepository(d1);
  }

  async getAllUnits(status?: string, sort?: SortQuery) {
    return await this.repo.getAllUnits(status, sort);
  }

  async getUnitsPage(params: PaginationParams, status?: string, sort?: SortQuery) {
    const [data, total] = await Promise.all([
      this.repo.getUnitsPage(params, status, sort),
      this.repo.countUnits(status),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async registerUnit(c: Context<{ Bindings: Env }>, input: CreateUnitInput) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();

    // Item5: クライアントの送信値は受け付けず、会社設定の承認フラグからサーバー側で強制する
    const status = await determineUnitInitialStatus(c.env.COMPANY_SETTINGS);

    try {
      await this.repo.createUnit(input, opId, now, status);
    } catch (err) {
      throw new BadRequestError("重複した単位コード、または不正な入力です");
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_UNIT", RESOURCE_KEY, input.code, null, {
      code: input.code,
      name: input.name,
      status,
    }),
    );

    return { status };
  }

  async suspendUnit(c: Context<{ Bindings: Env }>, code: string) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();

    const oldSnapshot = await this.repo.findUnitByCode(code);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の単位が見つかりません");
    }

    await this.repo.updateStatus(code, "suspended", opId, now);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUSPEND_UNIT", RESOURCE_KEY, code, oldSnapshot, {
      code,
      status: "suspended",
    }),
    );
  }

  async updateUnit(
    c: Context<{ Bindings: Env }>,
    code: string,
    input: UpdateUnitInput,
  ) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();

    const oldSnapshot = await this.repo.findUnitByCode(code);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の単位が見つかりません");
    }

    await this.repo.updateUnit(code, input, opId, now);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_UNIT", RESOURCE_KEY, code, oldSnapshot, {
      code: code,
      name: input.name,
    }),
    );
  }

  async deleteUnit(c: Context<{ Bindings: Env }>, code: string) {
    const oldSnapshot = await this.repo.findUnitByCode(code);

    if (!oldSnapshot) {
      throw new NotFoundError("削除対象の単位が見つかりません");
    }

    // Item5: partners.purge()と同じ制約。無効化(suspended)済みのデータのみ物理削除できる
    // (仮登録/承認待ち・利用中のデータをうっかり削除できてしまう事故を防ぐ)
    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効化状態の単位のみ物理削除できます",
      );
    }

    try {
      await this.repo.deleteUnit(code);
    } catch (err) {
      if (isForeignKeyConstraintError(err)) {
        throw new BadRequestError(
          "この単位は、すでに品目マスタ等で参照されているため削除できません",
        );
      }
      throw err;
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_UNIT", RESOURCE_KEY, code, oldSnapshot, null),
    );
  }

  async exportCsv() {
    const data = await this.repo.getAllUnits();
    const headers = ["code", "name"];

    const rows = data.map((u: any) => {
      const codeVal = u.code ? String(u.code).toUpperCase().trim() : "";
      const nameVal = u.name ? String(u.name).trim() : "";
      return [csvField(codeVal), csvField(nameVal)].join(",");
    });

    return withBom(buildCsvContent(headers, rows));
  }

  async importCsv(c: Context<{ Bindings: Env }>) {
    const operatorId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();

    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      throw new BadRequestError("ファイルがありません");
    }

    const text = await file.text();

    const allLines = parseCsv(text);
    if (allLines.length <= 1) {
      return 0;
    }

    const headers = allLines[0].map((h) => h.toLowerCase().trim());
    const idxCode = headers.findIndex((h) => h === "code");
    const idxName = headers.findIndex((h) => h === "name");
    // status 列は任意(他のマスタの CSV と同じ)。空欄・列なしの場合は、新規は画面の登録と同じく
    // 承認機能の有効/無効で決め(無効なら有効)、既存は今の状態のままにする
    const idxStatus = headers.findIndex((h) => h === "status");

    if (idxCode === -1 || idxName === -1) {
      throw new BadRequestError(
        "CSVのヘッダーに 'code' または 'name' が見つかりません",
      );
    }

    const parsedRows = [];
    const allCodes: string[] = [];

    for (const cols of allLines.slice(1)) {
      if (cols.length <= idxCode || !cols[idxCode]) continue;

      const code = cols[idxCode].trim().toUpperCase();
      const name = cols[idxName] ? cols[idxName].trim() : "";
      const rawStatus = idxStatus === -1 ? "" : (cols[idxStatus] ?? "").trim().toLowerCase();
      const status = UNIT_CSV_STATUSES.includes(rawStatus) ? rawStatus : null;

      if (!code || code === "CODE" || !name) continue;

      parsedRows.push({ code, name, status });
      allCodes.push(code);
    }

    if (parsedRows.length === 0) {
      return 0;
    }

    const existingCodeSet = await this.repo.findExistingCodes(allCodes);
    const initialStatus = await determineUnitInitialStatus(c.env.COMPANY_SETTINGS);
    let successCount = 0;

    for (const row of parsedRows) {
      const isExisting = existingCodeSet.has(row.code);
      await this.repo.upsertUnitFromCsv(
        { code: row.code, name: row.name, status: row.status ?? (isExisting ? null : initialStatus) },
        isExisting,
        operatorId,
        now,
      );
      successCount++;
    }

    try {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "IMPORT_UNITS_CSV", RESOURCE_KEY, `BULK_${successCount}`, null, {
        count: successCount,
      }),
      );
    } catch (e) {}

    return successCount;
  }
}
