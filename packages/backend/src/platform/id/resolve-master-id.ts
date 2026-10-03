import { Context } from "hono";
import { Env } from "../../types/env";
import { getCompanySettings } from "../kv/company-settings-cache";
import { generateFormattedCode, DocumentNumberFormatConfig } from "./generate-short-code";
import { MASTER_TYPES } from "./master-types";

// resolve-document-id.tsと同じ方針(会社設定master_code_formatsから、指定したマスタ種別の
// フォーマット設定を読む。未設定の種別はその種別の既定プレフィックス+4桁にフォールバック)
export async function getMasterCodeFormatConfig(
  c: Context<{ Bindings: Env }>,
  masterTypeKey: string,
): Promise<DocumentNumberFormatConfig> {
  const settings = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};
  const formats = (settings as Record<string, any>).master_code_formats || {};
  const def = MASTER_TYPES.find((m) => m.key === masterTypeKey);
  return (
    formats[masterTypeKey] || {
      usePrefix: true,
      prefix: def?.defaultPrefix || "M",
      digitCount: 4,
    }
  );
}

// コードが未入力(空欄)の場合にのみ呼び出す前提の生成専用関数(resolveConfiguredDocumentId()とは
// 異なり候補ID引数を持たない)。手入力されたコードが重複していた場合は、各マスタのcreate/register側が
// 従来通り明示的なエラーで弾く挙動を維持するため、ここでは「自動生成コードが重複した場合のみ」
// -1, -2... を付与して再試行する
export async function generateUniqueMasterCode(
  c: Context<{ Bindings: Env }>,
  masterTypeKey: string,
  existsFn: (id: string) => Promise<boolean>,
): Promise<string> {
  const config = await getMasterCodeFormatConfig(c, masterTypeKey);
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
