import React from "react";

interface PurchaseRecognitionCompanyAndTermsFieldsProps {
  companyName: string;
  setCompanyName: (v: string) => void;
  companyAddress: string;
  setCompanyAddress: (v: string) => void;
  companyTel: string;
  setCompanyTel: (v: string) => void;
  companyFax: string;
  setCompanyFax: (v: string) => void;
  paymentTerms: string;
  setPaymentTerms: (v: string) => void;
}

const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500";

export function PurchaseRecognitionCompanyAndTermsFields({
  companyName,
  setCompanyName,
  companyAddress,
  setCompanyAddress,
  companyTel,
  setCompanyTel,
  companyFax,
  setCompanyFax,
  paymentTerms,
  setPaymentTerms,
}: PurchaseRecognitionCompanyAndTermsFieldsProps) {
  return (
    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
      <div className="space-y-2">
        <h4 className="text-xs font-black text-slate-700 border-b pb-1">
          🏢 発行元・自社情報の変更
        </h4>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
            会社名
          </label>
          <input
            type="text"
            className={inputClass}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
            社屋住所
          </label>
          <input
            type="text"
            className={inputClass}
            value={companyAddress}
            onChange={(e) => setCompanyAddress(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
              TEL
            </label>
            <input
              type="text"
              className={inputClass}
              value={companyTel}
              onChange={(e) => setCompanyTel(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
              FAX
            </label>
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
          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
            支払条件
          </label>
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
