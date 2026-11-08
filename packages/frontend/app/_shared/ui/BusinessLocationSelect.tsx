"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../hooks/use-api-fetch";

// REQ-003: 見積・受注・売上の「発行元・自社情報」に、営業拠点マスタの住所などを展開する選択欄。
// 拠点を選ぶと、会社名は「会社名 拠点名」(例: ○○株式会社 大阪営業所)、郵便番号・住所・電話・FAX は拠点の値にする
// (拠点に登録が無い項目は会社マスタの値)。「選択しない」に戻すと、会社マスタ(会社設定)の値に戻す。
// 選んだ拠点は伝票に保存しない(展開した会社名・住所などが保存される)

export interface CompanyInfoValues {
  companyName: string;
  companyZip: string;
  companyAddress: string;
  companyTel: string;
  companyFax: string;
}

interface BusinessLocationOption {
  id: string;
  name: string;
  postalCode: string | null;
  address: string | null;
  phoneNumber: string | null;
  faxNumber?: string | null;
}

interface CompanySettings {
  company_name?: string;
  company_zip?: string;
  company_address?: string;
  company_tel?: string;
  company_fax?: string;
}

/** 選んだ拠点(または会社マスタ)から、自社情報の値を作る */
export function buildCompanyInfo(
  company: CompanySettings,
  location: BusinessLocationOption | null,
): CompanyInfoValues {
  const base: CompanyInfoValues = {
    companyName: company.company_name || "",
    companyZip: company.company_zip || "",
    companyAddress: company.company_address || "",
    companyTel: company.company_tel || "",
    companyFax: company.company_fax || "",
  };
  if (!location) return base;
  return {
    companyName: [base.companyName, location.name].filter(Boolean).join(" "),
    companyZip: location.postalCode || base.companyZip,
    companyAddress: location.address || base.companyAddress,
    companyTel: location.phoneNumber || base.companyTel,
    companyFax: location.faxNumber || base.companyFax,
  };
}

export function BusinessLocationSelect({
  onApply,
  disabled = false,
  className = "",
}: {
  onApply: (values: CompanyInfoValues) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [locations, setLocations] = useState<BusinessLocationOption[]>([]);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<BusinessLocationOption[]>("/api/business-locations?status=active")
      .then((list) => {
        if (!cancelled) setLocations(list);
      })
      .catch((err) => console.error("営業拠点マスタの取得に失敗しました", err));
    apiFetch<CompanySettings>("/api/company-settings")
      .then((settings) => {
        if (!cancelled) setCompany(settings);
      })
      .catch((err) => console.error("会社設定の取得に失敗しました", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (id: string) => {
    setSelectedId(id);
    if (!company) return;
    onApply(buildCompanyInfo(company, locations.find((l) => l.id === id) ?? null));
  };

  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-700 mb-0.5">営業拠点</label>
      <select
        aria-label="営業拠点"
        value={selectedId}
        disabled={disabled || !company}
        onChange={(e) => handleChange(e.target.value)}
        className={`w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-white text-slate-900 font-medium focus:border-indigo-600 focus:outline-none disabled:opacity-60 ${className}`}
      >
        <option value="">選択しない(会社マスタの値)</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <p className="text-[10px] text-slate-600 mt-0.5">
        選ぶと、下の会社名・住所・電話・FAX を拠点の値に置き換えます(会社名は「会社名 拠点名」)
      </p>
    </div>
  );
}
