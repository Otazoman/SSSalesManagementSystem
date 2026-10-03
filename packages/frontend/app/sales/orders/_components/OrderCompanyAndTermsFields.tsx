import React from "react";
import { PartnerDeliveryDestinationLookup } from "../_types";

interface OrderCompanyAndTermsFieldsProps {
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
  deliveryDestinationId: string;
  setDeliveryDestinationId: (v: string) => void;
  deliveryDestinations: PartnerDeliveryDestinationLookup[];
  paymentTerms: string;
  setPaymentTerms: (v: string) => void;
}

const inputClass =
  "w-full border border-slate-300 p-2 text-base sm:text-xs rounded bg-slate-50 text-slate-900 focus:bg-white focus:border-indigo-600 focus:outline-none transition-colors placeholder:text-slate-500 font-medium disabled:bg-slate-100 disabled:text-slate-500";

export function OrderCompanyAndTermsFields({
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
  deliveryDestinationId,
  setDeliveryDestinationId,
  deliveryDestinations = [],
  paymentTerms,
  setPaymentTerms,
}: OrderCompanyAndTermsFieldsProps) {
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-0.5">
              郵便番号
            </label>
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
          <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
            納品場所
          </label>
          <input
            type="text"
            className={inputClass}
            value={deliveryPlace}
            onChange={(e) => setDeliveryPlace(e.target.value)}
            placeholder="下の納品先選択、または直接入力"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-700 mb-0.5">
            納品場所(取引先の納品先から選択)
          </label>
          <select
            className={`${inputClass} cursor-pointer`}
            value={deliveryDestinationId}
            onChange={(e) => {
              const selectedId = e.target.value;
              setDeliveryDestinationId(selectedId);
              if (selectedId) {
                const selected = deliveryDestinations.find((d) => d.id === selectedId);
                if (selected) {
                  setDeliveryPlace(
                    selected.address ? `${selected.name}(${selected.address})` : selected.name,
                  );
                }
              }
            }}
          >
            <option value="">-- 納品先から選択 --</option>
            {deliveryDestinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
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
