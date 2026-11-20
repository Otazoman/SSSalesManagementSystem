"use client";

import { useEffect, useState } from "react";
import { ProjectRecord } from "../_types";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { ApplicantDepartmentSelect } from "../../../_shared/ui/ApplicantDepartmentSelect";
import type { ApplicantDepartmentOption } from "../../../types";

interface ProjectFormProps {
  editingProject: ProjectRecord | null;
  onCancelEdit: () => void;
  onSubmit: (data: {
    id: string;
    name: string;
    memo: string;
    startDate: string;
    endDate: string;
  }) => Promise<unknown>;
  canCreate: boolean;
  canUpdate: boolean;
  isSubmitting?: boolean;
  // BUG-097: 承認 ON の時は「申請」になり、承認待ちの間は編集できない
  isProjectWfEnabled?: boolean;
  isProjectCurrentlyLocked?: boolean;
  departments?: ApplicantDepartmentOption[];
  applicantDepartmentSurrogateId?: string | null;
  setApplicantDepartmentSurrogateId?: (id: string) => void;
}

export function ProjectForm({
  editingProject,
  onCancelEdit,
  onSubmit,
  canCreate,
  canUpdate,
  isSubmitting = false,
  isProjectWfEnabled = false,
  isProjectCurrentlyLocked = false,
  departments = [],
  applicantDepartmentSurrogateId = null,
  setApplicantDepartmentSurrogateId = () => {},
}: ProjectFormProps) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (editingProject) {
      setId(editingProject.id);
      setName(editingProject.name);
      setMemo(editingProject.memo || "");
      setStartDate(
        editingProject.startDate ? editingProject.startDate.split("T")[0] : "",
      );
      setEndDate(
        editingProject.endDate ? editingProject.endDate.split("T")[0] : "",
      );
    } else {
      resetForm();
    }
  }, [editingProject]);

  const resetForm = () => {
    setId("");
    setName("");
    setMemo("");
    setStartDate("");
    setEndDate("");
  };

  const handleSubmitInternal = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    await onSubmit({ id, name, memo, startDate, endDate });
    if (!editingProject) {
      resetForm();
    }
  };

  const hasFormPermission = editingProject ? canUpdate : canCreate;
  const inputClass = formFieldInputClass;

  return (
    <form
      onSubmit={handleSubmitInternal}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm relative"
    >
      <fieldset
        disabled={!hasFormPermission || isSubmitting || isProjectCurrentlyLocked}
        className="space-y-4 w-full"
      >
        <div className="flex items-center justify-between border-b pb-1">
          <h3 className="text-xs font-bold text-slate-900">
            {editingProject
              ? "プロジェクト情報の編集"
              : "新規個別プロジェクト登録"}
          </h3>
          {!hasFormPermission && (
            <span className="text-[9px] bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded font-bold">
              閲覧専用
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="PJコード">
            <input
              type="text"
              disabled={!!editingProject}
              className={inputClass}
              placeholder="空欄で自動採番"
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </FormField>
          <FormField label="プロジェクト名称" required>
            <input
              type="text"
              required
              className={inputClass}
              placeholder="例: 本社移転プロジェクト"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="開始時期">
            <input
              type="date"
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </FormField>
          <FormField label="終了時期">
            <input
              type="date"
              className={inputClass}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </FormField>
        </div>

        {isProjectCurrentlyLocked && (
          <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            🔒 承認待ちのため、承認されるか差し戻されるまで変更できません
          </p>
        )}

        <FormField label="メモ">
          <textarea
            className={`${inputClass} h-16 resize-none`}
            placeholder="特記事項があれば入力"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </FormField>
        {isProjectWfEnabled && (
          <ApplicantDepartmentSelect
            departments={departments}
            value={applicantDepartmentSurrogateId}
            onChange={setApplicantDepartmentSurrogateId}
          />
        )}
      </fieldset>

      <div className="flex gap-2 pt-2">
        {editingProject && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="w-1/3 border border-slate-300 bg-white text-slate-600 py-2 rounded text-xs font-bold cursor-pointer hover:bg-slate-50 text-center shadow-sm"
          >
            キャンセル
          </button>
        )}
        <button
          type="submit"
          disabled={!hasFormPermission || isSubmitting || isProjectCurrentlyLocked}
          className={`py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
            hasFormPermission && !isSubmitting && !isProjectCurrentlyLocked
              ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          } ${editingProject ? "w-2/3" : "w-full"}`}
        >
          {isSubmitting
            ? "処理中..."
            : isProjectWfEnabled
              ? editingProject
                ? "変更を申請"
                : "仮登録して申請"
              : editingProject
                ? "保存"
                : "登録"}
        </button>
      </div>
    </form>
  );
}
