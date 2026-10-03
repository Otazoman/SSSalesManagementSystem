"use client";

import { PartnerLookup, WarehouseLookup } from "../_types";
import { Button } from "../../../_shared/ui/Button";
import { formFieldInputClass } from "../../../_shared/ui/FormField";

const DOCUMENT_TYPE_OPTIONS = [
  { value: "", label: "すべての種別" },
  { value: "sales_quote", label: "見積書" },
  { value: "shipment_instruction", label: "出荷指示書" },
  { value: "receipt_instruction", label: "入荷指示書" },
  { value: "sales_order", label: "注文請書" },
  { value: "purchase_order", label: "発注書" },
  { value: "acceptance_inspection", label: "検収書" },
  { value: "delivery_note", label: "納品書" },
];

interface OtpLogSearchFormProps {
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  partnerId: string;
  setPartnerId: (v: string) => void;
  partners: PartnerLookup[];
  subject: string;
  setSubject: (v: string) => void;
  documentType: string;
  setDocumentType: (v: string) => void;
  warehouseId: string;
  setWarehouseId: (v: string) => void;
  warehouses: WarehouseLookup[];
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClear: () => void;
}

export function OtpLogSearchForm({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  email,
  setEmail,
  partnerId,
  setPartnerId,
  partners,
  subject,
  setSubject,
  documentType,
  setDocumentType,
  warehouseId,
  setWarehouseId,
  warehouses,
  loading,
  onSubmit,
  onClear,
}: OtpLogSearchFormProps) {
  const inputClass = formFieldInputClass;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between border-b pb-2 border-slate-100">
        <h2 className="text-xs font-bold text-slate-700">
          🔍 OTPダウンロード履歴を絞り込み検索
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-slate-600 font-bold hover:text-slate-600 cursor-pointer transition-colors"
        >
          条件をクリア
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {/* 1. 発行開始日時 */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              発行開始日時
            </label>
            <input
              type="datetime-local"
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          {/* 2. 発行終了日時 */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              発行終了日時
            </label>
            <input
              type="datetime-local"
              className={inputClass}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          {/* 3. 取引先 */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              取引先
            </label>
            <select
              className={`${inputClass} cursor-pointer`}
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
            >
              <option value="">すべての取引先</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* 4. メールアドレス */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">
              メールアドレス
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="入力されたダウンロード先アドレス"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* 5. 件名 */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">件名</label>
            <input
              type="text"
              className={inputClass}
              placeholder="見積の件名で検索(出荷指示書・入荷指示書は対象外)"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* 6. 種別 */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">種別</label>
            <select
              className={`${inputClass} cursor-pointer`}
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
            >
              {DOCUMENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* 7. 倉庫 */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500">倉庫</label>
            <select
              className={`${inputClass} cursor-pointer`}
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              title="出荷指示書・入荷指示書のみ対象(見積書は対象外)"
            >
              <option value="">すべての倉庫</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={loading}>
            {loading ? "処理中..." : "ログを検索 🔍"}
          </Button>
        </div>
      </form>
    </div>
  );
}
