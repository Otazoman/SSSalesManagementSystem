import * as v from "valibot";

// 追加要望M-1: 商談管理(DB_DEALS)。backendの型定義とバリデーション

export const DEAL_STATUSES = ["OPEN", "WON", "LOST"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const ATTENDEE_KINDS = ["PROSPECT_CONTACT", "PARTNER_CONTACT", "EMPLOYEE", "FREE"] as const;
export type AttendeeKind = (typeof ATTENDEE_KINDS)[number];

const dateString = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, "日付はYYYY-MM-DD形式で指定してください"));
const timeString = v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻はHH:MM形式で指定してください"));
const optionalText = (max: number) => v.optional(v.nullable(v.pipe(v.string(), v.maxLength(max))));

// 面談者。FREE以外は refId(参照先)を指定し、氏名は参照先からサーバー側で解決してスナップショット保存する
export const AttendeeInputSchema = v.object({
  kind: v.picklist(ATTENDEE_KINDS),
  refId: v.optional(v.nullable(v.string())),
  // FREE(未登録の相手を自由記入)のみ必須。それ以外は無視して参照先の氏名を使う
  name: optionalText(100),
  note: optionalText(200),
});
export type AttendeeInput = v.InferOutput<typeof AttendeeInputSchema>;

// 次回までのタスク。idを指定すると既存タスクの更新(完了状態を保持)、省略すると新規
export const TaskInputSchema = v.object({
  id: v.optional(v.string()),
  title: v.pipe(v.string(), v.minLength(1, "タスク名は必須です"), v.maxLength(200)),
  dueDate: v.optional(v.nullable(dateString)),
  assigneeEmployeeNumber: v.optional(v.nullable(v.string())),
  isDone: v.optional(v.boolean()),
});
export type TaskInput = v.InferOutput<typeof TaskInputSchema>;

const dealFields = {
  partnerId: v.pipe(v.string(), v.minLength(1, "取引先(見込み客)は必須です")),
  title: v.pipe(v.string(), v.minLength(1, "商談名は必須です"), v.maxLength(200)),
  dealDate: dateString,
  startTime: v.optional(v.nullable(timeString)),
  endTime: v.optional(v.nullable(timeString)),
  location: optionalText(200),
  memo: optionalText(10000),
  status: v.optional(v.picklist(DEAL_STATUSES)),
  ownerEmployeeNumber: v.optional(v.nullable(v.string())),
  attendees: v.optional(v.array(AttendeeInputSchema)),
  tasks: v.optional(v.array(TaskInputSchema)),
  // 紐づける見積(同じ取引先の見積のみ)
  quoteIds: v.optional(v.array(v.string())),
};

export const RegisterDealSchema = v.object(dealFields);
export type RegisterDealPayload = v.InferOutput<typeof RegisterDealSchema>;

// 更新は全項目を置き換える(attendees/tasks/quoteIdsは指定した内容が最終状態になる)
export const UpdateDealSchema = v.object(dealFields);
export type UpdateDealPayload = v.InferOutput<typeof UpdateDealSchema>;

export const SearchDealsQuerySchema = v.object({
  partnerId: v.optional(v.string()),
  status: v.optional(v.picklist([...DEAL_STATUSES, "all"])),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  keyword: v.optional(v.string()),
  ownerEmployeeNumber: v.optional(v.string()),
  // "true"なら未完了タスクがある商談のみ
  openTasks: v.optional(v.string()),
  limit: v.optional(v.string()),
  // BUG-032: 指定すると、他の一覧と同じく {data, pagination} でページ単位に返す(未指定は従来どおり配列)
  page: v.optional(v.string()),
});
export type SearchDealsQuery = v.InferOutput<typeof SearchDealsQuerySchema>;

export const SetTaskDoneSchema = v.object({ isDone: v.boolean() });

export const ProspectContactInputSchema = v.object({
  partnerId: v.pipe(v.string(), v.minLength(1, "見込み客は必須です")),
  name: v.pipe(v.string(), v.minLength(1, "氏名は必須です"), v.maxLength(100)),
  departmentName: optionalText(100),
  position: optionalText(100),
  email: optionalText(200),
  phone: optionalText(50),
  memo: optionalText(1000),
});
export type ProspectContactInput = v.InferOutput<typeof ProspectContactInputSchema>;

export const SearchProspectContactsQuerySchema = v.object({ partnerId: v.optional(v.string()) });

export const QuoteCandidatesQuerySchema = v.object({ partnerId: v.pipe(v.string(), v.minLength(1)) });

export const OpenTasksQuerySchema = v.object({
  // 指定すると、その社員が担当のタスクのみ
  assigneeEmployeeNumber: v.optional(v.string()),
  // 指定すると、その取引先の商談のタスクのみ
  partnerId: v.optional(v.string()),
});
export type OpenTasksQuery = v.InferOutput<typeof OpenTasksQuerySchema>;
