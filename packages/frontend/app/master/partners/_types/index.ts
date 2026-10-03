import { AttachmentRecord } from "../../../_shared/types/attachment";

export type AttachmentItem = AttachmentRecord;

// ファームバンキング: 振込先口座(1取引先に複数持てる)。全銀「総合振込」フォーマット生成に使う
export interface BankAccountItem {
  id?: string;
  bankName: string;
  bankCode: string;
  branchName: string;
  branchCode: string;
  accountType: "ORDINARY" | "CURRENT";
  accountNumber: string;
  accountHolderName: string;
  isDefault: boolean;
  memo?: string;
}

export interface PartnerRecord {
  id: string;
  name: string;
  type: "CUSTOMER" | "SUPPLIER" | "BOTH" | "PROSPECT";
  postalCode: string | null;
  address: string | null;
  phone?: string;
  fax?: string;
  creditLimit: number;
  status: "temporary" | "active" | "suspended";
  memo: string | null;
  closingDay: number | null;
  paymentMonthOffset: number | null;
  paymentDay: number | null;
  paymentMethod?: string | null;
  // 追加要望L-4-a: 適格事業者番号(T+13桁)・法人番号(13桁)
  qualifiedInvoiceNumber?: string | null;
  corporateNumber?: string | null;
  antiSocialCheckStatus?: string;
  antiSocialCheckMemo?: string | null;
  contractDate?: string | Date | null;
  contractValidTo?: string | Date | null;
  attachments?: AttachmentItem[];
  bankAccounts?: BankAccountItem[];
}

// PROSPECT=見込み客(追加要望M-1: 商談管理の対象。受注・売上・請求・購買の取引先には選べない。見積・商談では選べる)
export type PartnerType = "CUSTOMER" | "SUPPLIER" | "BOTH" | "PROSPECT";
