import React from "react";
import {
  formFieldInputClass,
  formFieldLabelClass,
} from "../../../_shared/ui/FormField";
import { QuoteRecord } from "../_types";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { Button } from "../../../_shared/ui/Button";
import { getDocumentLifecycleStatus } from "../../../_shared/status/document-lifecycle-status";

interface QuoteStatusAndActionsProps {
  memo: string;
  setMemo: (v: string) => void;
  status: QuoteRecord["status"];
  setStatus: (v: QuoteRecord["status"]) => void;
  isQuoteWfEnabled: boolean;
  isSubmitting: boolean;
  editingId: string | null;
  applicantDepartments?: ApplicantDepartmentOption[];
  applicantDepartmentSurrogateId?: string | null;
  setApplicantDepartmentSurrogateId?: (value: string) => void;
  onSubmitRevisionUp: (e: React.FormEvent) => void;
  onSubmitForApproval: () => void;
  onSubmitApprovedEdit: () => void;
}

const inputClass = formFieldInputClass;

export function QuoteStatusAndActions({
  memo,
  setMemo,
  status,
  setStatus,
  isQuoteWfEnabled,
  isSubmitting,
  editingId,
  applicantDepartments = [],
  applicantDepartmentSurrogateId = null,
  setApplicantDepartmentSurrogateId = () => {},
  onSubmitRevisionUp,
  onSubmitForApproval,
  onSubmitApprovedEdit,
}: QuoteStatusAndActionsProps) {
  // 承認機能が無効な場合はpartnersと同様ロックしない(会社設定で無効化した時点で
  // 審査待ち状態自体の意味が無くなるため、DRAFT/仮登録相当として直接編集できる)
  const isLocked =
    isQuoteWfEnabled &&
    (status === "PENDING_APPROVAL" || status === "PENDING_DELETION");
  const isApprovedEdit = status === "APPROVED" && isQuoteWfEnabled;
  const badge = getDocumentLifecycleStatus(status);
  // Item4-e: 承認機能が無効な場合はpartners(取引先マスタ)と同様、ステータスを画面から直接変更できる
  // (承認機能が有効な場合のみ、変更にワークフロー審査を必須とする)
  // BUG-058: 新規登録は必ず下書きで保存される(Backend)ため、ステータスを選べるのは編集時だけにする
  const canEditStatusDirectly = !isQuoteWfEnabled && !isLocked && !!editingId;

  return (
    <>
      {/* 備考・ステータス表示 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
        <div>
          <label className={`${formFieldLabelClass} mb-1`}>
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
          <label className={`${formFieldLabelClass} mb-1`}>
            取引ステータス
          </label>
          {canEditStatusDirectly ? (
            <select
              className={`${inputClass} cursor-pointer`}
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as QuoteRecord["status"])
              }
            >
              <option value="DRAFT">⚪ 下書き</option>
              <option value="APPROVED">🟢 確定</option>
              {/* 承認機能を無効化した時点でPENDING_APPROVAL/PENDING_DELETIONだった見積も
                  選択肢として表示し、DRAFT/APPROVEDへ切り替えられるようにする */}
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
        <p className="text-[10px] text-slate-600 -mt-2">
          承認機能が無効なため、ステータスはこの画面から直接変更できます。
        </p>
      )}
      {!editingId && (
        <p className="text-[10px] text-slate-600 -mt-2">
          新規登録は下書きで保存されます。確定(承認申請)は保存後に行います。
        </p>
      )}

      {isLocked && (
        <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          承認処理中のため、この見積は編集できません。承認完了後に再度お試しください。
        </div>
      )}

      {isApprovedEdit && !isLocked && (
        <div className="text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
          承認済みの見積です。内容を変更すると「変更申請」として申請され、承認されるまで現在の内容がそのまま有効です(添付ファイルの変更はこの申請には反映されません)。
        </div>
      )}

      {isQuoteWfEnabled && !isLocked && (
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
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting
                ? editingId
                  ? "保存中..."
                  : "登録中..."
                : editingId
                  ? "保存"
                  : "登録"}
            </Button>
          )}

          {editingId && status === "DRAFT" && isQuoteWfEnabled && (
            <Button
              variant="success"
              className="flex-1"
              disabled={isSubmitting}
              onClick={onSubmitForApproval}
            >
              {isSubmitting ? "処理を実行中..." : "🚀 承認を申請する"}
            </Button>
          )}

          {editingId && (
            <Button
              variant="secondary"
              className="flex-1"
              disabled={isSubmitting}
              onClick={onSubmitRevisionUp}
            >
              {isSubmitting
                ? "処理を実行中..."
                : "履歴を残して「新版として改定登録(Ver.UP)」"}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
