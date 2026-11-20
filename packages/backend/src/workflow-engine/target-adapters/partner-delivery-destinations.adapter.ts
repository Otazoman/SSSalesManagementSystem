/**
 * BUG-112: targetType = "master_delivery_destinations"(取引先の納品先)用の TargetAdapter。
 * 納品先は取引先の承認に含める(2026-11-20 ユーザー確認)。会社設定の取引先の承認のスイッチで申請にし、
 * 承認フローは取引先マスタのメニュー(master_partners)のものを使う(documentKind DELIVERY_DESTINATION で分けられる)。
 * 追加(REGISTER)は仮登録(temporary)の行から始まり、承認で有効にする。無効化は変更申請(UPDATE)として
 * 変更後の状態を退避データに持ち、承認で反映する(承認待ちの間は行を temporary にしておく)。
 */
import { PartnerDeliveryDestinationsRepository } from "../../routes/master/partner-delivery-destinations/partner-delivery-destinations.repository";
import { WorkflowTasksRepository } from "../../routes/workflow/workflow-tasks/workflow-tasks.repository";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import { resolveMasterPreview } from "./master-pending-change";
import type {
  TargetAdapter,
  ApplyApprovedParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
} from "./registry";

async function readSnapshot(db: any, requestId: string): Promise<Record<string, any> | null> {
  const context = await WorkflowTasksRepository.getApprovalContext(db, requestId);
  if (!context?.generalMemo) return null;
  try {
    const snapshot = JSON.parse(context.generalMemo);
    return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}

async function applyApproved({ db, reqParent, userId, now }: ApplyApprovedParams): Promise<void> {
  const repo = PartnerDeliveryDestinationsRepository.fromDb(db);
  const approver = await resolveEmployeeNumberByUserId(db, userId);
  if (reqParent.requestType === "UPDATE") {
    // 変更・無効化の申請: 退避した変更後の内容を反映する(状態は temporary 以外ならその値、無ければ有効)
    const snapshot = await readSnapshot(db, reqParent.id);
    if (snapshot && typeof snapshot.name === "string") {
      await repo.update(
        reqParent.targetId,
        {
          name: snapshot.name,
          postalCode: snapshot.postalCode ?? null,
          address: snapshot.address ?? null,
          phone: snapshot.phone ?? null,
          memo: snapshot.memo ?? null,
          status: snapshot.status && snapshot.status !== "temporary" ? snapshot.status : "active",
        },
        approver,
      );
      return;
    }
  }
  await repo.updateStatus(reqParent.targetId, "active", approver, now);
}

// 差戻し・取下げ: 追加の申請は無効にする(画面から削除できる)。無効化の申請は有効に戻す
async function applyRemanded({ db, reqParent, userId, now }: ApplyApprovedParams): Promise<void> {
  const repo = PartnerDeliveryDestinationsRepository.fromDb(db);
  const operator = await resolveEmployeeNumberByUserId(db, userId);
  await repo.updateStatus(
    reqParent.targetId,
    reqParent.requestType === "REGISTER" ? "suspended" : "active",
    operator,
    now,
  );
}

async function getTaskPreview({ db, requestId, targetId }: TaskPreviewParams): Promise<TaskPreviewResult> {
  const row = await PartnerDeliveryDestinationsRepository.fromDb(db).findById(targetId);
  return {
    targetName: row ? row.name : "不明な納品先",
    previewData: (await resolveMasterPreview(db, requestId, row)).newData,
  };
}

async function getHistoryPreview({
  db,
  requestId,
  targetId,
  requestType,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const row = await PartnerDeliveryDestinationsRepository.fromDb(db).findById(targetId);
  const pending = await resolveMasterPreview(db, requestId, row);
  return {
    targetName: row ? row.name : "不明な納品先",
    snapshotNew: pending.newData,
    snapshotOld: requestType === "UPDATE" ? pending.oldData : null,
  };
}

export const partnerDeliveryDestinationsAdapter: TargetAdapter = {
  async resolveFlowTarget() {
    return { requestType: "master_partners", documentKind: "DELIVERY_DESTINATION" };
  },
  applyApproved,
  applyRemanded,
  getTaskPreview,
  getHistoryPreview,
  // 納品先は取引先マスタの画面(納品先管理)で扱う
  async resolveEditPath() {
    return "/master/partners";
  },
};
