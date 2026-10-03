"use client";

import React from "react";
import { MasterItem, MasterPartner, UnitLookup } from "../_types";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface PriceFormProps {
  form: ReturnType<
    typeof import("../_hooks/usePriceOperations").usePriceOperations
  >;
  canCreate: boolean;
  canUpdate: boolean;
  isProductPriceWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  onSubmitSuccess: () => void;
}

const inputClass = formFieldInputClass;

export function PriceForm({
  form,
  canCreate,
  canUpdate,
  isProductPriceWfEnabled = false,
  departments = [],
  onSubmitSuccess,
}: PriceFormProps) {
  const isFormEditable = form.editingId ? canUpdate : canCreate;

  const handleFormSubmit = async (e: React.SyntheticEvent) => {
    const success = await form.handleSubmit(e);
    if (success) {
      onSubmitSuccess();
    }
  };

  const isLocked = form.isPriceCurrentlyLocked;

  return (
    <form
      onSubmit={handleFormSubmit}
      className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-3 relative"
    >
      {!isFormEditable && (
        <div className="absolute top-2 right-4 text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded">
          閲覧専用(操作権限なし)
        </div>
      )}

      {isLocked && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-black rounded-lg flex items-center space-x-2">
          <span>🔒</span>
          <span>
            このデータは現在、承認ワークフローの審査中(仮登録)のため、承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます。
          </span>
        </div>
      )}

      <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
        {form.editingId
          ? "📝 特値・個別価格の編集修正"
          : "🔏 特値・個別価格の個別登録"}
      </h3>

      <fieldset disabled={!isFormEditable || isLocked} className="space-y-3">
        <FormField label="対象品目" required>
          <select
            required
            disabled={!!form.editingId || !isFormEditable}
            className={`${inputClass} cursor-pointer`}
            value={form.formData.itemId}
            onChange={(e) => form.handleInputChange("itemId", e.target.value)}
          >
            <option value="">-- 品目を選択 --</option>
            {form.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.id}: {i.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="単価区分" required>
          <select
            disabled={!!form.editingId || !isFormEditable}
            className={`${inputClass} cursor-pointer`}
            value={form.formData.priceType}
            onChange={(e) =>
              form.handleInputChange("priceType", e.target.value)
            }
          >
            <option value="SALES">SALES (販売特値)</option>
            <option value="PURCHASE">PURCHASE (仕入特値)</option>
          </select>
        </FormField>

        <FormField label="特定取引先 (空欄なら標準単価扱い)">
          <select
            disabled={!!form.editingId || !isFormEditable}
            className={`${inputClass} cursor-pointer`}
            value={form.formData.partnerId}
            onChange={(e) =>
              form.handleInputChange("partnerId", e.target.value)
            }
          >
            <option value="">-- すべての取引先・標準単価 --</option>
            {form.partners.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>

        <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border rounded-lg">
          <FormField label="適用最小数量" required>
            <input
              type="number"
              required
              disabled={!isFormEditable}
              className={`${inputClass} border-indigo-200 font-bold focus:border-indigo-600`}
              value={form.formData.minQuantity}
              onChange={(e) =>
                form.handleInputChange("minQuantity", Number(e.target.value))
              }
            />
          </FormField>
          <FormField label="適用契約単価" required>
            <input
              type="number"
              required
              disabled={!isFormEditable}
              className={`${inputClass} border-indigo-200 font-bold focus:border-indigo-600`}
              value={form.formData.unitPrice}
              onChange={(e) =>
                form.handleInputChange("unitPrice", Number(e.target.value))
              }
            />
          </FormField>
        </div>

        <FormField label="価格適用管理単位">
          <select
            disabled
            className={`${inputClass} bg-slate-50 text-slate-500 cursor-not-allowed`}
            value={form.formData.unitCode}
          >
            {form.units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.code} ({u.name})
              </option>
            ))}
          </select>
          <p className="text-[10px] text-slate-600 mt-1">
            対象品目の品目マスタに登録されている基本単位と自動連動します(個別選択不可)。
          </p>
        </FormField>

        <FormField label="ステータス">
          <select
            disabled={!isFormEditable || isProductPriceWfEnabled}
            className={`${inputClass} cursor-pointer`}
            value={form.formData.status}
            onChange={(e) => form.handleInputChange("status", e.target.value)}
          >
            <option value="active">有効</option>
            <option value="temporary">仮登録</option>
            <option value="suspended">無効</option>
          </select>
          {isProductPriceWfEnabled && (
            <p className="text-[10px] text-slate-600 mt-1">
              承認機能が有効なため、ステータスは一覧の「無効化」操作から申請してください。
            </p>
          )}
        </FormField>

        {isProductPriceWfEnabled && (
          <ApplicantDepartmentSelect
            departments={departments}
            value={form.applicantDepartmentSurrogateId}
            onChange={form.setApplicantDepartmentSurrogateId}
          />
        )}
      </fieldset>

      <button
        type="submit"
        disabled={!isFormEditable || form.isSubmitting || isLocked}
        className={`w-full py-2 rounded text-xs font-bold shadow-sm transition-colors ${
          isFormEditable && !form.isSubmitting && !isLocked
            ? isProductPriceWfEnabled
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white cursor-pointer hover:from-violet-700 hover:to-indigo-700"
              : "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
            : "bg-slate-300 text-slate-500 cursor-not-allowed"
        }`}
      >
        {form.isSubmitting
          ? isProductPriceWfEnabled
            ? "⏳ 承認申請を送信中..."
            : "処理中..."
          : form.editingId
            ? isProductPriceWfEnabled
              ? "🔀 変更を申請する"
              : "保存"
            : isProductPriceWfEnabled
              ? "✨ 承認を申請する"
              : "登録"}
      </button>
    </form>
  );
}
