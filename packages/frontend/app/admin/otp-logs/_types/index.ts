export interface PartnerLookup {
  id: string;
  name: string;
}

// Item6 Phase6-4フォローアップ: 「倉庫」検索条件用(出荷指示・入荷指示のOTPログのみ対象、見積は対象外)
export interface WarehouseLookup {
  id: string;
  name: string;
}

export interface OtpDownloadLogRecord {
  id: string;
  documentType: string;
  documentId: string;
  attachmentId: string;
  email: string;
  expiresAt: string | null;
  attemptCount: number;
  verifiedAt: string | null;
  createdAt: string | null;
  quoteTitle: string | null;
  partnerName: string | null;
}
