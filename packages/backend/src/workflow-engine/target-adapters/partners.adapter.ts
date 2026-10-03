/**
 * targetType = "master_partners" 用のTargetAdapter実装。
 * approvals.service.ts / workflow-tasks.service.ts に直接ハードコードされていた
 * partners専用ロジックを、内容を変更せずそのままここへ移設したもの。
 */
import { ApprovalRepository } from "../../routes/workflow/approvals/approvals.repository";
import { WorkflowTasksRepository } from "../../routes/workflow/workflow-tasks/workflow-tasks.repository";
import { NotFoundError } from "../../platform/http/http-error";
import { resolveEmployeeNumberByUserId } from "../../platform/repository/fallback-operator";
import type {
  TargetAdapter,
  ResolveAmountParams,
  ApplyApprovedParams,
  TaskPreviewParams,
  TaskPreviewResult,
  HistoryPreviewParams,
  HistoryPreviewResult,
} from "./registry";

// 移設元: approvals.service.ts handleRequestUpdate() の targetType==="master_partners" 分岐
async function resolveAmount({
  db,
  targetId,
  isRegister,
  payload,
}: ResolveAmountParams): Promise<number> {
  if (!isRegister) {
    const currentPartner = await ApprovalRepository.findPartnerById(
      db,
      targetId,
    );

    if (!currentPartner) {
      throw new NotFoundError("対象の取引先レコードが存在しません");
    }

    return payload.creditLimit !== undefined
      ? Number(payload.creditLimit)
      : Number(currentPartner.creditLimit || 0);
  }

  return payload.creditLimit !== undefined ? Number(payload.creditLimit) : 0;
}

// 移設元: workflow-tasks.service.ts の private static applyFinalPartnerData()
async function applyApproved({
  db,
  reqParent,
  userId,
  now,
}: ApplyApprovedParams): Promise<void> {
  // Item1: userId/applicantId(ともにusers.id、承認ルーティングのFKとして維持)を、
  // 純粋な監査用フィールドであるupdatedBy/uploadedByIdへ書き込む直前にemployeeNumberへ変換する
  const approverEmployeeNumber = await resolveEmployeeNumberByUserId(
    db,
    userId,
  );
  const applicantEmployeeNumber = await resolveEmployeeNumberByUserId(
    db,
    reqParent.applicantId,
  );

  const contextRecord = await WorkflowTasksRepository.getApprovalContext(
    db,
    reqParent.id,
  );

  if (contextRecord && contextRecord.generalMemo) {
    try {
      const updatedPayload = JSON.parse(contextRecord.generalMemo);
      let finalStatus = "active";

      if (reqParent.requestType === "UPDATE") {
        const reqStatus = updatedPayload.status;
        if (reqStatus && reqStatus !== "temporary" && reqStatus !== "active") {
          finalStatus = reqStatus;
        } else {
          finalStatus = "active";
        }
      }

      await WorkflowTasksRepository.updatePartner(db, reqParent.targetId, {
        name: updatedPayload.name,
        type: updatedPayload.type,
        postalCode: updatedPayload.postalCode || null,
        address: updatedPayload.address || null,
        phone: updatedPayload.phone || updatedPayload.tel || null,
        fax: updatedPayload.fax || null,
        creditLimit: Number(updatedPayload.creditLimit || 0),
        closingDay:
          updatedPayload.closingDay !== undefined &&
          updatedPayload.closingDay !== ""
            ? Number(updatedPayload.closingDay)
            : null,
        paymentMonthOffset:
          updatedPayload.paymentMonthOffset !== undefined &&
          updatedPayload.paymentMonthOffset !== ""
            ? Number(updatedPayload.paymentMonthOffset)
            : null,
        paymentDay:
          updatedPayload.paymentDay !== undefined &&
          updatedPayload.paymentDay !== ""
            ? Number(updatedPayload.paymentDay)
            : null,
        paymentMethod: updatedPayload.paymentMethod || null,
        // 追加要望L-4-a: 承認時に申請内容(snapshot)の番号を反映する。項目を含まない申請
        // (この項目の追加前に提出された申請等)では既存の値を消さないよう、指定時のみ更新する
        ...(updatedPayload.qualifiedInvoiceNumber !== undefined && {
          qualifiedInvoiceNumber: updatedPayload.qualifiedInvoiceNumber || null,
        }),
        ...(updatedPayload.corporateNumber !== undefined && {
          corporateNumber: updatedPayload.corporateNumber || null,
        }),
        antiSocialCheckStatus:
          contextRecord.antiSocialCheckStatus ||
          updatedPayload.antiSocialCheckStatus ||
          "UNCHECKED",
        antiSocialCheckMemo:
          contextRecord.antiSocialCheckMemo ||
          updatedPayload.antiSocialCheckMemo ||
          null,
        contractDate: updatedPayload.contractDate
          ? new Date(updatedPayload.contractDate)
          : null,
        contractValidTo: updatedPayload.contractValidTo
          ? new Date(updatedPayload.contractValidTo)
          : null,
        status: finalStatus,
        updatedBy: approverEmployeeNumber,
        updatedAt: now,
      });

      if (
        reqParent.requestType === "REGISTER" &&
        updatedPayload.attachments &&
        Array.isArray(updatedPayload.attachments)
      ) {
        for (const att of updatedPayload.attachments) {
          await WorkflowTasksRepository.insertPartnerAttachment(db, {
            id:
              att.id ||
              `ATT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            partnerId: reqParent.targetId,
            fileName: att.fileName,
            storageType: att.storageType || "R2",
            attachmentR2Path: att.attachmentR2Path || null,
            externalUrl: att.externalUrl || null,
            fileType: att.fileType || "OTHER",
            uploadedById: applicantEmployeeNumber,
            uploadedAt: now,
          });
        }
      }

      // ➕ ファームバンキング: 振込先口座(添付ファイルと同じくREGISTER時のみここで反映する)
      if (
        reqParent.requestType === "REGISTER" &&
        updatedPayload.bankAccounts &&
        Array.isArray(updatedPayload.bankAccounts)
      ) {
        for (const acc of updatedPayload.bankAccounts) {
          await WorkflowTasksRepository.insertPartnerBankAccount(db, {
            id:
              acc.id ||
              `BANK-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            partnerId: reqParent.targetId,
            bankName: acc.bankName,
            bankCode: acc.bankCode || null,
            branchName: acc.branchName,
            branchCode: acc.branchCode || null,
            accountType: acc.accountType || "ORDINARY",
            accountNumber: acc.accountNumber,
            accountHolderName: acc.accountHolderName,
            isDefault: acc.isDefault ?? false,
            memo: acc.memo || null,
            createdBy: applicantEmployeeNumber,
            createdAt: now,
            updatedBy: applicantEmployeeNumber,
            updatedAt: now,
          });
        }
      }
    } catch (jsonErr) {
      console.error("退避データのパース・反映に失敗しました:", jsonErr);
      await WorkflowTasksRepository.updatePartner(db, reqParent.targetId, {
        status: "active",
        updatedBy: approverEmployeeNumber,
        updatedAt: now,
      });
    }
  } else {
    await WorkflowTasksRepository.updatePartner(db, reqParent.targetId, {
      status: "active",
      updatedBy: approverEmployeeNumber,
      updatedAt: now,
    });
  }
}

