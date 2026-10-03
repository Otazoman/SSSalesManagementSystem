import { todayJst } from "../date/format-jst-date";

// 見積番号(quote-crud.service.ts)と同じ発想の短い管理番号。UUIDよりも人が読み書きしやすい。
export function generateShortCode(prefix: string): string {
  // BUG-043: Worker は UTC で動くため、日付部分は日本時間で作る
  const datePart = todayJst().replace(/-/g, "");
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${datePart}-${randomPart}`;
}

// 伝票番号フォーマット(会社設定で種別ごとに設定可能): プレフィックスの有無・桁数を可変にした版。
// generateShortCode()は後方互換のため変更せず残し、こちらは resolve-document-id.ts 専用の新関数とする
export interface DocumentNumberFormatConfig {
  usePrefix: boolean;
  prefix: string;
  digitCount: number; // 1〜10
}

// 日付部分は持たない: 桁数(digitCount)は番号部分の桁数そのものを表す
// (例: プレフィックスあり8桁 → "A-12345678"、プレフィックスなし8桁 → "12345678")
export function generateFormattedCode(config: DocumentNumberFormatConfig): string {
  const digitCount = Math.min(Math.max(config.digitCount, 1), 10);
  const max = Math.pow(10, digitCount);
  const min = Math.pow(10, digitCount - 1);
  const randomPart = String(Math.floor(min + Math.random() * (max - min))).padStart(digitCount, "0");
  return config.usePrefix && config.prefix ? `${config.prefix}-${randomPart}` : randomPart;
}

// candidateId(利用者が任意入力した管理番号)を優先し、未指定なら自動採番する。
// 衝突時はquote-crud.service.tsと同じ方式で末尾に -1, -2... を付与して再試行する。
export async function resolveUniqueId(
  candidateId: string | null | undefined,
  existsFn: (id: string) => Promise<boolean>,
  fallbackPrefix: string,
): Promise<string> {
  let id = candidateId?.trim() || "";
  if (!id) {
    id = generateShortCode(fallbackPrefix);
  }
  if (!(await existsFn(id))) return id;

  let baseId = id;
  const lastHyphenIndex = id.lastIndexOf("-");
  if (lastHyphenIndex !== -1) {
    const trailingPart = id.substring(lastHyphenIndex + 1);
    if (/^\d+$/.test(trailingPart)) {
      baseId = id.substring(0, lastHyphenIndex);
    }
  }
  let revNumber = 1;
  while (true) {
    const checkId = `${baseId}-${revNumber}`;
    if (!(await existsFn(checkId))) return checkId;
    revNumber++;
  }
}
