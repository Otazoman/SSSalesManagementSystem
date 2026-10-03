export interface ContactRecord {
  id: string;
  customerId: string;
  partnerId: string;
  contactType:
    "COMPANY_SALES" | "CUSTOMER_CONTACT" | "COMPANY_BUYER" | "SUPPLIER_CONTACT";
  internalUserId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  departmentName: string | null;
  isEmailTarget: boolean;
  /** メールで送る帳票(V-5)。キーは_shared/contact-document-types.ts */
  documentTypes?: string[];
  memo: string | null;
  status?: "temporary" | "active" | "suspended" | string;
}

import { IdNameLookup } from "../../../_shared/types/lookup";

export interface PartnerLookup {
  id: string;
  name: string;
  status: "active" | "temporary" | "suspended";
}

export type UserLookup = IdNameLookup;
