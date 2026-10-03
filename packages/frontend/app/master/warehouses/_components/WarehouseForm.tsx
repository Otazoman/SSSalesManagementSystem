"use client";

import React from "react";
import { WEEKDAYS } from "../_types";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface WarehouseFormProps {
  form: ReturnType<
    typeof import("../_hooks/useWarehouseForm").useWarehouseForm
  >;
  canCreate: boolean;
  canUpdate: boolean;
  isWarehouseWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  onSubmitSuccess: () => void;
}

const inputClass = formFieldInputClass;
const selectClass = formFieldInputClass;

export function WarehouseForm({
  form,
  canCreate,
  canUpdate,
  isWarehouseWfEnabled = false,
  departments = [],
  onSubmitSuccess,
}: WarehouseFormProps) {
  const canSubmitFormBase = form.editingId ? canUpdate : canCreate;
  const isLocked = form.isWarehouseCurrentlyLocked;
  const canSubmitForm = canSubmitFormBase && !isLocked;

  const handleFormSubmit = async (e: React.SyntheticEvent) => {
    const success = await form.handleSubmit(e);
    if (success) {
      onSubmitSuccess();
    }
  };

  return (
    <form
      onSubmit={handleFormSubmit}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm relative"
    >
      {isLocked && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-black rounded-lg flex items-center space-x-2">
          <span>🔒</span>
          <span>
            このデータは現在、承認ワークフローの審査中(仮登録)のため、承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます。
          </span>
        </div>
      )}

      <div className="flex items-center justify-between border-b pb-1">
        <h3 className="text-xs font-bold text-slate-900">
          {form.editingId ? "📝 倉庫情報の修正変更" : "🏢 新規個別倉庫登録"}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
            倉庫コード
          </label>
          <input
            type="text"
            disabled={!canCreate || !!form.editingId}
            className={inputClass}
            placeholder="空欄で自動採番"
            value={form.formData.id}
            onChange={(e) => form.handleInputChange("id", e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
            倉庫名称 *
          </label>
          <input
            type="text"
            required
            disabled={!canSubmitForm}
            className={inputClass}
            value={form.formData.name}
            onChange={(e) => form.handleInputChange("name", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
          倉庫区分 *
        </label>
        <select
          disabled={!canSubmitForm}
          className={selectClass}
          value={form.formData.warehouseType}
          onChange={(e) =>
            form.handleInputChange("warehouseType", e.target.value)
          }
        >
          <option value="INTERNAL">🏭 自社倉庫</option>
          <option value="EXTERNAL">🚚 外部倉庫(指示書発行+実績入力)</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
            郵便番号
          </label>
          <input
            type="text"
            disabled={!canSubmitForm}
            className={inputClass}
            value={form.formData.postalCode}
            onChange={(e) =>
              form.handleInputChange("postalCode", e.target.value)
            }
          />
        </div>
        <div>
          <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
            電話番号
          </label>
          <input
            type="text"
            disabled={!canSubmitForm}
            className={inputClass}
            value={form.formData.phoneNumber}
            onChange={(e) =>
              form.handleInputChange("phoneNumber", e.target.value)
            }
          />
        </div>
        <div>
          <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
            FAX番号
          </label>
          <input
            type="text"
            disabled={!canSubmitForm}
            className={inputClass}
            value={form.formData.faxNumber}
            onChange={(e) =>
              form.handleInputChange("faxNumber", e.target.value)
            }
          />
        </div>
        <div>
          <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
            メールアドレス
          </label>
          <input
            type="email"
            disabled={!canSubmitForm}
            className={inputClass}
            value={form.formData.email}
            onChange={(e) => form.handleInputChange("email", e.target.value)}
            placeholder="example@example.com"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
            住所
          </label>
          {form.formData.address.trim() && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.formData.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 hover:text-blue-700 font-bold transition-colors"
            >
              <span>🗺️</span>
              <span>地図で見る</span>
            </a>
          )}
        </div>
        <input
          type="text"
          disabled={!canSubmitForm}
          className={inputClass}
          value={form.formData.address}
          onChange={(e) => form.handleInputChange("address", e.target.value)}
          placeholder="例: 東京都千代田区..."
        />
      </div>

      <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
        <span className="block text-[10px] font-bold text-slate-700">
          🕒 営業時間・受入仕様設定
        </span>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
              業務開始時間
            </label>
            <input
              type="time"
              disabled={!canSubmitForm}
              className={inputClass}
              value={form.formData.businessStartTime}
              onChange={(e) =>
                form.handleInputChange("businessStartTime", e.target.value)
              }
            />
          </div>
          <div>
            <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
              業務終了時間
            </label>
            <input
              type="time"
              disabled={!canSubmitForm}
              className={inputClass}
              value={form.formData.businessEndTime}
              onChange={(e) =>
                form.handleInputChange("businessEndTime", e.target.value)
              }
            />
          </div>
        </div>
        <div>
          <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
            保管・制限車両制限事項
          </label>
          <input
            type="text"
            disabled={!canSubmitForm}
            className={inputClass}
            value={form.formData.storageRestrictions}
            onChange={(e) =>
              form.handleInputChange("storageRestrictions", e.target.value)
            }
          />
        </div>
        <div>
          <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
            統制ステータス *
          </label>
          <select
            disabled={!canSubmitForm || isWarehouseWfEnabled}
            className={selectClass}
            value={form.formData.status}
            onChange={(e) => form.handleInputChange("status", e.target.value)}
          >
            <option value="temporary">仮登録</option>
            <option value="active">有効</option>
            <option value="suspended">無効</option>
          </select>
          {isWarehouseWfEnabled && (
            <p className="text-[10px] text-slate-600 mt-1">
              承認機能が有効なため、ステータスは一覧の「無効化」操作から申請してください。
            </p>
          )}
        </div>
      </div>

      {isWarehouseWfEnabled && (
        <ApplicantDepartmentSelect
          departments={departments}
          value={form.applicantDepartmentSurrogateId}
          onChange={form.setApplicantDepartmentSurrogateId}
        />
      )}

      {/* 📅 受付可能曜日 */}
      <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100 space-y-2">
        <span className="block text-[10px] font-black text-indigo-900">
          📅 トラック受付可能曜日・詳細指定
        </span>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {WEEKDAYS.map(({ key, label }) => {
            const dayData = form.formData.availableDays[key] || {
              checked: false,
              memo: "",
            };
            return (
              <div
                key={key}
                className="flex items-center space-x-2 bg-white p-2 rounded border border-slate-200"
              >
                <input
                  type="checkbox"
                  id={`day-${key}`}
                  disabled={!canSubmitForm}
                  checked={dayData.checked}
                  onChange={(e) =>
                    form.handleDayCheckChange(key, e.target.checked)
                  }
                  className="h-3.5 w-3.5 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <label
                  htmlFor={`day-${key}`}
                  className="text-[11px] font-bold text-slate-700 w-14"
                >
                  {label}
                </label>
                <input
                  type="text"
                  placeholder="時間枠や特記事項"
                  disabled={!canSubmitForm || !dayData.checked}
                  value={dayData.memo}
                  onChange={(e) =>
                    form.handleDayMemoChange(key, e.target.value)
                  }
                  className={`${inputClass} !py-1`}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 📎 添付ファイル */}
      <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
        <span className="block text-[10px] font-bold text-slate-700">
          📎 添付ファイル・各種図面・共有URL
        </span>
        <div>
          <input
            type="file"
            disabled={!canSubmitForm || form.uploading}
            onChange={form.handleFileUpload}
            className="text-xs block w-full text-slate-500 file:mr-4 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
          />
        </div>

        <div className="border-t pt-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              placeholder="URLのタイトル"
              value={form.extNameInput}
              onChange={(e) => form.setExtNameInput(e.target.value)}
              disabled={!canSubmitForm}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="https://..."
              value={form.extUrlInput}
              onChange={(e) => form.setExtUrlInput(e.target.value)}
              disabled={!canSubmitForm}
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={form.handleAddExternalLink}
            disabled={!canSubmitForm || !form.extUrlInput || !form.extNameInput}
            className="w-full text-[10px] bg-slate-200 text-slate-700 py-1 font-bold rounded hover:bg-slate-300 cursor-pointer"
          >
            URLリンクを追加
          </button>
        </div>

        {form.formData.attachments.length > 0 && (
          <div className="border-t pt-2 space-y-1 max-h-32 overflow-y-auto">
            {form.formData.attachments.map((att, idx) => (
              <div
                key={idx}
                className="flex justify-between items-center text-[11px] p-1.5 bg-white border rounded"
              >
                <span className="truncate max-w-[180px] font-bold text-indigo-600">
                  {att.fileName}
                </span>
                {canSubmitForm && (
                  <button
                    type="button"
                    onClick={() => form.handleRemoveAttachment(idx)}
                    className="text-red-500 font-bold text-[10px] hover:underline cursor-pointer ml-2"
                  >
                    削除
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="block text-[9px] font-bold text-slate-800 mb-0.5">
          備考・メモ
        </label>
        <textarea
          disabled={!canSubmitForm}
          className={`${inputClass} h-14 resize-none`}
          placeholder="特記事項を入力"
          value={form.formData.memo}
          onChange={(e) => form.handleInputChange("memo", e.target.value)}
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmitForm || form.isSubmitting}
        className={`w-full py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
          canSubmitForm && !form.isSubmitting
            ? isWarehouseWfEnabled
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 cursor-pointer"
              : "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            : "bg-slate-300 text-slate-500 cursor-not-allowed"
        }`}
      >
        {form.isSubmitting
          ? isWarehouseWfEnabled
            ? "⏳ 承認申請を送信中..."
            : "処理中..."
          : form.editingId
            ? isWarehouseWfEnabled
              ? "🔀 変更を申請する"
              : "変更をマスタへ保存"
            : isWarehouseWfEnabled
              ? "✨ 承認を申請する"
              : "登録"}
      </button>
    </form>
  );
}
