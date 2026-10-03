"use client";

import { PartnerType, AttachmentItem, BankAccountItem } from "../_types";
import { Button } from "../../../_shared/ui/Button";
import { formFieldInputClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface PartnerFormProps {
  editingId: string | null;
  formData: any;
  isSubmitting: boolean;
  isFormEditable: boolean;
  isPartnerWfEnabled: boolean;
  isMasterCurrentlyLocked: boolean;
  departments?: ApplicantDepartmentOption[];
  applicantDepartmentSurrogateId?: string | null;
  setApplicantDepartmentSurrogateId?: (value: string) => void;
  extUrlInput: string;
  setExtUrlInput: (val: string) => void;
  extTitleInput: string;
  setExtTitleInput: (val: string) => void;
  handleInputChange: (field: any, value: any) => void;
  handleSubmit: (e: React.SyntheticEvent) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleAddExternalLink: () => void;
  handleRemoveAttachment: (index: number) => void;
  handleAddBankAccount: () => void;
  handleRemoveBankAccount: (index: number) => void;
  handleBankAccountChange: (
    index: number,
    field: keyof BankAccountItem,
    value: string | boolean,
  ) => void;
}

export default function PartnerForm({
  editingId,
  formData,
  isSubmitting,
  isFormEditable,
  isPartnerWfEnabled,
  isMasterCurrentlyLocked,
  departments = [],
  applicantDepartmentSurrogateId = null,
  setApplicantDepartmentSurrogateId = () => {},
  extUrlInput,
  setExtUrlInput,
  extTitleInput,
  setExtTitleInput,
  handleInputChange,
  handleSubmit,
  handleFileUpload,
  handleAddExternalLink,
  handleRemoveAttachment,
  handleAddBankAccount,
  handleRemoveBankAccount,
  handleBankAccountChange,
}: PartnerFormProps) {
  const dayOptions = [
    ...Array.from({ length: 28 }, (_, i) => ({
      value: i + 1,
      label: `${i + 1}日`,
    })),
    { value: 99, label: "月末" },
  ];

  const inputClass = formFieldInputClass;

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm relative"
    >
      {!isFormEditable && (
        <div className="absolute top-2 right-4 text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded">
          閲覧専用
        </div>
      )}
      {isMasterCurrentlyLocked && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-black rounded-lg flex items-center space-x-2">
          <span>🔒</span>
          <span>
            このデータは現在、承認ワークフローの審査中(仮登録)のため、承認または差戻しが決定されるまで上書き・再編集行為は完全ロックされます。
          </span>
        </div>
      )}

      <fieldset
        disabled={!isFormEditable || isSubmitting || isMasterCurrentlyLocked}
        className="space-y-4 w-full"
      >
        <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
          {editingId ? "取引先情報の編集" : "新規個別取引先登録"}
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              取引先コード
            </label>
            <input
              type="text"
              disabled={!!editingId}
              className={inputClass}
              placeholder="例: CUST-001(空欄で自動採番)"
              value={formData.id}
              onChange={(e) => handleInputChange("id", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              取引先名称
            </label>
            <input
              type="text"
              required
              className={inputClass}
              placeholder="例: 株式会社◯◯"
              value={formData.name}
              onChange={(e) => handleInputChange("name", e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              取引区分
            </label>
            <select
              className={`${inputClass} cursor-pointer`}
              value={formData.type}
              onChange={(e) =>
                handleInputChange("type", e.target.value as PartnerType)
              }
            >
              <option value="CUSTOMER">得意先</option>
              <option value="SUPPLIER">仕入先</option>
              <option value="BOTH">両方</option>
              <option value="PROSPECT">見込み客 (PROSPECT)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              郵便番号
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="例: 100-0001"
              value={formData.postalCode}
              onChange={(e) => handleInputChange("postalCode", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              与信限度額
            </label>
            <input
              type="number"
              className={inputClass}
              placeholder="例: 1000000"
              value={formData.creditLimit}
              onChange={(e) =>
                handleInputChange(
                  "creditLimit",
                  e.target.value === "" ? "" : Number(e.target.value),
                )
              }
            />
          </div>
        </div>

        {/* ➕ 連絡先(電話番号・FAX番号)エリアの追加 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              電話番号
            </label>
            <input
              type="tel"
              className={inputClass}
              placeholder="例: 03-1234-5678"
              value={formData.phone || ""}
              onChange={(e) => handleInputChange("phone", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              FAX番号
            </label>
            <input
              type="tel"
              className={inputClass}
              placeholder="例: 03-1234-5679"
              value={formData.fax || ""}
              onChange={(e) => handleInputChange("fax", e.target.value)}
            />
          </div>
        </div>

        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
          <h4 className="text-[10px] font-bold text-slate-700">
            📅 決済条件(回収・支払サイト)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                締め日 (日)
              </label>
              <select
                className={`${inputClass} cursor-pointer bg-white`}
                value={formData.closingDay}
                onChange={(e) =>
                  handleInputChange(
                    "closingDay",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              >
                <option value="">未指定(都度等)</option>
                {dayOptions.map((opt) => (
                  <option key={`close-${opt.value}`} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5 font-sans">
                支払月オフセット
              </label>
              <select
                className={`${inputClass} cursor-pointer bg-white`}
                value={formData.paymentMonthOffset}
                onChange={(e) =>
                  handleInputChange(
                    "paymentMonthOffset",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              >
                <option value="">未指定</option>
                <option value={0}>当月</option>
                <option value={1}>翌月</option>
                <option value={2}>翌々月</option>
                <option value={3}>3ヶ月後</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                支払い日 (日)
              </label>
              <select
                className={`${inputClass} cursor-pointer bg-white`}
                value={formData.paymentDay}
                onChange={(e) =>
                  handleInputChange(
                    "paymentDay",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              >
                <option value="">未指定</option>
                {dayOptions.map((opt) => (
                  <option key={`pay-${opt.value}`} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              支払方法
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="例: 銀行振込"
              value={formData.paymentMethod || ""}
              onChange={(e) =>
                handleInputChange("paymentMethod", e.target.value)
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              適格事業者番号(インボイス登録番号)
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="例: T1234567890123"
              maxLength={14}
              pattern="T[0-9]{13}"
              title="「T」+13桁の数字で入力してください"
              value={formData.qualifiedInvoiceNumber || ""}
              onChange={(e) =>
                handleInputChange("qualifiedInvoiceNumber", e.target.value)
              }
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              法人番号
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="例: 1234567890123"
              maxLength={13}
              pattern="[0-9]{13}"
              title="13桁の数字で入力してください"
              value={formData.corporateNumber || ""}
              onChange={(e) =>
                handleInputChange("corporateNumber", e.target.value)
              }
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              住所
            </label>
            {formData.address && formData.address.trim() && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formData.address)}`}
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
            className={inputClass}
            placeholder="例: 東京都千代田区..."
            value={formData.address}
            onChange={(e) => handleInputChange("address", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              取引ステータス
            </label>
            <select
              disabled={isPartnerWfEnabled}
              className={`${inputClass} ${isPartnerWfEnabled ? "bg-slate-100 text-slate-500 cursor-not-allowed" : "cursor-pointer"}`}
              value={formData.status}
              onChange={(e) => handleInputChange("status", e.target.value)}
            >
              <option value="active">有効</option>
              <option value="temporary">仮登録</option>
              <option value="suspended">無効</option>
            </select>
            {isPartnerWfEnabled && (
              <p className="text-[9px] text-indigo-600 font-bold mt-1">
                🛡️
                承認機能有効化のため、ステータス変更はワークフロー審査で行います。
              </p>
            )}
          </div>
        </div>

        {isPartnerWfEnabled && (
          <ApplicantDepartmentSelect
            departments={departments}
            value={applicantDepartmentSurrogateId}
            onChange={setApplicantDepartmentSurrogateId}
          />
        )}

        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
          <h4 className="text-[10px] font-bold text-slate-700">
            🛡️ コンプライアンス・契約情報
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                反社チェックステータス
              </label>
              <select
                className={inputClass}
                value={formData.antiSocialCheckStatus}
                onChange={(e) =>
                  handleInputChange("antiSocialCheckStatus", e.target.value)
                }
              >
                <option value="UNCHECKED">未確認 (UNCHECKED)</option>
                <option value="PASSED">問題なし (PASSED)</option>
                <option value="WARNING">要注意/審査保留 (WARNING)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
                契約締結日
              </label>
              <input
                type="date"
                className={inputClass}
                value={formData.contractDate}
                onChange={(e) =>
                  handleInputChange("contractDate", e.target.value)
                }
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
              反社チェック特記事項・メモ
            </label>
            <input
              type="text"
              placeholder="反社データベース照合結果など"
              className={inputClass}
              value={formData.antiSocialCheckMemo}
              onChange={(e) =>
                handleInputChange("antiSocialCheckMemo", e.target.value)
              }
            />
          </div>
        </div>

        {/* 添付ファイルエリア */}
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-3">
          <h4 className="text-[10px] font-bold text-slate-700">
            📎 添付ファイル・外部リンク
          </h4>
          {isFormEditable && !isMasterCurrentlyLocked && (
            <div className="space-y-2 border-b pb-2 border-slate-200">
              <div className="flex items-center space-x-2">
                <input
                  type="file"
                  id="cust-file-upload"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <label
                  htmlFor="cust-file-upload"
                  className="bg-slate-200 text-slate-700 font-bold px-2 py-1 rounded text-[10px] cursor-pointer hover:bg-slate-300"
                >
                  📁 ファイル添付 (PDF/画像等)
                </label>
              </div>
              <div className="flex space-x-1">
                <input
                  type="text"
                  placeholder="リンク名 (例: ドライブ共有フォルダ)"
                  className="w-1/2 p-1 border text-[10px] rounded bg-white text-slate-900"
                  value={extTitleInput}
                  onChange={(e) => setExtTitleInput(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="https://..."
                  className="w-1/2 p-1 border text-[10px] rounded bg-white text-slate-900"
                  value={extUrlInput}
                  onChange={(e) => setExtUrlInput(e.target.value)}
                />
                <Button size="sm" onClick={handleAddExternalLink}>
                  追加
                </Button>
              </div>
            </div>
          )}

          <ul className="space-y-1 max-h-24 overflow-y-auto">
            {formData.attachments?.map((att: AttachmentItem, index: number) => (
              <li
                key={index}
                className="flex justify-between items-center bg-white p-1 rounded border border-slate-200 text-[10px]"
              >
                <span className="truncate max-w-[80%] font-medium text-slate-700">
                  {att.storageType === "R2" ? "📄 " : "🔗 "}
                  {att.storageType === "R2" && (!att.id || !editingId) ? (
                    // 保存前にアップロードしたばかりの添付ファイルはまだDBに登録されておらず、
                    // DB経由のダウンロードURLを組み立てられないためリンク化しない(保存後は閲覧可能)
                    <span>{att.fileName}</span>
                  ) : (
                    <a
                      href={
                        att.storageType === "R2"
                          ? `/api/partners/files/${editingId}/${att.id}`
                          : att.externalUrl || "#"
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:underline"
                    >
                      {att.fileName}
                    </a>
                  )}
                </span>
                {isFormEditable && !isMasterCurrentlyLocked && (
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(index)}
                    className="text-red-500 font-bold px-1 hover:text-red-700 cursor-pointer"
                  >
                    削除
                  </button>
                )}
              </li>
            ))}
            {(!formData.attachments || formData.attachments.length === 0) && (
              <li className="text-[10px] text-slate-600 italic text-center py-2">
                添付ファイルや参照リンクはありません
              </li>
            )}
          </ul>
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="block text-[10px] font-bold text-slate-700">
              銀行口座(ファームバンキング用、複数登録可)
            </label>
            {isFormEditable && !isMasterCurrentlyLocked && (
              <button
                type="button"
                onClick={handleAddBankAccount}
                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
              >
                ＋口座を追加
              </button>
            )}
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {(formData.bankAccounts as BankAccountItem[] | undefined)?.map(
              (acc, index) => (
                <div
                  key={index}
                  className="bg-white border border-slate-200 rounded p-2 space-y-1.5"
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      placeholder="銀行名*"
                      className="p-1 border text-[10px] rounded bg-white text-slate-900"
                      value={acc.bankName}
                      disabled={!isFormEditable || isMasterCurrentlyLocked}
                      onChange={(e) =>
                        handleBankAccountChange(
                          index,
                          "bankName",
                          e.target.value,
                        )
                      }
                    />
                    <input
                      type="text"
                      placeholder="銀行コード(4桁)"
                      className="p-1 border text-[10px] rounded bg-white text-slate-900"
                      value={acc.bankCode}
                      disabled={!isFormEditable || isMasterCurrentlyLocked}
                      onChange={(e) =>
                        handleBankAccountChange(
                          index,
                          "bankCode",
                          e.target.value,
                        )
                      }
                    />
                    <input
                      type="text"
                      placeholder="支店名*"
                      className="p-1 border text-[10px] rounded bg-white text-slate-900"
                      value={acc.branchName}
                      disabled={!isFormEditable || isMasterCurrentlyLocked}
                      onChange={(e) =>
                        handleBankAccountChange(
                          index,
                          "branchName",
                          e.target.value,
                        )
                      }
                    />
                    <input
                      type="text"
                      placeholder="支店コード(3桁)"
                      className="p-1 border text-[10px] rounded bg-white text-slate-900"
                      value={acc.branchCode}
                      disabled={!isFormEditable || isMasterCurrentlyLocked}
                      onChange={(e) =>
                        handleBankAccountChange(
                          index,
                          "branchCode",
                          e.target.value,
                        )
                      }
                    />
                    <select
                      className="p-1 border text-[10px] rounded bg-white text-slate-900"
                      value={acc.accountType}
                      disabled={!isFormEditable || isMasterCurrentlyLocked}
                      onChange={(e) =>
                        handleBankAccountChange(
                          index,
                          "accountType",
                          e.target.value,
                        )
                      }
                    >
                      <option value="ORDINARY">普通</option>
                      <option value="CURRENT">当座</option>
                    </select>
                    <input
                      type="text"
                      placeholder="口座番号*"
                      className="p-1 border text-[10px] rounded bg-white text-slate-900"
                      value={acc.accountNumber}
                      disabled={!isFormEditable || isMasterCurrentlyLocked}
                      onChange={(e) =>
                        handleBankAccountChange(
                          index,
                          "accountNumber",
                          e.target.value,
                        )
                      }
                    />
                    <input
                      type="text"
                      placeholder="受取人名(全角/半角カナ)*"
                      className="p-1 border text-[10px] rounded bg-white text-slate-900 col-span-2"
                      value={acc.accountHolderName}
                      disabled={!isFormEditable || isMasterCurrentlyLocked}
                      onChange={(e) =>
                        handleBankAccountChange(
                          index,
                          "accountHolderName",
                          e.target.value,
                        )
                      }
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <label className="flex items-center gap-1 text-[10px] text-slate-500">
                      <input
                        type="checkbox"
                        checked={acc.isDefault}
                        disabled={!isFormEditable || isMasterCurrentlyLocked}
                        onChange={(e) =>
                          handleBankAccountChange(
                            index,
                            "isDefault",
                            e.target.checked,
                          )
                        }
                      />
                      既定口座にする
                    </label>
                    {isFormEditable && !isMasterCurrentlyLocked && (
                      <button
                        type="button"
                        onClick={() => handleRemoveBankAccount(index)}
                        className="text-red-500 font-bold px-1 hover:text-red-700 cursor-pointer text-[10px]"
                      >
                        削除
                      </button>
                    )}
                  </div>
                </div>
              ),
            )}
            {(!formData.bankAccounts || formData.bankAccounts.length === 0) && (
              <p className="text-[10px] text-slate-600 italic text-center py-2">
                登録済みの口座はありません
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
            備考・メモ
          </label>
          <textarea
            className={`${inputClass} h-16 resize-none`}
            placeholder="特記事項があれば入力"
            value={formData.memo}
            onChange={(e) => handleInputChange("memo", e.target.value)}
          />
        </div>
      </fieldset>

      {/* ボタン領域 */}
      <div className="pt-2">
        {editingId ? (
          isPartnerWfEnabled ? (
            <button
              type="submit"
              disabled={isSubmitting || isMasterCurrentlyLocked}
              className={`w-full py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${!isSubmitting && !isMasterCurrentlyLocked ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 cursor-pointer" : "bg-slate-300 text-slate-500 cursor-not-allowed"}`}
            >
              {isSubmitting
                ? "⏳ 変更申請を送信中..."
                : "🔀 変更を申請する"}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!isFormEditable || isSubmitting}
              className={`w-full py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${isFormEditable && !isSubmitting ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer" : "bg-slate-300 text-slate-500 cursor-not-allowed"}`}
            >
              {isSubmitting ? "処理中..." : "保存"}
            </button>
          )
        ) : isPartnerWfEnabled ? (
          <button
            type="submit"
            disabled={!isFormEditable || isSubmitting}
            className={`w-full py-2.5 rounded-lg text-xs font-black text-white tracking-wide transition-all duration-200 shadow-md ${isFormEditable && !isSubmitting ? "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 cursor-pointer hover:shadow-lg active:scale-[0.99]" : "bg-slate-300 text-slate-500 cursor-not-allowed shadow-none"}`}
          >
            {isSubmitting
              ? "⏳ 承認リクエスト送信中..."
              : "✨ 承認を申請する"}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!isFormEditable || isSubmitting}
            className={`w-full py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${isFormEditable && !isSubmitting ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer" : "bg-slate-300 text-slate-500 cursor-not-allowed"}`}
          >
            {isSubmitting ? "登録処理中..." : "登録"}
          </button>
        )}
      </div>
    </form>
  );
}
