"use client";

import { useState, useEffect } from "react";
import { RoleRecord } from "../_types";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";

interface RoleFormProps {
  canCreate: boolean;
  canUpdate: boolean;
  editingId: string | null;
  roles: RoleRecord[];
  isSubmitting?: boolean;
  onCreate: (id: string, name: string, description: string) => Promise<void>;
  onUpdate: (id: string, name: string, description: string) => Promise<void>;
  onClose: () => void;
  setError: (err: string) => void;
}

export function RoleForm({
  canCreate,
  canUpdate,
  editingId,
  roles,
  isSubmitting = false,
  onCreate,
  onUpdate,
  onClose,
  setError,
}: RoleFormProps) {
  const [roleId, setRoleId] = useState("");
  const [roleName, setRoleName] = useState("");
  const [description, setDescription] = useState("");

  const isEditable = editingId ? canUpdate : canCreate;

  useEffect(() => {
    if (editingId) {
      const target = roles.find((r) => r.id === editingId);
      if (target) {
        setRoleId(target.id);
        setRoleName(target.name);
        setDescription(target.description || "");
      }
    } else {
      setRoleId("");
      setRoleName("");
      setDescription("");
    }
  }, [editingId, roles]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!isEditable || isSubmitting) return;

    const trimmedId = roleId.trim();
    const trimmedName = roleName.trim();

    if (!trimmedId || !trimmedName) {
      setError("ロールIDおよびロール名は必須入力項目です");
      return;
    }

    if (editingId) {
      await onUpdate(editingId, trimmedName, description.trim());
    } else {
      await onCreate(trimmedId, trimmedName, description.trim());
    }
  };

  const inputClass = formFieldInputClass;

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white p-5 rounded-lg space-y-4 border border-slate-200 shadow-sm relative"
    >
      {!isEditable && (
        <div className="absolute top-2 right-4 text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded">
          閲覧専用
        </div>
      )}

      <fieldset
        disabled={!isEditable || isSubmitting}
        className="space-y-4 w-full"
      >
        <h3 className="text-xs font-bold text-slate-900 border-b pb-1">
          {editingId ? "業務ロール情報の編集" : "新規個別ロール登録"}
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="ロールID">
            <input
              type="text"
              required
              disabled={!!editingId}
              className={inputClass}
              placeholder="例: finance_checker"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            />
          </FormField>
          <FormField label="ロール表示名">
            <input
              type="text"
              required
              className={inputClass}
              placeholder="例: 経理検収担当"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="職責説明・概要">
          <textarea
            className={`${inputClass} h-20 resize-none`}
            placeholder="このロールが持つ職責や権限の概要を記入します。"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
      </fieldset>

      <div className="pt-2">
        <button
          type="submit"
          disabled={!isEditable || isSubmitting}
          className={`w-full py-2 rounded text-xs font-bold text-white transition-colors shadow-sm ${
            isEditable && !isSubmitting
              ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
              : "bg-slate-300 text-slate-500 cursor-not-allowed"
          }`}
        >
          {isSubmitting ? "処理中..." : editingId ? "保存" : "登録"}
        </button>
      </div>
    </form>
  );
}
