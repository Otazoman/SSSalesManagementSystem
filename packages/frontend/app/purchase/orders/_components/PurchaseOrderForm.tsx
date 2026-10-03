"use client";

import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { Button } from "../../../_shared/ui/Button";
import { PurchaseOrderItemsTable } from "./PurchaseOrderItemsTable";
import { PurchaseOrderAttachmentsSection } from "./PurchaseOrderAttachmentsSection";
import { PurchaseOrderReceiptProgress } from "./PurchaseOrderReceiptProgress";
import { PurchaseOrderFormHeader } from "./PurchaseOrderFormHeader";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import {
  PurchaseOrderItemRecord,
  PurchaseOrderAttachment,
  ItemMaster,
  ProjectLookup,
  PartnerLookup,
  UserOption,
  UnitLookup,
  TaxCategoryLookup,
  AccountLookup,
  BusinessLocationLookup,
  WarehouseLookup,
} from "../_types";

interface PurchaseOrderFormProps {
  editingId: string | null;
  editingStatus: string | null;
  title: string;
  setTitle: (v: string) => void;
  partnerId: string;
  onSupplierMasterSelect: (partnerId: string) => void;
  suppliers: PartnerLookup[];
  requestId: string | null;
  orderDate: string;
  setOrderDate: (v: string) => void;
  memo: string;
  setMemo: (v: string) => void;
  items: PurchaseOrderItemRecord[];
  addItemRow: () => void;
  updateItemRow: (
    index: number,
    patch: Partial<PurchaseOrderItemRecord>,
  ) => void;
  onItemTypeChange: (index: number, type: "MASTER" | "DIRECT") => void;
  onItemMasterSelect: (index: number, itemId: string) => void;
  onItemQuantityChange: (index: number, quantity: number) => void;
  removeItemRow: (index: number) => void;
  moveItemUp: (index: number) => void;
  moveItemDown: (index: number) => void;
  projectId: string;
  setProjectId: (v: string) => void;
  purchasePersonEmployeeNumber: string;
  setPurchasePersonEmployeeNumber: (v: string) => void;
  inputPersonEmployeeNumber: string;
  setInputPersonEmployeeNumber: (v: string) => void;
  companyName: string;
  setCompanyName: (v: string) => void;
  companyDepartment: string;
  setCompanyDepartment: (v: string) => void;
  companyAddress: string;
  setCompanyAddress: (v: string) => void;
  companyTel: string;
  setCompanyTel: (v: string) => void;
  companyFax: string;
  setCompanyFax: (v: string) => void;
  deliveryDate: string;
  setDeliveryDate: (v: string) => void;
  deliveryPlace: string;
  setDeliveryPlace: (v: string) => void;
  deliveryLocationId: string;
  setDeliveryLocationId: (v: string) => void;
  deliveryWarehouseId: string;
  setDeliveryWarehouseId: (v: string) => void;
  businessLocations: BusinessLocationLookup[];
  warehouses: WarehouseLookup[];
  paymentTerms: string;
  setPaymentTerms: (v: string) => void;
  isPaid: boolean;
  setIsPaid: (v: boolean) => void;
  paidAt: string;
  setPaidAt: (v: string) => void;
  userMaster: UserOption[];
  units: UnitLookup[];
  taxCategories: TaxCategoryLookup[];
  accounts?: AccountLookup[];
  attachments: PurchaseOrderAttachment[];
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
  isPurchaseOrderWfEnabled: boolean;
  isApprovedEdit: boolean;
  isLocked: boolean;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onSubmitForApproval: () => void;
  onGeneratePdf: () => void;
  onOpenMailModal: (orderId: string) => void;
  onCancel: () => void;
}

