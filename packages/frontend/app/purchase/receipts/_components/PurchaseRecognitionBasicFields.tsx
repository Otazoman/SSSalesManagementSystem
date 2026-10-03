import React from "react";
import {
  PartnerMaster,
  UserOption,
  PurchaseRecognitionDocumentType,
  ProjectLookup,
} from "../_types";

interface PurchaseRecognitionBasicFieldsProps {
  recognitionId: string;
  recognitionTitle: string;
  setRecognitionTitle: (v: string) => void;
  partnerId: string;
  onPartnerChange: (id: string) => void;
  partners: PartnerMaster[];
  recognitionDate: string;
  setRecognitionDate: (v: string) => void;
  documentType: PurchaseRecognitionDocumentType;
  setDocumentType: (v: PurchaseRecognitionDocumentType) => void;
  originalRecognitionId: string;
  setOriginalRecognitionId: (v: string) => void;
  // 追加要望L-2-a: 元伝票の候補(同じ取引先の承認済みの通常仕入)
  originalCandidates?: { id: string; label: string }[];
  orderId: string;
  setOrderId: (v: string) => void;
  onOpenOrderPicker: () => void;
  purchasePersonEmployeeNumber: string;
  onPurchasePersonChange: (id: string) => void;
  userMaster: UserOption[];
  purchasePersonDepartment: string;
  setPurchasePersonDepartment: (v: string) => void;
  departments: { id: string; name: string }[];
  inputPersonEmployeeNumber: string;
  setInputPersonEmployeeNumber: (v: string) => void;
  // 追加要望: プロジェクト。発注からそのまま引き継ぐ。発注に依存しない単独仕入は手動選択できる
  projectId: string;
  setProjectId: (v: string) => void;
  projects: ProjectLookup[];
}

const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500";

export function PurchaseRecognitionBasicFields({
  recognitionId,
  recognitionTitle,
  setRecognitionTitle,
  partnerId,
  onPartnerChange,
  partners,
  recognitionDate,
  setRecognitionDate,
  documentType,
  setDocumentType,
  originalRecognitionId,
  setOriginalRecognitionId,
  originalCandidates = [],
  orderId,
  setOrderId,
  onOpenOrderPicker,
  purchasePersonEmployeeNumber,
  onPurchasePersonChange,
  userMaster,
  purchasePersonDepartment,
  setPurchasePersonDepartment,
  departments,
  inputPersonEmployeeNumber,
  setInputPersonEmployeeNumber,
  projectId,
  setProjectId,
  projects,
}: PurchaseRecognitionBasicFieldsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div>
        <label className="block text-[10px] font-bold text-slate-600 mb-1">
          仕入管理コード
        </label>
        <input
          type="text"
          disabled
          className={inputClass}
          value={recognitionId}
          placeholder="(保存時に自動採番されます)"
        />
      </div>
      <div className="lg:col-span-2">
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          仕入件名 / プロジェクト名
        </label>
        <input
          type="text"
          className={inputClass}
          placeholder="例: 定期仕入分 計上"
          value={recognitionTitle}
          onChange={(e) => setRecognitionTitle(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          伝票種別 *
        </label>
        <select
          required
          className={`${inputClass} cursor-pointer`}
          value={documentType}
          onChange={(e) =>
            setDocumentType(e.target.value as PurchaseRecognitionDocumentType)
          }
        >
          <option value="PURCHASE">通常仕入</option>
          <option value="RETURN">返品</option>
          <option value="DISCOUNT">値引</option>
          <option value="CORRECTION">赤伝(訂正)</option>
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          仕入先 *
        </label>
        <select
          required
          className={`${inputClass} cursor-pointer`}
          value={partnerId}
          onChange={(e) => onPartnerChange(e.target.value)}
        >
          <option value="" disabled>
            -- 仕入先を選択 --
          </option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              [{p.id}] {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          仕入計上日 *
        </label>
        <input
          type="date"
          required
          className={inputClass}
          value={recognitionDate}
          onChange={(e) => setRecognitionDate(e.target.value)}
        />
      </div>
      {documentType !== "PURCHASE" && (
        <div>
          <label className="block text-[10px] font-bold text-slate-700 mb-1">
            対象の元仕入伝票{" "}
            {documentType === "CORRECTION"
              ? "(任意。元伝票が無い自由入力の赤伝は空欄)"
              : "*"}
          </label>
          <input
            type="text"
            list="purchase-recognition-original-candidates"
            required={documentType !== "CORRECTION"}
            className={inputClass}
            placeholder="伝票番号を入力または候補から選択"
            value={originalRecognitionId}
            onChange={(e) => setOriginalRecognitionId(e.target.value)}
          />
          <datalist id="purchase-recognition-original-candidates">
            {originalCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </datalist>
        </div>
      )}
      <div className="lg:col-span-2">
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          対象発注(任意。単独仕入の場合は空欄のまま)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            disabled
            className={inputClass}
            placeholder="(発注から選択すると自動設定されます)"
            value={orderId}
          />
          <button
            type="button"
            onClick={() => onOpenOrderPicker()}
            className="shrink-0 text-[11px] bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold px-3 py-1.5 rounded hover:bg-indigo-100"
          >
            📦 発注から選択
          </button>
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          自社担当者 *
        </label>
        <select
          required
          className={`${inputClass} cursor-pointer`}
          value={purchasePersonEmployeeNumber}
          onChange={(e) => onPurchasePersonChange(e.target.value)}
        >
          <option value="" disabled>
            -- 担当者を選択 --
          </option>
          {userMaster.map((user) => (
            <option key={user.id} value={user.employeeNumber}>
              {user.name} ({user.employeeNumber})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          担当者所属部署
        </label>
        <select
          className={`${inputClass} cursor-pointer`}
          value={purchasePersonDepartment}
          onChange={(e) => setPurchasePersonDepartment(e.target.value)}
        >
          <option value="">-- 部署を選択 --</option>
          <option value="全社共通">全社共通</option>
          {departments.map((dept) => (
            <option key={dept.id} value={dept.id}>
              {dept.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          入力担当者{" "}
          <span className="font-normal text-slate-600">
            (実際にこの伝票を入力した担当者)
          </span>
        </label>
        <select
          className={`${inputClass} cursor-pointer`}
          value={inputPersonEmployeeNumber}
          onChange={(e) => setInputPersonEmployeeNumber(e.target.value)}
        >
          <option value="">-- 担当者を選択 --</option>
          {userMaster.map((user) => (
            <option key={user.id} value={user.employeeNumber}>
              {user.name} ({user.employeeNumber})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          プロジェクト{" "}
          <span className="font-normal text-slate-600">
            (対象発注から選択すると自動設定されます)
          </span>
        </label>
        <select
          className={`${inputClass} cursor-pointer`}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">-- プロジェクトを選択 --</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              [{project.id}] {project.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
