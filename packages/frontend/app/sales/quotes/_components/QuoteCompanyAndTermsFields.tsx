import React from "react";
import {
  formFieldInputClass,
  formFieldLabelClass,
} from "../../../_shared/ui/FormField";

interface QuoteCompanyAndTermsFieldsProps {
  companyName: string;
  setCompanyName: (v: string) => void;
  companyZip: string;
  setCompanyZip: (v: string) => void;
  companyAddress: string;
  setCompanyAddress: (v: string) => void;
  companyTel: string;
  setCompanyTel: (v: string) => void;
  companyFax: string;
  setCompanyFax: (v: string) => void;
  deliveryDate: string;
  setDeliveryDate: (v: string) => void;
  deliveryPlace: string;
  setDeliveryPlace: (v: string) => void;
  paymentTerms: string;
  setPaymentTerms: (v: string) => void;
}

const inputClass = formFieldInputClass;

export function QuoteCompanyAndTermsFields({
  companyName,
  setCompanyName,
  companyZip,
  setCompanyZip,
  companyAddress,
  setCompanyAddress,
  companyTel,
  setCompanyTel,
  companyFax,
  setCompanyFax,
  deliveryDate,
  setDeliveryDate,
  deliveryPlace,
  setDeliveryPlace,
  paymentTerms,
  setPaymentTerms,
}: QuoteCompanyAndTermsFieldsProps) {
  return (
    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
      <div className="space-y-2">
        <h4 className="text-xs font-black text-slate-700 border-b pb-1">
          🏢 発行元・自社情報の変更
        </h4>
        <div>
          <label className={`${formFieldLabelClass} mb-0.5`}>会社名</label>
          <input
            type="text"
            className={inputClass}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className={`${formFieldLabelClass} mb-0.5`}>郵便番号</label>
            <input
              type="text"
              placeholder="100-0005"
              className={inputClass}
              value={companyZip}
              onChange={(e) => setCompanyZip(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={`${formFieldLabelClass} mb-0.5`}>社屋住所</label>
          <input
            type="text"
            className={inputClass}
            value={companyAddress}
            onChange={(e) => setCompanyAddress(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={`${formFieldLabelClass} mb-0.5`}>TEL</label>
            <input
              type="text"
              className={inputClass}
              value={companyTel}
              onChange={(e) => setCompanyTel(e.target.value)}
            />
          </div>
          <div>
            <label className={`${formFieldLabelClass} mb-0.5`}>FAX</label>
            <input
              type="text"
              className={inputClass}
              value={companyFax}
              onChange={(e) => setCompanyFax(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <h4 className="text-xs font-black text-slate-700 border-b pb-1">
          📋 帳票印字・取引条件の変更
        </h4>
        <div>
          <label className={`${formFieldLabelClass} mb-0.5`}>
            納期期限設定
          </label>
          <input
            type="text"
            className={inputClass}
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </div>
        <div>
          <label className={`${formFieldLabelClass} mb-0.5`}>納品場所</label>
          <input
            type="text"
            className={inputClass}
            value={deliveryPlace}
            onChange={(e) => setDeliveryPlace(e.target.value)}
          />
        </div>
        <div>
          <label className={`${formFieldLabelClass} mb-0.5`}>支払条件</label>
          <input
            type="text"
            className={inputClass}
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
