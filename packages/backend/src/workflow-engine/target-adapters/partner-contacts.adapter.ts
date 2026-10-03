/**
 * targetType = "master_contacts" 用のTargetAdapter実装(Item5)。
 * partner_contactsは登録済みidが既にDB上に"temporary"として実在する状態から申請が始まる
 * (quotesのDRAFTと同様の考え方)ため、REGISTER承認確定時は「新規作成」ではなく
 * 「既存temporary行のステータス確定」として扱う。UPDATE(既存有効データの変更申請)は
 * partnersと同じく、承認確定時に退避スナップショット(JSON)の内容を正式反映する。
 */
import { PartnerContactsRepository } from "../../routes/master/partner-contacts/partner-contacts.repository";
import { WorkflowTasksRepository } from "../../routes/workflow/workflow-tasks/workflow-tasks.repository";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import {
  PARTNER_CONTACT_DOCUMENT_TYPES,
  normalizeDocumentTypes,
} from "../../constants/contact-document-types";
import type {
  TargetAdapter,
  ApplyApprovedParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
} from "./registry";

async function applyApproved({
  db,
  reqParent,
  userId,
  now,
}: ApplyApprovedParams): Promise<void> {
  const repo = PartnerContactsRepository.fromDb(db);
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(
    db,
    userId,
  );

  if (reqParent.requestType === "UPDATE") {
    const contextRecord = await WorkflowTasksRepository.getApprovalContext(
      db,
      reqParent.id,
    );
    if (contextRecord && contextRecord.generalMemo) {
      try {
        const snapshot = JSON.parse(contextRecord.generalMemo);
        // 💡 partners.adapter.tsと同じロジック: スナップショットの最終ステータス(例: 無効化申請
        // ならsuspended)をそのまま反映する。以前は無条件でstatus:"active"に固定していたため、
        // 無効化(suspend)申請を承認してもactiveに戻ってしまうバグ(無効化申請が効いていない)
        // になっていた。temporary/未指定の場合のみactiveへフォールバックする。
        const finalStatus =
          snapshot.status && snapshot.status !== "temporary"
            ? snapshot.status
            : "active";
        await repo.update(
          reqParent.targetId,
          {
            partnerId: snapshot.partnerId,
            contactType: snapshot.contactType,
            internalUserId: snapshot.internalUserId ?? null,
            name: snapshot.name ?? null,
            email: snapshot.email ?? null,
            phone: snapshot.phone ?? null,
            fax: snapshot.fax ?? null,
            departmentName: snapshot.departmentName ?? null,
            isEmailTarget: snapshot.isEmailTarget ?? true,
            // V-5: メールで送る帳票。退避データに無い旧い申請では、既存の設定を変えない
            documentTypes: Array.isArray(snapshot.documentTypes)
              ? normalizeDocumentTypes(PARTNER_CONTACT_DOCUMENT_TYPES, snapshot.documentTypes)
              : undefined,
            memo: snapshot.memo ?? null,
            status: finalStatus,
          },
          approverEmployeeNumber,
        );
        return;
      } catch (jsonErr) {
        console.error(
          "取引先担当者マスタ変更申請の退避データのパース・反映に失敗しました:",
          jsonErr,
        );
      }
    }
  }

  await repo.updateStatus(
    reqParent.targetId,
    "active",
    approverEmployeeNumber,
    now,
  );
}

async function getTaskPreview({
  db,
  targetId,
}: TaskPreviewParams): Promise<TaskPreviewResult> {
  const repo = PartnerContactsRepository.fromDb(db);
  const contact = await repo.findById(targetId);
  return {
    targetName: contact ? contact.name || targetId : "不明な担当者",
    previewData: contact,
  };
}

async function getHistoryPreview({
  db,
  targetId,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  const repo = PartnerContactsRepository.fromDb(db);
  const contact = await repo.findById(targetId);
  return {
    targetName: contact ? contact.name || targetId : "不明な担当者",
    snapshotNew: contact,
    snapshotOld: null,
  };
}

export const partnerContactsAdapter: TargetAdapter = {
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
