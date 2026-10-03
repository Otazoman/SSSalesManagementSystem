"use client";

import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { Button } from "../../../_shared/ui/Button";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import { PurchaseRequisitionItemsTable } from "./PurchaseRequisitionItemsTable";
import { PurchaseRequisitionAttachmentsSection } from "./PurchaseRequisitionAttachmentsSection";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import { getDocumentLifecycleStatus } from "../../../_shared/status/document-lifecycle-status";
import type { ApplicantDepartmentOption } from "../../../types";
import {
  PurchaseRequisitionCategory,
  PurchaseRequisitionItemRecord,
  PurchaseRequisitionAttachment,
  ItemMaster,
  ProjectLookup,
  DepartmentOption,
  PartnerLookup,
  UserOption,
  UnitLookup,
  TaxCategoryLookup,
  AccountLookup,
} from "../_types";

const CATEGORY_OPTIONS: {
  value: PurchaseRequisitionCategory;
  label: string;
  hint: string;
}[] = [
  { value: "ONE_TIME", label: "都度", hint: "通常の単発購入" },
  {
    value: "PERIODIC",
    label: "定期",
    hint: "定期的に発生する購入(過去の申請をコピーして再作成する運用を想定)",
  },
  {
    value: "PREPAYMENT",
    label: "前払",
    hint: "納品前に支払が必要な取引(発注時に支払完了マーカーを管理)",
  },
];

