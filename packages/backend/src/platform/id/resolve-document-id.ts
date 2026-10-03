import { Context } from "hono";
import { Env } from "../../types/env";
import { getCompanySettings } from "../kv/company-settings-cache";
import { generateFormattedCode, DocumentNumberFormatConfig } from "./generate-short-code";
import { DOCUMENT_TYPES } from "./document-types";

// 会社設定(document_number_formats)から、指定した伝票種別のフォーマット設定を読む
// (未設定の種別はその種別の既定プレフィックス+4桁にフォールバック)。
// quote-crud.service.tsのように「生成した番号にさらに独自のサフィックスを付けたい」
// (見積のVer.UP用"-0")場合は、これとgenerateFormattedCode()を直接組み合わせて使う
export async function getDocumentNumberFormatConfig(
  c: Context<{ Bindings: Env }>,
  documentTypeKey: string,
): Promise<DocumentNumberFormatConfig> {
  const settings = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
  const formats = (settings as Record<string, any>).document_number_formats || {};
  const def = DOCUMENT_TYPES.find((d) => d.key === documentTypeKey);
  return (
    formats[documentTypeKey] || {
      usePrefix: true,
      prefix: def?.defaultPrefix || "DOC",
      digitCount: 4,
    }
  );
}

// 会社設定(document_number_formats)を読み、伝票種別ごとに設定されたフォーマットで採番する。
// candidateId(ユーザー任意入力の管理番号、出荷指示書等の任意管理番号入力)が指定され、
// かつ未使用であればそのまま採用する(呼び出し元の既存ロジックとの互換を優先)。
// 衝突時はresolveUniqueId()と同じ「末尾に-1, -2...を付与して再試行」方式で解決する
export async function resolveConfiguredDocumentId(
  c: Context<{ Bindings: Env }>,
  documentTypeKey: string,
  existsFn: (id: string) => Promise<boolean>,
  candidateId?: string | null,
): Promise<string> {
  const trimmed = candidateId?.trim();
  if (trimmed) {
    if (!(await existsFn(trimmed))) return trimmed;
  }

  const config = await getDocumentNumberFormatConfig(c, documentTypeKey);
  const id = generateFormattedCode(config);
  if (!(await existsFn(id))) return id;

  const baseId = id;
  let revNumber = 1;
  while (true) {
    const checkId = `${baseId}-${revNumber}`;
    if (!(await existsFn(checkId))) return checkId;
    revNumber++;
  }
}
