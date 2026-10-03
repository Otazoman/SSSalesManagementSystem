"use client";

import { FormField, formFieldInputClass } from "./FormField";
import type { ApplicantDepartmentOption } from "../../types";

interface ApplicantDepartmentSelectProps {
  departments: ApplicantDepartmentOption[];
  value: string | null;
  onChange: (surrogateId: string) => void;
  disabled?: boolean;
}

/**
 * 追加要望F: 複数部門所属時の申請部門選択。
 * 申請者の所属部門が1件以下の場合は選択の余地が無いため何も描画しない
 * (単一部署のユーザーには画面上の変化が一切無い)。
 */
export function ApplicantDepartmentSelect({
  departments,
  value,
  onChange,
  disabled = false,
}: ApplicantDepartmentSelectProps) {
  if (departments.length <= 1) return null;

  return (
    <FormField
      label="申請部署"
      hint="複数の部署に所属しています。この申請の承認ルートに使う部署を選択してください。"
    >
      <select
        className={`${formFieldInputClass} cursor-pointer bg-white`}
        value={value || ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {departments.map((d) => (
          <option key={d.surrogateId} value={d.surrogateId}>
            {d.name} ({d.id})
          </option>
        ))}
      </select>
    </FormField>
  );
}
