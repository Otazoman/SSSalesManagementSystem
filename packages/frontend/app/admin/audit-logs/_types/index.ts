export interface AuditLogRecord {
  id: string;
  userId: string;
  action: string;
  tableName: string;
  screenName: string;
  recordId: string;
  oldValues: string | null;
  newValues: string | null;
  performedAt: string;
}

export interface ResourceOption {
  key: string;
  label: string;
}
