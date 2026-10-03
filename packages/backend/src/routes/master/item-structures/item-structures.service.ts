import { Context } from "hono";
import { ItemStructuresRepository } from "./item-structures.repository";
import {
  GetItemStructuresQuery,
  RegisterItemStructureInput,
} from "./item-structures.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { withBom, buildCsvContent } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import {
  BadRequestError,
  NotFoundError,
} from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { determineItemStructureInitialStatus } from "../../../workflow-engine/settings";
import { SortQuery } from "../../../platform/http/sort";
import { csvField } from "../../../platform/csv/csv-writer";

const RESOURCE_KEY = "master_structures";

export class ItemStructuresService {
  constructor(private repo: ItemStructuresRepository) {}

  async getItemStructures(query: GetItemStructuresQuery, sort?: SortQuery) {
    return await this.repo.findManyWithDetails(query, sort);
  }

  async getItemStructuresPage(
    query: GetItemStructuresQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.findManyWithDetailsPage(query, params, sort),
      this.repo.countManyWithDetails(query),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async registerItemStructure(
    c: Context<{ Bindings: Env }>,
    input: RegisterItemStructureInput,
  ) {
    const parentItemId = input.parentItemId.trim();
    const childItemId = input.childItemId.trim();
    const revision = input.revision?.trim() || "1.0";
    const quantityRequired = Number(input.quantityRequired || 1);
    const now = new Date();
    const validFrom = input.validFrom ? new Date(input.validFrom) : now;
    const validTo = input.validTo ? new Date(input.validTo) : null;
    const memo = input.memo || null;

    if (parentItemId === childItemId) {
      throw new BadRequestError(
        "統制エラー: 自分自身を構成部品(子品目)として登録することはできません",
      );
    }

    const childCheck = await this.repo.findItemById(childItemId);
    if (!childCheck) {
      throw new BadRequestError("指定された子部品が存在しません");
    }
    if (childCheck.status === "suspended") {
      throw new BadRequestError(
        `統制エラー: 子部品「${childCheck.name}」は取引停止状態のため構成に採用できません`,
      );
    }

    const opId = await this.repo.getFallbackOperatorId(c);
    const checkEx = await this.repo.findByParentChildRev(
      parentItemId,
      childItemId,
      revision,
    );

    if (checkEx) {
      const oldSnapshot = { ...checkEx };
      // 💡 承認機能展開: statusが明示指定されていればそれを優先(承認フローの仮ロック/申請時の
      // 最終ステータス指定に使う)。未指定の場合は既存レコードのstatusを維持する
      // (員数等のフィールド編集だけでstatusが意図せず変わらないようにする)
      const nextStatus = input.status || checkEx.status || "temporary";

      await this.repo.update(checkEx.id, {
        quantityRequired,
        validFrom,
        validTo,
        memo,
        status: nextStatus,
        updatedBy: opId,
        updatedAt: now,
      });

      c.executionCtx.waitUntil(
        logAuditEvent(c, "UPDATE_STRUCTURE", RESOURCE_KEY, checkEx.id, oldSnapshot, {
        parentItemId,
        childItemId,
        revision,
        quantityRequired,
        status: nextStatus,
      }),
      );

      return {
        success: true,
        id: checkEx.id,
        message: `リビジョン [${revision}] の構成数量を更新しました`,
      };
    }

    // 💡 承認機能展開: クライアントの送信値は受け付けず、会社設定の承認フラグからサーバー側で
    // 強制する(フロント側が承認申請時に明示的にstatus="temporary"を送ってくる場合はそちらを優先する)
    const status =
      input.status || (await determineItemStructureInitialStatus(c.env.COMPANY_SETTINGS));

    const newId = `BOM-${parentItemId}-${childItemId}-${revision.replace(/\./g, "_")}-${Date.now()}`;
    await this.repo.insert({
      id: newId,
      parentItemId,
      childItemId,
      quantityRequired,
      revision,
      validFrom,
      validTo,
      memo,
      status,
      createdBy: opId,
      createdAt: now,
      updatedBy: opId,
      updatedAt: now,
    });

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_STRUCTURE", RESOURCE_KEY, newId, null, {
      parentItemId,
      childItemId,
      revision,
      quantityRequired,
      status,
    }),
    );

    return {
      success: true,
      id: newId,
      message: `リビジョン [${revision}] の親子構成を新規定義しました`,
    };
  }

  async suspendItemStructure(c: Context<{ Bindings: Env }>, id: string) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();

    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("該当構成レコードが見つかりません");
    }

    await this.repo.updateStatus(id, "suspended", opId, now);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUSPEND_STRUCTURE", RESOURCE_KEY, id, oldSnapshot, {
      status: "suspended",
    }),
    );

    return { success: true, message: "品目構成の定義を無効化しました" };
  }

  async deleteItemStructure(c: Context<{ Bindings: Env }>, id: string) {
    const before = await this.repo.findById(id);
    if (!before) {
      throw new NotFoundError("該当構成レコードが見つかりません");
    }
    // 他マスタ(商品/単位/商品単価等)と同じく、無効化(suspended)を経由した構成のみ
    // 物理削除を許可する(承認待ち・利用中のデータをうっかり削除できてしまう事故を防ぐ)
    if (before.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効化状態の構成定義のみ物理削除できます",
      );
    }

    await this.repo.delete(id);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_STRUCTURE", RESOURCE_KEY, id, { ...before }, null),
    );

    return { success: true, message: "品目構成の定義を削除しました" };
  }

  async downloadCsv(c: Context<{ Bindings: Env }>, query: GetItemStructuresQuery) {
    const list = await this.repo.findAllForCsv(query);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "EXPORT_BOM_CSV", RESOURCE_KEY, "ALL_RECORDS", null, {
      count: list.length,
    }),
    );

    const headers = [
      "id",
      "parentItemId",
      "childItemId",
      "quantityRequired",
      "revision",
      "childUnitPrice",
      "subTotalCost",
      "validFrom",
      "validTo",
      "memo",
      "status",
    ];

    const rows = list.map((x) => {
      const subTotalCost = x.quantityRequired * x.childUnitPrice;
      return [
        csvField(`${x.id}`),
        csvField(`${x.parentItemId}`),
        csvField(`${x.childItemId}`),
        x.quantityRequired,
        csvField(`${x.revision}`),
        x.childUnitPrice,
        subTotalCost,
        csvField(`${x.validFrom ? new Date(x.validFrom).toISOString().split("T")[0] : ""}`),
        csvField(`${x.validTo ? new Date(x.validTo).toISOString().split("T")[0] : ""}`),
        csvField(`${x.memo || ""}`),
        csvField(`${x.status || "active"}`),
      ].join(",");
    });

    return withBom(buildCsvContent(headers, rows));
  }

  async bulkRegisterCsv(c: Context<{ Bindings: Env }>, fileText: string) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();
    let lineIdx = 1;
    let currentId = "不明";

    try {
      const allRows = parseCsv(fileText);

      let count = 0;
      for (const cols of allRows.slice(1)) {
        lineIdx++;
        const [
          id,
          parentItemId,
          childItemId,
          quantityRequired,
          revision,
          validFrom,
          validTo,
          memo,
          status,
        ] = cols;

        if (!parentItemId || !childItemId) continue;
        currentId = `親: ${parentItemId} -> 子: ${childItemId}`;

        if (parentItemId === childItemId) continue;

        const vFrom = validFrom ? new Date(validFrom) : now;
        const vTo = validTo ? new Date(validTo) : null;
        const targetRev = revision || "1.0";
        const targetStatus =
          status === "active" || status === "suspended" ? status : "temporary";

        const pCheck = await this.repo.findItemById(parentItemId);
        const cCheck = await this.repo.findItemById(childItemId);

        if (!pCheck || !cCheck || cCheck.status === "suspended") continue;

        const checkEx = await this.repo.findByParentChildRev(
          parentItemId,
          childItemId,
          targetRev,
        );

        if (checkEx) {
          await this.repo.update(checkEx.id, {
            quantityRequired: Number(quantityRequired || 1),
            validFrom: vFrom,
            validTo: vTo,
            memo: memo || null,
            // statusが明示指定されている行のみ上書きし、未指定なら既存値を維持する
            status: status ? targetStatus : checkEx.status,
            updatedBy: opId,
            updatedAt: now,
          });
        } else {
          const finalId =
            id ||
            `BOM-${parentItemId}-${childItemId}-${targetRev.replace(/\./g, "_")}-${Date.now()}`;
          await this.repo.insert({
            id: finalId,
            parentItemId,
            childItemId,
            quantityRequired: Number(quantityRequired || 1),
            revision: targetRev,
            validFrom: vFrom,
            validTo: vTo,
            memo: memo || null,
            status: targetStatus,
            createdBy: opId,
            createdAt: now,
            updatedBy: opId,
            updatedAt: now,
          });
        }
        count++;
      }

      c.executionCtx.waitUntil(
        logAuditEvent(c, "BULK_IMPORT_BOM_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
        processedCount: count,
      }),
      );

      return {
        success: true,
        message: `CSVから ${count} 件の品目構成(BOM)データを正常に同期しました`,
      };
    } catch (e) {
      throw new BadRequestError(
        `CSV解析エラー(${lineIdx}行目付近 [${currentId}]): データ構造を確認してください`,
      );
    }
  }

  async getActiveParents() {
    return await this.repo.findActiveParents();
  }
}
