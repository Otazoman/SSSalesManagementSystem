import { Context } from "hono";
import { PartnerDeliveryDestinationsRepository } from "./partner-delivery-destinations.repository";
import {
  CreatePartnerDeliveryDestinationInput,
  UpdatePartnerDeliveryDestinationInput,
  QueryInput,
} from "./partner-delivery-destinations.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";

const RESOURCE_KEY = "master_partners";

// 新規要望(2026-09-23): 取引先マスタの複数納品先(受注の納品先選択で使う)。
// warehouse-contacts.service.tsと同じ判断で承認ワークフローは持たない
// (納品先の追加・変更に承認は不要)
export class PartnerDeliveryDestinationsService {
  private repo: PartnerDeliveryDestinationsRepository;

  constructor(private c: Context<{ Bindings: Env }>) {
    this.repo = new PartnerDeliveryDestinationsRepository(c.env.DB);
  }

  async getList(query: QueryInput) {
    return await this.repo.findMany(query);
  }

  async create(data: CreatePartnerDeliveryDestinationInput) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);

    const targetPartner = await this.repo.findPartnerById(data.partnerId);
    if (!targetPartner) {
      throw new BadRequestError("登録エラー: 指定された取引先コードがマスタに存在しません");
    }

    const id = crypto.randomUUID();
    await this.repo.create(id, data, operatorId);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "CREATE_PARTNER_DELIVERY_DESTINATION", RESOURCE_KEY, id, null, {
        id,
        partnerId: data.partnerId,
        name: data.name,
      }),
    );

    return { success: true, message: "納品先を登録しました" };
  }

  async update(id: string, data: UpdatePartnerDeliveryDestinationInput) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の納品先が見つかりません");
    }

    await this.repo.update(id, data, operatorId);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "UPDATE_PARTNER_DELIVERY_DESTINATION", RESOURCE_KEY, id, oldSnapshot, {
        id,
        name: data.name,
      }),
    );

    return { success: true, message: "納品先情報を更新しました" };
  }

  async suspend(id: string) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の納品先が見つかりません");
    }

    await this.repo.updateStatus(id, "suspended", operatorId, new Date());

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "SUSPEND_PARTNER_DELIVERY_DESTINATION", RESOURCE_KEY, id, oldSnapshot, {
        id,
        status: "suspended",
      }),
    );

    return { success: true, message: "納品先を無効化しました" };
  }

  async delete(id: string) {
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("削除対象の納品先が見つかりません");
    }
    if (oldSnapshot.status !== "suspended") {
      throw new BadRequestError("削除拒否: 無効化状態の納品先のみ物理削除できます");
    }

    await this.repo.delete(id);

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "DELETE_PARTNER_DELIVERY_DESTINATION", RESOURCE_KEY, id, oldSnapshot, null),
    );

    return { success: true, message: "納品先を削除しました" };
  }
}
