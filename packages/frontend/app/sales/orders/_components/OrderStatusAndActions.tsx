import React from "react";
import { Button } from "../../../_shared/ui/Button";
import { OrderRecord } from "../_types";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getDocumentLifecycleStatus } from "../../../_shared/status/document-lifecycle-status";

interface OrderStatusAndActionsProps {
  memo: string;
  setMemo: (v: string) => void;
  status: OrderRecord["status"];
  setStatus: (v: OrderRecord["status"]) => void;
  isSalesOrderWfEnabled: boolean;
  isSubmitting: boolean;
  editingId: string | null;
  applicantDepartments?: ApplicantDepartmentOption[];
  applicantDepartmentSurrogateId?: string | null;
  setApplicantDepartmentSurrogateId?: (value: string) => void;
  onSubmitForApproval: () => void;
  onSubmitApprovedEdit: () => void;
  hasBackorder?: boolean;
  onRetryBackorder?: () => void;
}

const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500";

// Item7: quotes/_components/QuoteStatusAndActions.tsxと同じ方針。
// 見積の「新版として改定登録(Ver.UP)」に相当する概念は無いため持たない
export function OrderStatusAndActions({
  memo,
  setMemo,
  status,
  setStatus,
  isSalesOrderWfEnabled,
  isSubmitting,
  editingId,
  applicantDepartments = [],
  applicantDepartmentSurrogateId = null,
  setApplicantDepartmentSurrogateId = () => {},
  onSubmitForApproval,
  onSubmitApprovedEdit,
  hasBackorder,
  onRetryBackorder,
}: OrderStatusAndActionsProps) {
  const isLocked =
    isSalesOrderWfEnabled &&
    (status === "PENDING_APPROVAL" || status === "PENDING_DELETION");
  const isApprovedEdit = status === "APPROVED" && isSalesOrderWfEnabled;
  const badge = getDocumentLifecycleStatus(status);
  const canEditStatusDirectly = !isSalesOrderWfEnabled && !isLocked;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1">
            社内備考・メモ
          </label>
          <textarea
            className={`${inputClass} h-16 resize-none`}
            placeholder="審査時の注意点など"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            disabled={isLocked}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1">
            取引ステータス
          </label>
          {canEditStatusDirectly ? (
            <select
              className={`${inputClass} cursor-pointer`}
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as OrderRecord["status"])
              }
            >
              <option value="DRAFT">⚪ 下書き</option>
              <option value="APPROVED">🟢 確定</option>
              {(status === "PENDING_APPROVAL" ||
                status === "PENDING_DELETION") && (
                <option value={status}>
                  {getDocumentLifecycleStatus(status).label}(要切替)
                </option>
              )}
            </select>
          ) : (
            <StatusBadge {...badge} />
          )}
        </div>
      </div>

      {canEditStatusDirectly && (
        <p className="text-[10px] text-slate-500 -mt-2">
          承認機能が無効なため、ステータスはこの画面から直接変更できます。
        </p>
      )}

      {isLocked && (
        <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          承認処理中のため、この受注は編集できません。承認完了後に再度お試しください。
        </div>
      )}

      {status === "APPROVED" && hasBackorder && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span>
            ⚠
            在庫不足で引き当てられなかった明細があります(バックオーダー)。在庫確保後にお試しください。
          </span>
          <Button
            variant="success"
            size="sm"
            className="shrink-0"
            disabled={isSubmitting}
            onClick={onRetryBackorder}
          >
            🔁 再引当を試みる
          </Button>
        </div>
      )}

      {isApprovedEdit && !isLocked && (
        <div className="text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
          承認済みの受注です。内容を変更すると「変更申請」として申請され、承認されるまで現在の内容がそのまま有効です(添付ファイルの変更はこの申請には反映されません)。
        </div>
      )}

      {isSalesOrderWfEnabled && !isLocked && (
        <ApplicantDepartmentSelect
          departments={applicantDepartments}
          value={applicantDepartmentSurrogateId}
          onChange={setApplicantDepartmentSurrogateId}
        />
      )}

      {!isLocked && (
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          {isApprovedEdit ? (
            <Button
              className="flex-1"
              disabled={isSubmitting}
              onClick={onSubmitApprovedEdit}
            >
              {isSubmitting ? "処理を実行中..." : "🔒 変更を申請する"}
            </Button>
          ) : (
            <Button className="flex-1" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "処理を実行中..." : editingId ? "保存" : "登録"}
            </Button>
          )}

          {editingId && status === "DRAFT" && isSalesOrderWfEnabled && (
            <Button
              variant="success"
              className="flex-1"
              disabled={isSubmitting}
              onClick={onSubmitForApproval}
            >
              {isSubmitting ? "処理を実行中..." : "🚀 承認を申請する"}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