interface PurchaseRequisitionFormProps {
  editingId: string | null;
  editingStatus: string | null;
  title: string;
  setTitle: (v: string) => void;
  departmentSurrogateId: string;
  setDepartmentSurrogateId: (v: string) => void;
  requestType: PurchaseRequisitionCategory;
  setRequestType: (v: PurchaseRequisitionCategory) => void;
  memo: string;
  setMemo: (v: string) => void;
  items: PurchaseRequisitionItemRecord[];
  addItemRow: () => void;
  updateItemRow: (
    index: number,
    patch: Partial<PurchaseRequisitionItemRecord>,
  ) => void;
  onItemTypeChange: (index: number, type: "MASTER" | "DIRECT") => void;
  onItemMasterSelect: (index: number, itemId: string) => void;
  onItemQuantityChange: (index: number, quantity: number) => void;
  removeItemRow: (index: number) => void;
  moveItemUp: (index: number) => void;
  moveItemDown: (index: number) => void;
  partnerId: string;
  partnerName: string;
  setPartnerName: (v: string) => void;
  partnerInputType: "MASTER" | "DIRECT";
  onPartnerTypeChange: (type: "MASTER" | "DIRECT") => void;
  onSupplierMasterSelect: (partnerId: string) => void;
  suppliers: PartnerLookup[];
  projectId: string;
  setProjectId: (v: string) => void;
  applicantId: string;
  setApplicantId: (v: string) => void;
  inputPersonEmployeeNumber: string;
  setInputPersonEmployeeNumber: (v: string) => void;
  userMaster: UserOption[];
  units: UnitLookup[];
  taxCategories: TaxCategoryLookup[];
  accounts?: AccountLookup[];
  attachments: PurchaseRequisitionAttachment[];
  onAddAttachmentRow: (storageType: "R2" | "GOOGLE_DRIVE") => void;
  onRemoveAttachmentRow: (index: number, fileName: string) => void;
  onFileSelection: (
    index: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => void;
  onAttachmentFileNameChange: (index: number, value: string) => void;
  onAttachmentExternalUrlChange: (index: number, value: string) => void;
  totalAmount: number;
  taxAmount: number;
  calcSubTotal: () => number;
  calcGrossSubTotal: () => number;
  calcDiscountTotal: () => number;
  calcTax: () => number;
  calcTaxBreakdown: () => {
    rate10: { excl: number; tax: number };
    rate8: { excl: number; tax: number };
    rate0: { excl: number; tax: number };
  };
  calcTotal: () => number;
  allItems: ItemMaster[];
  projects: ProjectLookup[];
  orgDepartments: DepartmentOption[];
  isPurchaseRequisitionWfEnabled: boolean;
  isApprovedEdit: boolean;
  isLocked: boolean;
  applicantDepartments: ApplicantDepartmentOption[];
  applicantDepartmentSurrogateId: string | null;
  setApplicantDepartmentSurrogateId: (v: string) => void;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onSubmitForApproval: () => void;
  onCancel: () => void;
}

export function PurchaseRequisitionForm({
  editingId,
  editingStatus,
  title,
  setTitle,
  departmentSurrogateId,
  setDepartmentSurrogateId,
  requestType,
  setRequestType,
  memo,
  setMemo,
  items,
  addItemRow,
  updateItemRow,
  onItemTypeChange,
  onItemMasterSelect,
  onItemQuantityChange,
  removeItemRow,
  moveItemUp,
  moveItemDown,
  partnerId,
  partnerName,
  setPartnerName,
  partnerInputType,
  onPartnerTypeChange,
  onSupplierMasterSelect,
  suppliers,
  projectId,
  setProjectId,
  applicantId,
  setApplicantId,
  inputPersonEmployeeNumber,
  setInputPersonEmployeeNumber,
  userMaster,
  units,
  taxCategories,
  accounts = [],
  attachments,
  onAddAttachmentRow,
  onRemoveAttachmentRow,
  onFileSelection,
  onAttachmentFileNameChange,
  onAttachmentExternalUrlChange,
  totalAmount,
  taxAmount,
  calcSubTotal,
  calcGrossSubTotal,
  calcDiscountTotal,
  calcTax,
  calcTaxBreakdown,
  calcTotal,
  allItems,
  projects,
  orgDepartments,
  isPurchaseRequisitionWfEnabled,
  isApprovedEdit,
  isLocked,
  applicantDepartments,
  applicantDepartmentSurrogateId,
  setApplicantDepartmentSurrogateId,
  isSubmitting,
  onSubmit,
  onSubmitForApproval,
  onCancel,
}: PurchaseRequisitionFormProps) {
  const badge = editingStatus
    ? getDocumentLifecycleStatus(editingStatus)
    : null;
  const selectedCategory = CATEGORY_OPTIONS.find(
    (c) => c.value === requestType,
  );

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="text-sm font-black text-slate-900">
            {editingId
              ? `📝 購買申請の詳細・編集 (管理番号: ${editingId})`
              : "➕ 新規購買申請の起票"}
          </h2>
          {badge && <StatusBadge {...badge} />}
        </div>

        {/* 進捗確認(閲覧専用)に表示される完了/進行中の手動設定。この画面の更新権限がある場合のみ変更できる */}
        <DocumentCompletionControl
          stageKey="purchase_request"
          documentId={editingId}
        />

        {isLocked && (
          <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            承認処理中のため、この購買申請は編集できません。承認完了後に再度お試しください。
          </div>
        )}

        {isApprovedEdit && !isLocked && (
          <div className="text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
            承認済みの購買申請です。内容を変更すると「変更申請」として申請され、承認されるまで現在の内容がそのまま有効です(添付ファイルの変更はこの申請には反映されません)。
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <FormField label="件名" required>
            <input
              className={formFieldInputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isLocked}
              required
            />
          </FormField>

          <FormField label="申請部署" required>
            <select
              className={`${formFieldInputClass} cursor-pointer`}
              value={departmentSurrogateId}
              onChange={(e) => setDepartmentSurrogateId(e.target.value)}
              disabled={isLocked}
              required
            >
              <option value="">-- 部署選択 --</option>
              {orgDepartments.map((d) => (
                <option key={d.surrogateId} value={d.surrogateId}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="購買区分" required hint={selectedCategory?.hint}>
            <select
              className={`${formFieldInputClass} cursor-pointer`}
              value={requestType}
              onChange={(e) =>
                setRequestType(e.target.value as PurchaseRequisitionCategory)
              }
              disabled={isLocked}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="仕入先" required>
            <div className="flex gap-1.5">
              <select
                className="border border-slate-300 p-2 text-[11px] rounded bg-white text-slate-800 font-bold focus:outline-none disabled:bg-slate-100 disabled:text-slate-500 cursor-pointer shrink-0"
                value={partnerInputType}
                disabled={isLocked}
                onChange={(e) =>
                  onPartnerTypeChange(e.target.value as "MASTER" | "DIRECT")
                }
              >
                <option value="MASTER">マスタ</option>
                <option value="DIRECT">手入力</option>
              </select>
              {partnerInputType === "MASTER" ? (
                <select
                  required
                  className={`${formFieldInputClass} cursor-pointer`}
                  value={partnerId}
                  onChange={(e) => onSupplierMasterSelect(e.target.value)}
                  disabled={isLocked}
                >
                  <option value="" disabled>
                    -- 仕入先を選択 --
                  </option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      [{s.id}] {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  className={formFieldInputClass}
                  placeholder="仕入先名(自由入力)"
                  value={partnerName}
                  onChange={(e) => setPartnerName(e.target.value)}
                  disabled={isLocked}
                />
              )}
            </div>
          </FormField>

          <FormField label="プロジェクト" required>
            <select
              required
              className={`${formFieldInputClass} cursor-pointer`}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={isLocked}
            >
              <option value="" disabled>
                -- プロジェクト選択 --
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}: {p.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="申請者">
            <select
              className={`${formFieldInputClass} cursor-pointer`}
              value={applicantId}
              onChange={(e) => setApplicantId(e.target.value)}
              disabled={isLocked}
            >
              <option value="">-- 担当者を選択 --</option>
              {userMaster.map((user) => (
                <option key={user.id} value={user.employeeNumber}>
                  {user.name} ({user.employeeNumber})
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="入力者" hint="実際にこの伝票を入力した担当者">
            <select
              className={`${formFieldInputClass} cursor-pointer`}
              value={inputPersonEmployeeNumber}
              onChange={(e) => setInputPersonEmployeeNumber(e.target.value)}
              disabled={isLocked}
            >
              <option value="">-- 担当者を選択 --</option>
              {userMaster.map((user) => (
                <option key={user.id} value={user.employeeNumber}>
                  {user.name} ({user.employeeNumber})
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="社内備考・メモ">
          <textarea
            className={`${formFieldInputClass} h-16 resize-none`}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            disabled={isLocked}
          />
        </FormField>

        <PurchaseRequisitionItemsTable
          items={items}
          allItems={allItems}
          units={units}
          taxCategories={taxCategories}
          accounts={accounts}
          isLocked={isLocked}
          onItemTypeChange={onItemTypeChange}
          onItemChange={updateItemRow}
          onItemMasterSelect={onItemMasterSelect}
          onItemQuantityChange={onItemQuantityChange}
          onAddItemRow={addItemRow}
          onRemoveItemRow={removeItemRow}
          onMoveItemUp={moveItemUp}
          onMoveItemDown={moveItemDown}
          calcSubTotal={calcSubTotal}
          calcGrossSubTotal={calcGrossSubTotal}
          calcDiscountTotal={calcDiscountTotal}
          calcTax={calcTax}
          calcTaxBreakdown={calcTaxBreakdown}
          calcTotal={calcTotal}
        />

        <PurchaseRequisitionAttachmentsSection
          requisitionId={editingId || ""}
          attachments={attachments}
          isLocked={isLocked}
          onAddAttachmentRow={onAddAttachmentRow}
          onRemoveAttachmentRow={onRemoveAttachmentRow}
          onFileSelection={onFileSelection}
          onFileNameChange={onAttachmentFileNameChange}
          onExternalUrlChange={onAttachmentExternalUrlChange}
        />

        {isPurchaseRequisitionWfEnabled && !isLocked && (
          <ApplicantDepartmentSelect
            departments={applicantDepartments}
            value={applicantDepartmentSurrogateId}
            onChange={setApplicantDepartmentSurrogateId}
          />
        )}

        {!isLocked && (
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button className="flex-1" type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "処理を実行中..."
                : isApprovedEdit
                  ? "🔒 変更を申請する"
                  : editingId
                    ? "保存"
                    : "この内容で下書き保存"}
            </Button>

            {editingId &&
              editingStatus === "DRAFT" &&
              isPurchaseRequisitionWfEnabled && (
                <Button
                  variant="success"
                  className="flex-1"
                  disabled={isSubmitting}
                  onClick={onSubmitForApproval}
                >
                  {isSubmitting ? "処理を実行中..." : "🚀 承認を申請する"}
                </Button>
              )}

            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 border border-slate-300 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-50"
            >
              ↩ 一覧画面へ戻る
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
