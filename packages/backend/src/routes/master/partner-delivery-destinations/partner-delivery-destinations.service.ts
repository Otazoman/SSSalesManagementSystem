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
import { isPartnerWorkflowGloballyEnabled } from "../../../workflow-engine/settings";
import { ApprovalService } from "../../workflow/approvals/approvals.service";
import { createDb } from "../../../platform/db/create-db";

const RESOURCE_KEY = "master_partners";
// BUG-112: 納品先の承認の申請の種類(承認フローは取引先マスタのものを使う)
const APPROVAL_TARGET_TYPE = "master_delivery_destinations";

// 新規要望(2026-09-23): 取引先マスタの複数納品先(受注の納品先選択で使う)。
// BUG-112(2026-11-20): 取引先の承認が有効な時は、納品先の追加・無効化も承認の申請にする(取引先の承認に含める)
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
    const approvalEnabled = await isPartnerWorkflowGloballyEnabled(this.c.env.COMPANY_SETTINGS);
    await this.repo.create(id, data, operatorId, approvalEnabled ? "temporary" : "active");

    this.c.executionCtx.waitUntil(
      logAuditEvent(this.c, "CREATE_PARTNER_DELIVERY_DESTINATION", RESOURCE_KEY, id, null, {
        id,
        partnerId: data.partnerId,
        name: data.name,
        status: approvalEnabled ? "temporary" : "active",
      }),
    );

    if (approvalEnabled) {
      try {
        await this.requestApproval(id, "REGISTER", { ...data, id, status: "active" }, `取引先の納品先[${data.name}] 追加申請`);
      } catch (err) {
        // 申請できなかった(承認フローが無い等)時は、仮登録の行を残さない
        await this.repo.delete(id);
        throw err;
      }
      return { success: true, id, status: "temporary", message: "納品先を仮登録し、承認を申請しました(承認待ち)" };
    }
    return { success: true, id, status: "active", message: "納品先を登録しました" };
  }

  private async requestApproval(
    id: string,
    requestType: "REGISTER" | "UPDATE",
    payload: Record<string, unknown>,
    comment: string,
  ) {
    const result = await ApprovalService.handleRequestUpdate(this.c, createDb(this.c.env.DB), {
      targetType: APPROVAL_TARGET_TYPE,
      targetId: id,
      requestType,
      payload,
      comment,
      applicantDepartmentSurrogateId: null,
    });
    if (result.status !== 200) {
      throw new BadRequestError(result.data.message || "承認の申請に失敗しました");
    }
  }

  async update(id: string, data: UpdatePartnerDeliveryDestinationInput) {
    const operatorId = await this.repo.getFallbackOperatorId(this.c);
    const oldSnapshot = await this.repo.findById(id);
    if (!oldSnapshot) {
      throw new NotFoundError("対象の納品先が見つかりません");
    }
    if (oldSnapshot.status === "temporary") {
      throw new BadRequestError("この納品先は承認待ちのため、変更できません");
    }

    // BUG-112: 取引先の承認が有効な時は、変更を変更申請にする(承認待ちの間は今の内容のまま temporary にしておく)
    if (await isPartnerWorkflowGloballyEnabled(this.c.env.COMPANY_SETTINGS)) {
      await this.repo.updateStatus(id, "temporary", operatorId, new Date());
      try {
        await this.requestApproval(
          id,
          "UPDATE",
          { ...data, id, partnerId: oldSnapshot.partnerId },
          `取引先の納品先[${data.name}] 変更申請`,
        );
      } catch (err) {
        await this.repo.updateStatus(id, oldSnapshot.status, operatorId, new Date());
        throw err;
      }
      return { success: true, message: "納品先の変更を申請しました(承認待ち)" };
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
    if (oldSnapshot.status === "temporary") {
      throw new BadRequestError("この納品先は承認待ちのため、無効化できません");
    }

    // BUG-112: 取引先の承認が有効な時は、無効化を変更申請にする(承認待ちの間は temporary にしておく)
    if (await isPartnerWorkflowGloballyEnabled(this.c.env.COMPANY_SETTINGS)) {
      await this.repo.updateStatus(id, "temporary", operatorId, new Date());
      try {
        await this.requestApproval(
          id,
          "UPDATE",
          {
            id,
            partnerId: oldSnapshot.partnerId,
            name: oldSnapshot.name,
            postalCode: oldSnapshot.postalCode,
            address: oldSnapshot.address,
            phone: oldSnapshot.phone,
            memo: oldSnapshot.memo,
            status: "suspended",
          },
          `取引先の納品先[${oldSnapshot.name}] 無効化申請`,
        );
      } catch (err) {
        await this.repo.updateStatus(id, oldSnapshot.status, operatorId, new Date());
        throw err;
      }
      return { success: true, message: "納品先の無効化を申請しました(承認待ち)" };
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