// 移設元: workflow-tasks.service.ts getMyPendingTasks() の targetType==="master_partners" 分岐
async function getTaskPreview({
  db,
  requestId,
  targetId,
}: TaskPreviewParams): Promise<TaskPreviewResult> {
  let targetName = "不明なマスタ";
  let previewData: unknown = null;

  const savedContext = await WorkflowTasksRepository.getApprovalContext(
    db,
    requestId,
  );

  if (savedContext && savedContext.generalMemo) {
    try {
      previewData = JSON.parse(savedContext.generalMemo);
      targetName =
        (previewData as Record<string, any>).name || "名称未設定の取引先";
    } catch (_) {
      targetName = "データパースエラー";
    }
  } else {
    const partner = await WorkflowTasksRepository.getPartnerById(db, targetId);
    if (partner) targetName = partner.name;
  }

  return { targetName, previewData };
}

// 移設元: workflow-tasks.service.ts getHistory() の targetType==="master_partners" 分岐
async function getHistoryPreview({
  db,
  requestId,
  targetId,
  requestType,
}: HistoryPreviewParams): Promise<HistoryPreviewResult> {
  let targetName = "不明なマスタ";
  let snapshotNew: unknown = null;
  let snapshotOld: unknown = null;

  const savedContext = await WorkflowTasksRepository.getApprovalContext(
    db,
    requestId,
  );

  if (savedContext && savedContext.generalMemo) {
    try {
      snapshotNew = JSON.parse(savedContext.generalMemo);
      targetName =
        (snapshotNew as Record<string, any>).name || "名称未設定の取引先";
    } catch (_) {
      targetName = "データパースエラー";
    }
  }
  if (requestType === "UPDATE") {
    const partner = await WorkflowTasksRepository.getPartnerById(db, targetId);
    if (partner) {
      snapshotOld = partner;
      if (targetName === "不明なマスタ") targetName = partner.name;
    }
  }

  return { targetName, snapshotNew, snapshotOld };
}

export const partnersAdapter: TargetAdapter = {
  resolveAmount,
  applyApproved,
  getTaskPreview,
  getHistoryPreview,
};
