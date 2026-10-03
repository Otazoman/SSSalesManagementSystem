import React from "react";
import { PartnerMaster, UserOption, ProjectLookup } from "../_types";
import { SourceQuoteViewer } from "./SourceQuoteViewer";

interface OrderBasicFieldsProps {
  orderId: string;
  orderTitle: string;
  setOrderTitle: (v: string) => void;
  partnerId: string;
  onPartnerChange: (id: string) => void;
  partners: PartnerMaster[];
  sourceQuoteId: string | null;
  orderDate: string;
  setOrderDate: (v: string) => void;
  salesPersonEmployeeNumber: string;
  onSalesPersonChange: (id: string) => void;
  userMaster: UserOption[];
  salesPersonDepartment: string;
  setSalesPersonDepartment: (v: string) => void;
  departments: { id: string; name: string }[];
  // Item7残課題: 営業担当(見積から引き継ぐ)とは別の、実際にこの伝票を入力する担当者
  inputPersonEmployeeNumber: string;
  setInputPersonEmployeeNumber: (v: string) => void;
  // 追加要望: プロジェクト。見積からそのまま引き継ぎ、売上計上まで伝播させる
  projectId: string;
  setProjectId: (v: string) => void;
  projects: ProjectLookup[];
}

const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500";

export function OrderBasicFields({
  orderId,
  orderTitle,
  setOrderTitle,
  partnerId,
  onPartnerChange,
  partners,
  sourceQuoteId,
  orderDate,
  setOrderDate,
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
}: OrderBasicFieldsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div>
        <label className="block text-[10px] font-bold text-slate-600 mb-1">
          受注管理コード
        </label>
        <input
          type="text"
          disabled
          className={inputClass}
          value={orderId}
          placeholder="(保存時に自動採番されます)"
        />
      </div>
      <div className="lg:col-span-2">
        <label className="block text-[10px] font-bold text-slate-500 mb-1">
          受注件名 / プロジェクト名
        </label>
        <input
          type="text"
          className={inputClass}
          placeholder="例: 初期費用ご注文"
          value={orderTitle}
          onChange={(e) => setOrderTitle(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-500 mb-1">
          得意先 *
        </label>
        <select
          required
          className={`${inputClass} cursor-pointer`}
          value={partnerId}
          onChange={(e) => onPartnerChange(e.target.value)}
        >
          <option value="" disabled>
            -- 得意先を選択 --
          </option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              [{p.id}] {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-500 mb-1">
          受注日 *
        </label>
        <input
          type="date"
          required
          className={inputClass}
          value={orderDate}
          onChange={(e) => setOrderDate(e.target.value)}
        />
      </div>
      {sourceQuoteId && (
        <div>
          <label className="block text-[10px] font-bold text-slate-600 mb-1">
            対象見積
          </label>
          <input
            type="text"
            disabled
            className={`${inputClass} font-mono`}
            value={sourceQuoteId}
          />
          <div className="mt-1">
            <SourceQuoteViewer quoteId={sourceQuoteId} />
          </div>
        </div>
      )}
      <div>
        <label className="block text-[10px] font-bold text-slate-500 mb-1">
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
        <label className="block text-[10px] font-bold text-slate-500 mb-1">
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
        <label className="block text-[10px] font-bold text-slate-500 mb-1">
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
        <label className="block text-[10px] font-bold text-slate-500 mb-1">
          プロジェクト
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
