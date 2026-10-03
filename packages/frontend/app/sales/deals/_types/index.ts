// 追加要望M-1: 商談管理。backend `routes/sales/deals` のレスポンス形と対応

export type DealStatus = "OPEN" | "WON" | "LOST";

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  OPEN: "商談中",
  WON: "受注(成約)",
  LOST: "失注",
};

export type AttendeeKind = "PROSPECT_CONTACT" | "PARTNER_CONTACT" | "EMPLOYEE" | "FREE";

export const ATTENDEE_KIND_LABELS: Record<AttendeeKind, string> = {
  PROSPECT_CONTACT: "見込客担当者",
  PARTNER_CONTACT: "取引先担当者",
  EMPLOYEE: "自社",
  FREE: "その他(未登録)",
};

export interface DealSummary {
  id: string;
  partnerId: string;
  partnerName: string | null;
  title: string;
  dealDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  status: DealStatus;
  ownerEmployeeNumber: string | null;
  ownerName: string | null;
  attendeeNames: string[];
  taskCount: number;
  openTaskCount: number;
  attachmentCount: number;
  quoteIds: string[];
}

export interface DealAttendee {
  id?: string;
  kind: AttendeeKind;
  refId: string | null;
  name: string;
  note: string | null;
}

export interface DealTask {
  id?: string;
  title: string;
  dueDate: string | null;
  assigneeEmployeeNumber: string | null;
  assigneeName?: string | null;
  isDone: boolean;
}

export interface DealAttachment {
  id: string;
  fileName: string;
  fileType: string;
  uploadedAt: string;
}

export interface DealQuoteRef {
  id: string;
  title: string | null;
  status: string;
  quoteDate: string | null;
  totalAmount: number;
}

export interface DealDetail {
  id: string;
  partnerId: string;
  partnerName: string | null;
  title: string;
  dealDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  memo: string | null;
  status: DealStatus;
  ownerEmployeeNumber: string | null;
  ownerName: string | null;
  attendees: DealAttendee[];
  tasks: DealTask[];
  attachments: DealAttachment[];
  quotes: DealQuoteRef[];
}

// 未完了タスク一覧の1行(商談情報つき)
export interface OpenTask extends DealTask {
  id: string;
  dealId: string;
  dealTitle: string | null;
  partnerId: string | null;
  partnerName: string | null;
}

export interface ProspectContact {
  id: string;
  partnerId: string;
  name: string;
  departmentName: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  memo: string | null;
}

export interface PartnerContactCandidate {
  id: string;
  name: string;
  departmentName: string | null;
}

export interface AttendeeCandidates {
  partnerContacts: PartnerContactCandidate[];
  prospectContacts: ProspectContact[];
}

export interface PartnerOption {
  id: string;
  name: string;
  type?: string;
}

export interface EmployeeOption {
  employeeNumber: string;
  name: string;
}

export interface DealFilters {
  partnerId: string;
  status: DealStatus | "all";
  keyword: string;
  startDate: string;
  endDate: string;
  openTasks: boolean;
}

export const EMPTY_FILTERS: DealFilters = {
  partnerId: "",
  status: "all",
  keyword: "",
  startDate: "",
  endDate: "",
  openTasks: false,
};

// 商談の対象にできる取引先の種別(見込み客のほか、既存顧客への追加提案の商談も記録できる)
export const DEAL_PARTNER_TYPES = ["PROSPECT", "CUSTOMER", "BOTH"];
