export interface MailTemplateSetting {
  id: string;
  name: string;
  smtpFrom: string;
  ccAddress: string;
  bccAddress: string;
  subjectTemplate: string;
  bodyTemplate: string;
  // 追加要望L-3-b/c: 帳票PDFのファイル名プレフィックス(空=既定の名称)
  fileNamePrefix?: string | null;
  reportTemplatePath?: string | null;
  reportLayoutStatus?: "PENDING" | "READY" | "FAILED" | null;
  reportLayoutError?: string | null;
}

export interface UserProfile {
  id: string;
  name: string;
  roleId: string;
  permissions: string[];
}

export interface R2Item {
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  contentType?: string;
}

export type AssetFileType = "font" | "logo" | "seal";

export interface UploadStatus {
  message: string;
  isError: boolean;
}
