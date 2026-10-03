// app/products/_components/ProductForm.tsx
import React from "react";
import { Button } from "../../../_shared/ui/Button";
import {
  ItemRecord,
  AccountLookup,
  UnitLookup,
  SupplierLookup,
  TaxCategoryLookup,
} from "../_types";
import { useProductForm } from "../_hooks/useProductForm";
import { useAttachmentUpload } from "../../../_shared/hooks/use-attachment-upload";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface ProductFormProps {
  editingId: string | null;
  onClear: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  accounts: AccountLookup[];
  units: UnitLookup[];
  suppliers: SupplierLookup[];
  taxCategories: TaxCategoryLookup[];
  canCreate: boolean;
  canUpdate: boolean;
  isProductWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  initialData: ItemRecord | null;
}

export function ProductForm({
  editingId,
  onClear,
  onSuccess,
  onError,
  accounts,
  units,
  suppliers,
  taxCategories,
  canCreate,
  canUpdate,
  isProductWfEnabled = false,
  departments = [],
  initialData,
}: ProductFormProps) {
  const defaultUnit = units[0]?.code || "PCS";

  const {
    formState,
    resetForm,
    handleFormSubmit,
    isProductCurrentlyLocked,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
  } = useProductForm({
    editingId,
    initialData,
    defaultUnitCode: defaultUnit,
    canCreate,
    canUpdate,
    isProductWfEnabled,
    departments,
    onSuccess,
    onError,
  });

  const isFormEditable = editingId ? canUpdate : canCreate;
  const isLocked = isProductCurrentlyLocked;

  const { uploadFile } = useAttachmentUpload<"IMAGE" | "SPEC_SHEET" | "OTHER">({
    uploadUrl: "/api/products/upload",
    // BUG-037: alert ではなく、画面のエラー表示(onError)で伝える
    onError,
  });

  const inputClass = formFieldInputClass;

  return (
    <form
      onSubmit={handleFormSubmit}
      className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4 h-fit"
    >
      {isLocked && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-black rounded-lg flex items-center space-x-2">
          <span>🔒</span>
          <span>
            このデータは現在、承認ワークフローの審査中(仮登録)のため、承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます。
          </span>
        </div>
      )}

      <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
        {editingId ? "品目マスタ情報の編集" : "新規個別品目登録"}
      </h3>

      <fieldset disabled={!isFormEditable || isLocked} className="space-y-4">
        <div>
          <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
            品目マスタステータス
          </label>
          <select
            className={`${inputClass} cursor-pointer`}
            value={formState.itemStatus}
            onChange={(e) => formState.setItemStatus(e.target.value as any)}
            disabled={
              (editingId ? !canUpdate : !canCreate) || isProductWfEnabled
            }
          >
            <option value="active">有効</option>
            <option value="temporary">仮登録</option>
            <option value="suspended">無効</option>
          </select>
          {isProductWfEnabled && (
            <p className="text-[10px] text-slate-600 mt-1">
              承認機能が有効なため、ステータスは一覧の「停止」操作から申請してください。
            </p>
          )}
        </div>

        {isProductWfEnabled && (
          <ApplicantDepartmentSelect
            departments={departments}
            value={applicantDepartmentSurrogateId}
            onChange={setApplicantDepartmentSurrogateId}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
              品目ID (コード)
            </label>
            <input
              type="text"
              disabled={!!editingId || !canCreate}
              className={inputClass}
              placeholder="例: ITEM-001(空欄で自動採番)"
              value={formState.itemId}
              onChange={(e) => formState.setItemId(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
              品目表示名称 *
            </label>
            <input
              type="text"
              required
              className={inputClass}
              placeholder="品物名・規格"
              value={formState.itemName}
              onChange={(e) => formState.setItemName(e.target.value)}
              disabled={editingId ? !canUpdate : !canCreate}
            />
          </div>
        </div>

        <div className="flex space-x-6 bg-slate-50 p-3 rounded border">
          <label className="flex items-center space-x-1 text-xs font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={formState.isPurchased}
              onChange={(e) => formState.setIsPurchased(e.target.checked)}
              disabled={editingId ? !canUpdate : !canCreate}
            />
            <span>🛒 購買仕入対象</span>
          </label>
          <label className="flex items-center space-x-1 text-xs font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={formState.isSales}
              onChange={(e) => formState.setIsSales(e.target.checked)}
              disabled={editingId ? !canUpdate : !canCreate}
            />
            <span>📈 自社販売対象</span>
          </label>
          <label className="flex items-center space-x-1 text-xs font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={formState.isService}
              onChange={(e) => formState.setIsService(e.target.checked)}
              disabled={editingId ? !canUpdate : !canCreate}
            />
            <span>🛠️ サービス役務(在庫外)</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
              消費税区分 *
            </label>
            <select
              required
              className={`${inputClass} cursor-pointer font-bold border-indigo-200`}
              value={formState.taxCategoryCode}
              onChange={(e) => formState.setTaxCategoryCode(e.target.value)}
              disabled={editingId ? !canUpdate : !canCreate}
            >
              {taxCategories.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name} (
                  {t.taxType === "EXEMPT"
                    ? "非課税"
                    : `${(t.taxRate * 100).toFixed(0)}%`}
                  )
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
              勘定科目
            </label>
            <select
              className={`${inputClass} cursor-pointer`}
              value={formState.accountCode}
              onChange={(e) => formState.setAccountCode(e.target.value)}
              disabled={editingId ? !canUpdate : !canCreate}
            >
              <option value="">-- 科目選択 --</option>
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code}: {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
              基本単位 *
            </label>
            <select
              required
              className={`${inputClass} cursor-pointer`}
              value={formState.baseUnitCode}
              onChange={(e) => formState.setBaseUnitCode(e.target.value)}
              disabled={editingId ? !canUpdate : !canCreate}
            >
              {units.length === 0 && <option value="PCS">PCS (個)</option>}
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} ({u.name})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
              JANバーコード
            </label>
            <input
              type="text"
              className={inputClass}
              value={formState.barcode}
              onChange={(e) => formState.setBarcode(e.target.value)}
              disabled={editingId ? !canUpdate : !canCreate}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded border border-slate-200">
          <div>
            <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
              🏢 主たる仕入先取引先
            </label>
            <select
              className={`${inputClass} cursor-pointer`}
              value={formState.supplierId}
              onChange={(e) => formState.setSupplierId(e.target.value)}
              disabled={editingId ? !canUpdate : !canCreate}
            >
              <option value="">-- 仕入先未選択 (任意) --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
              🏷️ 相手先型番・カタログコード
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="メーカー型番や仕入先コード"
              value={formState.supplierPartNumber}
              onChange={(e) => formState.setSupplierPartNumber(e.target.value)}
              disabled={editingId ? !canUpdate : !canCreate}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
          <div>
            <label className="block text-[9px] font-bold text-indigo-700 mb-0.5">
              標準販売単価 (￥) *
            </label>
            <input
              type="number"
              required
              className={inputClass}
              value={formState.stdSalesPrice}
              onChange={(e) =>
                formState.setStdSalesPrice(Number(e.target.value))
              }
              disabled={editingId ? !canUpdate : !canCreate}
            />
          </div>
          <div>
            <label className="block text-[9px] font-bold text-indigo-700 mb-0.5">
              標準仕入単価 (￥) *
            </label>
            <input
              type="number"
              required
              className={inputClass}
              value={formState.stdPurchasePrice}
              onChange={(e) =>
                formState.setStdPurchasePrice(Number(e.target.value))
              }
              disabled={editingId ? !canUpdate : !canCreate}
            />
          </div>
        </div>

        {/* 添付管理システム */}
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <span className="block text-xs font-bold text-slate-700">
            🖼️ 添付ファイル・仕様書・外部リンク
          </span>

          <div>
            <input
              type="file"
              accept="image/*"
              className="text-xs w-full text-slate-700 bg-white border border-slate-300 rounded-lg p-1.5 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-bold file:bg-slate-200 file:text-slate-800 hover:file:bg-slate-300 cursor-pointer"
              onChange={async (e) => {
                const attachment = await uploadFile(e, "IMAGE");
                if (!attachment) return;
                formState.setAttachments((prev) => [...prev, attachment]);
              }}
            />
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-slate-200 w-full">
            <input
              type="text"
              placeholder="仕様書名・リンク名"
              value={formState.newLink.title}
              onChange={(e) =>
                formState.setNewLink((prev) => ({
                  ...prev,
                  title: e.target.value,
                }))
              }
              className="border border-slate-300 rounded px-2 py-1.5 text-base sm:text-xs w-[140px] shrink-0 bg-white text-slate-800 placeholder-slate-500 font-medium"
            />
            <input
              type="text"
              placeholder="https://drive.google.com/..."
              value={formState.newLink.externalUrl}
              onChange={(e) =>
                formState.setNewLink((prev) => ({
                  ...prev,
                  externalUrl: e.target.value,
                }))
              }
              className="border border-slate-300 rounded px-2 py-1.5 text-base sm:text-xs flex-grow min-w-0 bg-white text-slate-800"
            />
            <Button
              size="sm"
              onClick={() => {
                if (
                  formState.newLink.title.trim() &&
                  formState.newLink.externalUrl.trim()
                ) {
                  const url = formState.newLink.externalUrl.trim();
                  const isDrive = url.includes("google.com");
                  formState.setAttachments((prev) => [
                    ...prev,
                    {
                      fileName: formState.newLink.title.trim(),
                      storageType: isDrive ? "GOOGLE_DRIVE" : "EXTERNAL_LINK",
                      externalUrl: url,
                      fileType: "SPEC_SHEET",
                    },
                  ]);
                  formState.setNewLink({ title: "", externalUrl: "" });
                }
              }}
            >
              🔗 追加
            </Button>
          </div>

          {formState.attachments.length > 0 && (
            <ul className="text-[11px] bg-white rounded border divide-y divide-slate-100 max-h-60 overflow-y-auto mt-2">
              {formState.attachments.map((att, idx) => {
                const isR2File = att.storageType === "R2";
                // 保存前にアップロード/追加したばかりの添付ファイルはまだDBに登録されておらず、
                // DB経由のURLを組み立てられないため一旦リンク無効化(保存後は閲覧可能)
                const finalHref =
                  att.id && editingId
                    ? `/api/products/images/${editingId}/${att.id}`
                    : isR2File
                      ? undefined
                      : att.externalUrl || "#";

                return (
                  <li
                    key={idx}
                    className="p-2.5 flex flex-col space-y-2 hover:bg-slate-50"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-start space-x-2 truncate mr-2 w-full">
                        <span className="shrink-0 mt-0.5">
                          {att.fileType === "IMAGE" ? "🖼️" : "📄"}
                        </span>
                        <div className="flex flex-col truncate w-full">
                          <span className="font-bold text-slate-800 text-[11px] block truncate">
                            {att.fileName}
                          </span>
                          <a
                            href={finalHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline cursor-pointer text-[10px] truncate break-all block mt-0.5 font-mono"
                          >
                            {isR2File
                              ? `📥 [R2パス]: ${att.attachmentR2Path}`
                              : att.externalUrl}{" "}
                            ↗
                          </a>
                        </div>
                        <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0 font-bold">
                          {att.storageType}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          formState.setAttachments((prev) =>
                            prev.filter((_, i) => i !== idx),
                          )
                        }
                        className="text-red-500 font-bold hover:underline cursor-pointer text-[10px]"
                      >
                        削除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
            仕様説明・メモ
          </label>
          <textarea
            className={`${inputClass} h-12 resize-none`}
            value={formState.memo}
            onChange={(e) => formState.setMemo(e.target.value)}
            disabled={editingId ? !canUpdate : !canCreate}
          />
        </div>
      </fieldset>

      <div className="flex space-x-2">
        {editingId ? (
          isProductWfEnabled ? (
            <button
              type="submit"
              disabled={!isFormEditable || isLocked}
              className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white py-2 rounded text-xs font-bold shadow-sm cursor-pointer hover:from-violet-700 hover:to-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🔀 変更を申請する
            </button>
          ) : (
            <Button
              className="w-full"
              type="submit"
              disabled={!isFormEditable || isLocked}
            >
              保存
            </Button>
          )
        ) : isProductWfEnabled ? (
          <button
            type="submit"
            disabled={!isFormEditable || isLocked}
            className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-2.5 rounded-lg text-xs font-black tracking-wide shadow-md cursor-pointer hover:from-indigo-700 hover:to-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✨ 承認を申請する
          </button>
        ) : (
          <Button
            className="w-full"
            type="submit"
            disabled={!isFormEditable || isLocked}
          >
            登録
          </Button>
        )}
        {editingId && (
          <button
            type="button"
            onClick={() => {
              resetForm();
              onClear();
            }}
            className="w-1/3 bg-slate-200 text-slate-700 py-2 rounded text-xs font-bold shadow-sm hover:bg-slate-300"
          >
            取消
          </button>
        )}
      </div>
    </form>
  );
}
