export interface MailDeliveryLogRecord {
  id: string;
  type: "email" | "slack";
  category: string;
  documentId: string;
  smtpFrom: string | null;
  recipientTo: string;
  recipientCc: string | null;
  subject: string;
  attachedR2Path: string | null;
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";
  errorMessage: string | null;
  performedById: string;
  performedAt: string;
}
