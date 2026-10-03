import type { AttachmentRecord } from "../../../_shared/types/attachment";

export type { AttachmentRecord };

export interface AvailableDayRecord {
  id?: string;
  warehouseId?: string;
  availabledayOfWeek: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
  timeSlotMemo: string | null;
}

export interface WarehouseRecord {
  id: string;
  name: string;
  // Item6 Phase6-4: 自社倉庫("INTERNAL")/外部倉庫("EXTERNAL")の区分。既存倉庫は全てINTERNAL扱い
  warehouseType: "INTERNAL" | "EXTERNAL";
  postalCode: string | null;
  address: string | null;
  phoneNumber: string | null;
  faxNumber: string | null;
  email: string | null;
  businessStartTime: string | null;
  businessEndTime: string | null;
  storageRestrictions: string | null;
  status: string;
  memo: string | null;
  availableDays?: AvailableDayRecord[];
  attachments?: AttachmentRecord[];
}

export const WEEKDAYS = [
  { key: "MON", label: "月曜日" },
  { key: "TUE", label: "火曜日" },
  { key: "WED", label: "水曜日" },
  { key: "THU", label: "木曜日" },
  { key: "FRI", label: "金曜日" },
  { key: "SAT", label: "土曜日" },
  { key: "SUN", label: "日曜日" },
] as const;

export type WeekdayKey = (typeof WEEKDAYS)[number]["key"];
