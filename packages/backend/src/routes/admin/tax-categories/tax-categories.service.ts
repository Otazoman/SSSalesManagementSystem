import { Context } from "hono";
import { TaxCategoriesRepository } from "./tax-categories.repository";
import * as v from "valibot";
import { SaveTaxCategoryInput, saveTaxCategorySchema } from "./tax-categories.schema";
import { buildCsvContent, csvField, withBom } from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";

// BUG-039: CSVの列(画面の登録と同じ項目。validFrom・validTo は任意、日付は YYYY-MM-DD)
export const TAX_CATEGORY_CSV_HEADERS = ["code", "name", "taxType", "taxRate", "validFrom", "validTo"] as const;
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "admin_tax_categories";

export class TaxCategoriesService {
  private repo: TaxCategoriesRepository;

  constructor(d1: D1Database) {
    this.repo = new TaxCategoriesRepository(d1);
  }

  async getTaxCategories(sort?: SortQuery) {
    return await this.repo.getAllTaxCategories(sort);
  }

  async getTaxCategoriesPage(params: PaginationParams, sort?: SortQuery) {
    const [data, total] = await Promise.all([
      this.repo.getTaxCategoriesPage(params, sort),
      this.repo.countTaxCategories(),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async saveTaxCategory(
    c: Context<{ Bindings: Env }>,
    input: SaveTaxCategoryInput,
  ) {
    await this.repo.upsertTaxCategory(input);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SAVE_TAX_CATEGORY", RESOURCE_KEY, input.code, null, {
      name: input.name,
      taxRate: input.taxRate,
    }),
    );
  }

  // BUG-039: CSVダウンロード(他のマスタと同じく、そのままCSVインポートに使える形)
  async exportCsv() {
    const rows = await this.repo.getAllTaxCategories();
    const toDate = (d: Date | null) => (d ? new Date(d).toISOString().split("T")[0] : "");
    const lines = rows.map((r) =>
      [
        csvField(r.code),
        csvField(r.name),
        csvField(r.taxType),
        csvField(r.taxRate),
        csvField(toDate(r.validFrom)),
        csvField(toDate(r.validTo)),
      ].join(","),
    );
    return withBom(buildCsvContent([...TAX_CATEGORY_CSV_HEADERS], lines));
  }

  // BUG-039: CSVインポート。全ての行を確かめてから登録・更新する(1行でも不正なら何も登録しない)
  async importCsv(c: Context<{ Bindings: Env }>, csvText: string) {
    const lines = parseCsv(csvText);
    if (lines.length <= 1) throw new BadRequestError("CSVにデータ行がありません");

    const headers = lines[0].map((h) => h.trim());
    const idx = Object.fromEntries(TAX_CATEGORY_CSV_HEADERS.map((h) => [h, headers.indexOf(h)]));
    const missing = TAX_CATEGORY_CSV_HEADERS.filter((h) => h !== "validFrom" && h !== "validTo" && idx[h] === -1);
    if (missing.length > 0) {
      throw new BadRequestError(`CSVのヘッダーに ${missing.join("・")} がありません`);
    }

    const inputs: SaveTaxCategoryInput[] = [];
    const errors: string[] = [];
    lines.slice(1).forEach((cols, i) => {
      const cell = (key: string) => (idx[key] === -1 ? "" : (cols[idx[key]] ?? "").trim());
      const rate = Number(cell("taxRate"));
      if (cell("taxRate") === "" || Number.isNaN(rate)) {
        errors.push(`${i + 2}行目: taxRate(税率)は数値で入力してください(例: 0.1)`);
        return;
      }
      if (!["EXEMPT", "STANDARD", "VARIABLE"].includes(cell("taxType"))) {
        errors.push(`${i + 2}行目: taxType(種別)は EXEMPT・STANDARD・VARIABLE のいずれかにしてください`);
        return;
      }
      const parsed = v.safeParse(saveTaxCategorySchema, {
        code: cell("code"),
        name: cell("name"),
        taxType: cell("taxType"),
        taxRate: rate,
        validFrom: cell("validFrom") || null,
        validTo: cell("validTo") || null,
      });
      if (!parsed.success) {
        errors.push(`${i + 2}行目: ${parsed.issues[0]?.message ?? "入力内容に不備があります"}`);
      } else {
        inputs.push(parsed.output);
      }
    });
    if (errors.length > 0) throw new BadRequestError(errors.join("\n"));

    for (const input of inputs) await this.repo.upsertTaxCategory(input);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "IMPORT_TAX_CATEGORIES_CSV", RESOURCE_KEY, "CSV", null, { count: inputs.length }),
    );
    return inputs.length;
  }

  async deleteTaxCategory(c: Context<{ Bindings: Env }>, code: string) {
    const existing = await this.repo.findByCode(code);
    if (!existing) {
      throw new NotFoundError("対象の消費税区分が見つかりません");
    }

    const usageCount = await this.repo.countItemsUsingTaxCategory(code);
    if (usageCount > 0) {
      throw new BadRequestError(
        `この消費税区分は品目マスタで${usageCount}件使用されているため削除できません`,
      );
    }

    await this.repo.deleteTaxCategory(code);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "DELETE_TAX_CATEGORY", RESOURCE_KEY, code, null, null),
    );
  }
}
