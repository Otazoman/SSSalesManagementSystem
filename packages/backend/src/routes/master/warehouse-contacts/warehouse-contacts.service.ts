import { Context } from "hono";
import { WarehouseContactsRepository } from "./warehouse-contacts.repository";
import {
  CreateWarehouseContactInput,
  UpdateWarehouseContactInput,
  QueryInput,
} from "./warehouse-contacts.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { WAREHOUSE_CONTACT_DOCUMENT_TYPES } from "../../../constants/contact-document-types";

const RESOURCE_KEY = "master_warehouses";

// Item6 Phase6-4: 倉庫マスタの複数連絡先(出荷指示書/入荷指示書のOTPダウンロード宛先)。
// 承認ワークフローは持たない(倉庫マスタ本体と異なり、連絡先の追加・変更に承認は不要という判断)
export class WarehouseContactsService {
  private repo: WarehouseContactsRepository;

  constructor(private c: Context<{ Bindings: Env }>) {
    this.repo = new WarehouseContactsRepository(c.env.DB);
  }

  async getList(query: QueryInput) {
    return await this.repo.findMany(query);
  }

  async create(data: CreateWarehouseContactInput) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);

    const targetWarehouse = await this.repo.findWarehouseById(data.warehouseId);
    if (!targetWarehouse) {
      throw new BadRequestError("登録エラー: 指定された倉庫コードがマスタに存在しません");
    }

    const id = crypto.randomUUID();
    // V-5: 帳票の指定が無い場合(旧クライアント等)は、isEmailTargetに従い全帳票/送らない
    const { documentTypes, ...contactData } = data;
    await this.repo.create(
      id,
      contactData,
      documentTypes ?? (data.isEmailTarget ? [...WAREHOUSE_CONTACT_DOCUMENT_TYPES] : []),
      operatorId,
    );

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "CREATE_WAREHOUSE_CONTACT", RESOURCE_KEY, id, null, {
        id,
        warehouseId: data.warehouseId,
        name: data.name,
        email: data.email,
      }),
    );

    return { success: true, message: "連絡先を登録しました" };
  }

  async update(id: string, data: UpdateWarehouseContactInput) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の連絡先が見つかりません");
    }

    await this.repo.update(id, data, operatorId);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "UPDATE_WAREHOUSE_CONTACT", RESOURCE_KEY, id, oldSnapshot, {
        id,
        name: data.name,
        email: data.email,
      }),
    );

    return { success: true, message: "連絡先情報を更新しました" };
  }

  async suspend(id: string) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の連絡先が見つかりません");
    }

    await this.repo.updateStatus(id, "suspended", operatorId, new Date());

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "SUSPEND_WAREHOUSE_CONTACT", RESOURCE_KEY, id, oldSnapshot, {
        id,
        status: "suspended",
      }),
    );

    return { success: true, message: "連絡先を無効化しました" };
  }

  async delete(id: string) {
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("削除対象の連絡先が見つかりません");
    }
    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError("削除拒否: 無効化状態の連絡先のみ物理削除できます");
    }

    await this.repo.delete(id);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "DELETE_WAREHOUSE_CONTACT", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return { success: true, message: "連絡先を削除しました" };
  }
}