export function PurchaseOrderForm({
  editingId,
  editingStatus,
  title,
  setTitle,
  partnerId,
  onSupplierMasterSelect,
  suppliers,
  requestId,
  orderDate,
  setOrderDate,
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
  projectId,
  setProjectId,
  purchasePersonEmployeeNumber,
  setPurchasePersonEmployeeNumber,
  inputPersonEmployeeNumber,
  setInputPersonEmployeeNumber,
  companyName,
  setCompanyName,
  companyDepartment,
  setCompanyDepartment,
  companyAddress,
  setCompanyAddress,
  companyTel,
  setCompanyTel,
  companyFax,
  setCompanyFax,
  deliveryDate,
  setDeliveryDate,
  deliveryPlace,
  setDeliveryPlace,
  deliveryLocationId,
  setDeliveryLocationId,
  deliveryWarehouseId,
  setDeliveryWarehouseId,
  businessLocations = [],
  warehouses = [],
  paymentTerms,
  setPaymentTerms,
  isPaid,
  setIsPaid,
  paidAt,
  setPaidAt,
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
  isPurchaseOrderWfEnabled,
  isApprovedEdit,
  isLocked,
  isSubmitting,
  onSubmit,
  onSubmitForApproval,
  onGeneratePdf,
  onOpenMailModal,
  onCancel,
}: PurchaseOrderFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <PurchaseOrderFormHeader
          editingId={editingId}
          editingStatus={editingStatus}
          isSubmitting={isSubmitting}
          onGeneratePdf={onGeneratePdf}
          onOpenMailModal={onOpenMailModal}
        />

        {/* 進捗確認(閲覧専用)に表示される完了/進行中の手動設定。この画面の更新権限がある場合のみ変更できる */}
        <DocumentCompletionControl
          stageKey="purchase_order"
          documentId={editingId}
        />

        {requestId && (
          <div className="text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
            📝 購買申請 <span className="font-mono font-bold">{requestId}</span>{" "}
            から作成された発注です。
          </div>
        )}

        {isLocked && (
          <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            承認処理中のため、この発注は編集できません。承認完了後に再度お試しください。
          </div>
        )}

        {isApprovedEdit && !isLocked && (
          <div className="text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
            承認済みの発注です。内容を変更すると「変更申請」として申請され、承認されるまで現在の内容がそのまま有効です(添付ファイルの変更はこの申請には反映されません)。
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

          <FormField label="発注日" required>
            <input
              type="date"
              className={formFieldInputClass}
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              disabled={isLocked}
              required
            />
          </FormField>

          <FormField label="仕入先" required>
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
              {/* BUG-063: 取引停止の仕入先は選択肢に出さない(既に選ばれている伝票では表示を残す) */}
              {suppliers
                .filter((s) => s.status !== "suspended" || s.id === partnerId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    [{s.id}] {s.name}
                  </option>
                ))}
            </select>
          </FormField>

          <FormField label="プロジェクト">
            <select
              className={`${formFieldInputClass} cursor-pointer`}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={isLocked}
            >
              <option value="">-- プロジェクト選択 --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}: {p.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="発注担当者">
            <select
              className={`${formFieldInputClass} cursor-pointer`}
              value={purchasePersonEmployeeNumber}
              onChange={(e) => setPurchasePersonEmployeeNumber(e.target.value)}
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

          <FormField label="希望納期">
            <input
              className={formFieldInputClass}
              placeholder="例: 発注確定後、約2週間"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              disabled={isLocked}
            />
          </FormField>

          <FormField label="納品場所">
            <input
              className={formFieldInputClass}
              value={deliveryPlace}
              onChange={(e) => setDeliveryPlace(e.target.value)}
              disabled={isLocked}
              placeholder="下の拠点/倉庫選択、または直接入力"
            />
          </FormField>

          <FormField label="納品場所(拠点から選択)">
            <select
              className={`${formFieldInputClass} cursor-pointer`}
              value={deliveryLocationId}
              onChange={(e) => {
                const selectedId = e.target.value;
                setDeliveryLocationId(selectedId);
                if (selectedId) {
                  setDeliveryWarehouseId("");
                  const selected = businessLocations.find((l) => l.id === selectedId);
                  if (selected) {
                    setDeliveryPlace(
                      selected.address ? `${selected.name}(${selected.address})` : selected.name,
                    );
                  }
                }
              }}
              disabled={isLocked}
            >
              <option value="">-- 営業拠点から選択 --</option>
              {businessLocations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  [{loc.id}] {loc.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="納品場所(倉庫から選択)">
            <select
              className={`${formFieldInputClass} cursor-pointer`}
              value={deliveryWarehouseId}
              onChange={(e) => {
                const selectedId = e.target.value;
                setDeliveryWarehouseId(selectedId);
                if (selectedId) {
                  setDeliveryLocationId("");
                  const selected = warehouses.find((w) => w.id === selectedId);
                  if (selected) {
                    setDeliveryPlace(
                      selected.address ? `${selected.name}(${selected.address})` : selected.name,
                    );
                  }
                }
              }}
              disabled={isLocked}
            >
              <option value="">-- 倉庫から選択 --</option>
              {warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  [{wh.id}] {wh.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="支払条件">
            <input
              className={formFieldInputClass}
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              disabled={isLocked}
            />
          </FormField>
        </div>

        <details className="border border-slate-200 rounded-lg">
          <summary className="cursor-pointer text-xs font-bold text-slate-600 px-3 py-2 select-none">
            📮 発注書印字用の自社情報(未入力時は会社設定の既定値を使用)
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-3 pt-1">
            <FormField label="自社名(印字用)">
              <input
                className={formFieldInputClass}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                disabled={isLocked}
              />
            </FormField>
            <FormField label="自社部署(印字用)">
              <input
                className={formFieldInputClass}
                value={companyDepartment}
                onChange={(e) => setCompanyDepartment(e.target.value)}
                disabled={isLocked}
              />
            </FormField>
            <FormField label="自社住所(印字用)">
              <input
                className={formFieldInputClass}
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                disabled={isLocked}
              />
            </FormField>
            <FormField label="自社電話番号(印字用)">
              <input
                className={formFieldInputClass}
                value={companyTel}
                onChange={(e) => setCompanyTel(e.target.value)}
                disabled={isLocked}
              />
            </FormField>
            <FormField label="自社FAX番号(印字用)">
              <input
                className={formFieldInputClass}
                value={companyFax}
                onChange={(e) => setCompanyFax(e.target.value)}
                disabled={isLocked}
              />
            </FormField>
          </div>
        </details>

        <div className="flex items-center gap-2 bg-amber-50/60 border border-amber-200 rounded-lg px-3 py-2">
          <input
            id="po-is-paid"
            type="checkbox"
            checked={isPaid}
            onChange={(e) => setIsPaid(e.target.checked)}
            disabled={isLocked}
            className="cursor-pointer"
          />
          <label
            htmlFor="po-is-paid"
            className="text-xs font-bold text-slate-700 cursor-pointer"
          >
            前払: 支払完了済み
          </label>
          {isPaid && (
            <input
              type="date"
              className={`${formFieldInputClass} w-40`}
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              disabled={isLocked}
            />
          )}
        </div>

        <FormField label="社内備考・メモ">
          <textarea
            className={`${formFieldInputClass} h-16 resize-none`}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            disabled={isLocked}
          />
        </FormField>

        <PurchaseOrderItemsTable
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

        <PurchaseOrderAttachmentsSection
          orderId={editingId || ""}
          attachments={attachments}
          isLocked={isLocked}
          onAddAttachmentRow={onAddAttachmentRow}
          onRemoveAttachmentRow={onRemoveAttachmentRow}
          onFileSelection={onFileSelection}
          onFileNameChange={onAttachmentFileNameChange}
          onExternalUrlChange={onAttachmentExternalUrlChange}
        />

        {editingId && editingStatus === "APPROVED" && (
          <PurchaseOrderReceiptProgress orderId={editingId} />
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
              isPurchaseOrderWfEnabled && (
                <Button
                  variant="success"
                  className="flex-1"
                  disabled={isSubmitting}
                  onClick={onSubmitForApproval}
                >
                  {isSubmitting ? "処理を実行中..." : "🚀 承認を申請する"}
                </Button>
              )}

            {editingId &&
              editingStatus === "DRAFT" &&
              !isPurchaseOrderWfEnabled && (
                <Button
                  variant="success"
                  className="flex-1"
                  disabled={isSubmitting}
                  onClick={onSubmitForApproval}
                >
                  {isSubmitting ? "処理を実行中..." : "✅ このまま確定する"}
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
