import React from "react";
import {
  formFieldInputClass,
  formFieldLabelClass,
} from "../../../_shared/ui/FormField";
import { PartnerMaster, UserOption, ProjectLookup } from "../_types";
import { selectablePartners } from "../../../_shared/partner-options";

interface QuoteBasicFieldsProps {
  quoteId: string;
  quoteTitle: string;
  setQuoteTitle: (v: string) => void;
  customerId: string;
  onPartnerChange: (id: string) => void;
  partners: PartnerMaster[];
  quoteDate: string;
  setQuoteDate: (v: string) => void;
  validUntil: string;
  setValidUntil: (v: string) => void;
  salesPersonEmployeeNumber: string;
  onSalesPersonChange: (id: string) => void;
  userMaster: UserOption[];
  salesPersonDepartment: string;
  setSalesPersonDepartment: (v: string) => void;
  departments: { id: string; name: string }[];
  // Item7残課題(見積へも展開): 営業担当とは別の、実際にこの伝票を入力する担当者
  inputPersonEmployeeNumber: string;
  setInputPersonEmployeeNumber: (v: string) => void;
  // 追加要望: プロジェクト。受注作成時にそのまま引き継ぐ
  projectId: string;
  setProjectId: (v: string) => void;
  projects: ProjectLookup[];
}

const inputClass = formFieldInputClass;

export function QuoteBasicFields({
  quoteId,
  quoteTitle,
  setQuoteTitle,
  customerId,
  onPartnerChange,
  partners,
  quoteDate,
  setQuoteDate,
  validUntil,
  setValidUntil,
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
}: QuoteBasicFieldsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div>
        <label className={`${formFieldLabelClass} mb-1`}>見積管理コード</label>
        <input
          type="text"
          disabled
          className={inputClass}
          value={quoteId}
          placeholder="(保存時に自動採番されます)"
        />
      </div>
      <div className="lg:col-span-2">
        <label className={`${formFieldLabelClass} mb-1`}>
          見積件名 / プロジェクト名
        </label>
        <input
          type="text"
          className={inputClass}
          placeholder="例: 初期費用御見積"
          value={quoteTitle}
          onChange={(e) => setQuoteTitle(e.target.value)}
        />
      </div>
      <div>
        <label className={`${formFieldLabelClass} mb-1`}>得意先 *</label>
        <select
          required
          className={`${inputClass} cursor-pointer`}
          value={customerId}
          onChange={(e) => onPartnerChange(e.target.value)}
        >
          <option value="" disabled>
            -- 得意先を選択 --
          </option>
          {selectablePartners(partners, customerId).map((cust) => (
            <option key={cust.id} value={cust.id}>
              [{cust.id}] {cust.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={`${formFieldLabelClass} mb-1`}>見積作成日 *</label>
        <input
          type="date"
          required
          className={inputClass}
          value={quoteDate}
          onChange={(e) => setQuoteDate(e.target.value)}
        />
      </div>
      <div>
        <label className={`${formFieldLabelClass} mb-1`}>有効期限</label>
        <input
          type="date"
          className={inputClass}
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
        />
      </div>
      <div>
        <label className={`${formFieldLabelClass} mb-1`}>自社担当者 *</label>
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
        <label className={`${formFieldLabelClass} mb-1`}>担当者所属部署</label>
        <select
          className={`${inputClass} cursor-pointer`}
          value={salesPersonDepartment}
          onChange={(e) => setSalesPersonDepartment(e.target.value)}
        >
          <option value="">-- 部署を選択 --</option>
          {/* 「全社共通」などの特殊項目が必要な場合は追加 */}
          <option value="全社共通">全社共通</option>
          {departments.map((dept) => (
            <option key={dept.id} value={dept.id}>
              {dept.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={`${formFieldLabelClass} mb-1`}>
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
        <label className={`${formFieldLabelClass} mb-1`}>プロジェクト</label>
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
