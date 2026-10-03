import React from "react";
import {
  PartnerMaster,
  UserOption,
  SalesInvoiceDocumentType,
  ProjectLookup,
} from "../_types";
import { selectablePartners } from "../../../_shared/partner-options";

interface SalesInvoiceBasicFieldsProps {
  invoiceId: string;
  invoiceTitle: string;
  setInvoiceTitle: (v: string) => void;
  partnerId: string;
  onPartnerChange: (id: string) => void;
  partners: PartnerMaster[];
  invoiceDate: string;
  setInvoiceDate: (v: string) => void;
  documentType: SalesInvoiceDocumentType;
  setDocumentType: (v: SalesInvoiceDocumentType) => void;
  originalInvoiceId: string;
  setOriginalInvoiceId: (v: string) => void;
  // 追加要望L-2-a: 元伝票の候補(同じ取引先の承認済みの通常売上)
  originalCandidates?: { id: string; label: string }[];
  salesOrderId: string;
  setSalesOrderId: (v: string) => void;
  onOpenOrderPicker: () => void;
  salesPersonEmployeeNumber: string;
  onSalesPersonChange: (id: string) => void;
  userMaster: UserOption[];
  salesPersonDepartment: string;
  setSalesPersonDepartment: (v: string) => void;
  departments: { id: string; name: string }[];
  inputPersonEmployeeNumber: string;
  setInputPersonEmployeeNumber: (v: string) => void;
  // 追加要望: プロジェクト。受注からそのまま引き継ぐ。受注に依存しない単独売上は手動選択できる
  projectId: string;
  setProjectId: (v: string) => void;
  projects: ProjectLookup[];
}

const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500";

export function SalesInvoiceBasicFields({
  invoiceId,
  invoiceTitle,
  setInvoiceTitle,
  partnerId,
  onPartnerChange,
  partners,
  invoiceDate,
  setInvoiceDate,
  documentType,
  setDocumentType,
  originalInvoiceId,
  setOriginalInvoiceId,
  originalCandidates = [],
  salesOrderId,
  setSalesOrderId,
  onOpenOrderPicker,
  salesPersonEmployeeNumber,
  onSalesPersonChange,
  userMaster,
  salesPersonDepartment,
  setSalesPersonDepartment,
  departments,
  inputPersonEmployeeNumber,
  setInputPersonEmployeeNumber,
  projectId,
  setProjectId,
  projects,
}: SalesInvoiceBasicFieldsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div>
        <label className="block text-[10px] font-bold text-slate-600 mb-1">
          売上管理コード
        </label>
        <input
          type="text"
          disabled
          className={inputClass}
          value={invoiceId}
          placeholder="(保存時に自動採番されます)"
        />
      </div>
      <div className="lg:col-span-2">
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          売上件名 / プロジェクト名
        </label>
        <input
          type="text"
          className={inputClass}
          placeholder="例: 定期納品分 売上計上"
          value={invoiceTitle}
          onChange={(e) => setInvoiceTitle(e.target.value)}
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
            setDocumentType(e.target.value as SalesInvoiceDocumentType)
          }
        >
          <option value="SALE">通常売上</option>
          <option value="RETURN">返品</option>
          <option value="DISCOUNT">値引</option>
          <option value="CORRECTION">赤伝(訂正)</option>
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          取引先 *
        </label>
        <select
          required
          className={`${inputClass} cursor-pointer`}
          value={partnerId}
          onChange={(e) => onPartnerChange(e.target.value)}
        >
          <option value="" disabled>
            -- 取引先を選択 --
          </option>
          {selectablePartners(partners, partnerId).map((p) => (
            <option key={p.id} value={p.id}>
              [{p.id}] {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-700 mb-1">
          売上計上日 *
        </label>
        <input
          type="date"
          required
          className={inputClass}
          value={invoiceDate}
          onChange={(e) => setInvoiceDate(e.target.value)}
        />
      </div>
      {documentType !== "SALE" && (
        <div>
          <label className="block text-[10px] font-bold text-slate-700 mb-1">
            対象の元の売上{" "}
            {documentType === "CORRECTION"
              ? "(任意。元伝票が無い自由入力の赤伝は空欄)"
              : "*"}
          </label>
          <input
            type="text"
            list="sales-invoice-original-candidates"
            required={documentType !== "CORRECTION"}
            className={inputClass}
            placeholder="伝票番号を入力または候補から選択"
            value={originalInvoiceId}
            onChange={(e) => setOriginalInvoiceId(e.target.value)}
          />
          <datalist id="sales-invoice-original-candidates">
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
          対象受注(任意。単独売上の場合は空欄のまま)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            disabled
            className={inputClass}
            placeholder="(受注から選択すると自動設定されます)"
            value={salesOrderId}
          />
          <button
            type="button"
            onClick={() => onOpenOrderPicker()}
            className="shrink-0 text-[11px] bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold px-3 py-1.5 rounded hover:bg-indigo-100"
          >
            📦 受注から選択
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
          value={salesPersonEmployeeNumber}
          onChange={(e) => onSalesPersonChange(e.target.value)}
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
          value={salesPersonDepartment}
          onChange={(e) => setSalesPersonDepartment(e.target.value)}
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
            (対象受注から選択すると自動設定されます)
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
