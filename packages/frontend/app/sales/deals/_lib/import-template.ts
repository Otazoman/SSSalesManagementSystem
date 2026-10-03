// 商談CSVインポートのテンプレート(ヘッダー+記入例)。ヘッダーはbackendの
// deals-csv-import.service.ts(DEALS_CSV_HEADERS)と完全に一致させること
export const DEALS_IMPORT_HEADERS = [
  "groupKey",
  "dealId",
  "partnerId",
  "title",
  "dealDate",
  "startTime",
  "endTime",
  "location",
  "memo",
  "status",
  "ownerEmployeeNumber",
  "quoteIds",
  "attendeeKind",
  "attendeeValue",
  "attendeeNote",
  "taskTitle",
  "taskDueDate",
  "taskAssigneeEmployeeNumber",
  "taskIsDone",
] as const;

// 記入例: 商談1件を3行で表現(2行目以降は商談本体の項目を空欄にして、面談者・タスクだけを追加する)。
// 取引先・社員・見積の番号は例のため、実際のマスタの値に置き換えてから取り込むこと
const EXAMPLE_ROWS: string[][] = [
  ["1", "", "PR-1", "初回ヒアリング", "2026-09-10", "10:00", "11:30", "先方本社", "予算感あり", "OPEN", "EMP001", "Q-1", "PROSPECT_CONTACT", "佐藤", "", "見積提出", "2026-09-17", "EMP001", "0"],
  ["1", "", "", "", "", "", "", "", "", "", "", "", "EMPLOYEE", "EMP002", "", "資料送付", "", "", "1"],
  ["1", "", "", "", "", "", "", "", "", "", "", "", "FREE", "山田様", "決裁者", "", "", "", ""],
];

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

// Excelで文字化けしないようBOM付き・CRLFで出力する
export function buildDealsImportTemplate(): string {
  const lines = [DEALS_IMPORT_HEADERS.join(","), ...EXAMPLE_ROWS.map((row) => row.map(quote).join(","))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function downloadDealsImportTemplate() {
  const blob = new Blob([buildDealsImportTemplate()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "deals_import_template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
