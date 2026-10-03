import { AttachmentRecord } from "../../../_shared/types/attachment";

export type ItemAttachment = AttachmentRecord<"IMAGE" | "SPEC_SHEET" | "OTHER">;

export interface ItemRecord {
  id: string;
  name: string;
  isPurchased: boolean;
  isSales: boolean;
  isService: boolean;
  baseUnitCode: string;
  taxCategoryCode: string; // ▼ 追加: 消費税区分コード
  productBarcode: string | null;
  accountCode: string | null;
  memo: string | null;
  standardSalesPrice?: number;
  standardPurchasePrice?: number;
  status: "temporary" | "active" | "suspended";
  supplierId: string | null;
  supplierPartNumber: string | null;
  attachments?: ItemAttachment[];
}

export interface AccountLookup {
  code: string;
  name: string;
}

export interface UnitLookup {
  code: string;
  name: string;
}

export interface SupplierLookup {
  id: string;
  name: string;
}

// ▼ 追加: 消費税マスタの参照型
export interface TaxCategoryLookup {
  code: string;
  name: string;
  taxType: "EXEMPT" | "STANDARD" | "VARIABLE";
  taxRate: number;
}
