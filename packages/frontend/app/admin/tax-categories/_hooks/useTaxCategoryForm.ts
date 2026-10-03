import { useState, useEffect } from "react";
import { TaxCategoryRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

export function useTaxCategoryForm(
  initialData: TaxCategoryRecord | null,
  canCreate: boolean,
  canUpdate: boolean,
  onSuccess: (msg: string) => void,
  onError: (msg: string) => void,
) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [taxType, setTaxType] = useState<"EXEMPT" | "STANDARD" | "VARIABLE">(
    "STANDARD",
  );
  const [taxRate, setTaxRate] = useState<number>(0.1);

  useEffect(() => {
    if (initialData) {
      setCode(initialData.code);
      setName(initialData.name);
      setTaxType(initialData.taxType);
      setTaxRate(initialData.taxRate);
    } else {
      setCode("");
      setName("");
      setTaxType("STANDARD");
      setTaxRate(0.1);
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((initialData && !canUpdate) || (!initialData && !canCreate)) {
      onError("この操作をする権限がありません");
      return;
    }
    try {
      await apiFetch(initialData ? "/api/tax-categories" : "/api/tax-categories/register", {
        method: initialData ? "PUT" : "POST",
        json: { code, name, taxType, taxRate: Number(taxRate) },
        defaultErrorMessage: "更新に失敗しました",
      });
      onSuccess("消費税区分を保存しました");
    } catch (err: any) {
      onError(err.message);
    }
  };

  return {
    code,
    setCode,
    name,
    setName,
    taxType,
    setTaxType,
    taxRate,
    setTaxRate,
    handleSubmit,
  };
}
