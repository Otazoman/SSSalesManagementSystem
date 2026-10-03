import { Context } from "hono";
import { ProductsRepository } from "./products.repository";
import {
  RegisterProductInput,
  UpdateProductInput,
  SearchProductsQuery,
} from "./products.schema";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";
import { Env } from "../../../types/env";
import {
  withBom,
  buildCsvContent,
  CRLF,
  csvField,
} from "../../../platform/csv/csv-writer";
import { parseCsv } from "../../../platform/csv/csv-parser";
import {
  BadRequestError,
  NotFoundError,
  isForeignKeyConstraintError,
  isHttpError,
} from "../../../platform/http/http-error";
import { PaginationParams, buildPaginationMeta } from "../../../platform/http/pagination";
import { buildListResponse } from "../../../platform/http/response";
import { determineProductInitialStatus } from "../../../workflow-engine/settings";
import { generateUniqueMasterCode } from "../../../platform/id/resolve-master-id";
import { SortQuery } from "../../../platform/http/sort";

const RESOURCE_KEY = "master_products";

export class ProductsService {
  private repo: ProductsRepository;

  constructor(d1: D1Database) {
    this.repo = new ProductsRepository(d1);
  }

  async searchProducts(query: SearchProductsQuery, sort?: SortQuery) {
    return await this.repo.searchProducts(query, sort);
  }

  async searchProductsPage(
    query: SearchProductsQuery,
    params: PaginationParams,
    sort?: SortQuery,
  ) {
    const [data, total] = await Promise.all([
      this.repo.searchProductsPage(query, params, sort),
      this.repo.countProducts(query),
    ]);
    return buildListResponse(data, buildPaginationMeta(params, total));
  }

  async registerProduct(
    c: Context<{ Bindings: Env }>,
    input: RegisterProductInput,
  ) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();
    // マスタコード自動採番: コード未入力時のみmaster_code_formatsの設定に基づき自動採番する
    const newItemId =
      input.id?.trim() ||
      (await generateUniqueMasterCode(c, "products", (id) =>
        this.repo.findProductById(id).then((r) => !!r),
      ));

    const existing = await this.repo.findProductById(newItemId);
    if (existing) {
      throw new BadRequestError(
        `品目コード「${newItemId}」は既に登録されています`,
      );
    }

    // 💡 承認機能展開: 以前は新規登録時のstatusを常に"temporary"固定していたが、
    // 他マスタと同じく会社設定のワークフロー有効フラグに従って決定するよう変更
    // (フロント側が承認申請時に明示的にstatus="temporary"を送ってくる場合はそちらを優先する)
    const status =
      input.status || (await determineProductInitialStatus(c.env.COMPANY_SETTINGS));
    await this.repo.createProduct({ ...input, id: newItemId }, opId, now, status);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "CREATE_PRODUCT", RESOURCE_KEY, newItemId, null, {
      name: input.name.trim(),
    }),
    );

    return { id: newItemId, name: input.name };
  }

  async updateProduct(
    c: Context<{ Bindings: Env }>,
    id: string,
    input: UpdateProductInput,
  ) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();

    const existing = await this.repo.findProductById(id);
    if (!existing) {
      throw new NotFoundError("対象レコードが見つかりません");
    }

    await this.repo.updateProduct(id, input, opId, now, c.env.PRODUCTS_BUCKET);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "UPDATE_PRODUCT", RESOURCE_KEY, id, null, {
      name: input.name.trim(),
    }),
    );
  }

  async suspendProduct(c: Context<{ Bindings: Env }>, id: string) {
    const opId = await this.repo.getFallbackOperatorId(c);
    await this.repo.suspendProduct(id, opId);

    c.executionCtx.waitUntil(
      logAuditEvent(c, "SUSPEND_PRODUCT", RESOURCE_KEY, id, null, null),
    );
  }

  async deleteProduct(c: Context<{ Bindings: Env }>, id: string) {
    const existing = await this.repo.findProductById(id);
    if (!existing) {
      throw new NotFoundError("対象の品目が見つかりません");
    }
    if (existing.status !== "suspended") {
      throw new BadRequestError(
        "削除拒否: 無効化状態の品目のみ物理削除できます",
      );
    }
    await this.repo.deleteProduct(id, c.env.PRODUCTS_BUCKET);
  }

  // ➕ ファイル配信処理(DB経由: itemId + attachmentId から添付ファイルレコードを引いてR2から配信)
  async getFile(itemId: string, attachmentId: string, bucket: R2Bucket) {
    const attachment = await this.repo.findAttachmentByIdAndItemId(
      attachmentId,
      itemId,
    );
    if (!attachment) return null;

    if (attachment.storageType !== "R2" || !attachment.attachmentR2Path) {
      if (attachment.externalUrl) {
        return { type: "redirect" as const, url: attachment.externalUrl };
      }
      return null;
    }

    const object = await bucket.get(attachment.attachmentR2Path);
    if (!object) return null;

    const headers: Record<string, string> = {};
    const contentType =
      object.httpMetadata?.contentType || "application/octet-stream";
    headers["content-type"] = contentType;
    if (object.httpEtag) headers["etag"] = object.httpEtag;

    const isImage =
      contentType.startsWith("image/") ||
      attachment.fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    headers["content-disposition"] = isImage
      ? "inline"
      : `attachment; filename="${encodeURIComponent(attachment.fileName)}"`;

    return { type: "stream" as const, body: object.body, headers };
  }

  async exportCsv(query: SearchProductsQuery) {
    const items = await this.repo.getAllProductsForExport(query);
    const header = [
      "id",
      "name",
      "isPurchased",
      "isSales",
      "isService",
      "baseUnitCode",
      "taxCategoryCode", // ▼ 追加
      "productBarcode",
      "accountCode",
      "supplierId",
      "supplierPartNumber",
      "memo",
      "standardSalesPrice",
      "standardPurchasePrice",
    ];

    const csvRows = items.map((item) => {
      return [
        csvField(item.id || ""),
        csvField(item.name || ""),
        item.isPurchased ? "true" : "false",
        item.isSales ? "true" : "false",
        item.isService ? "true" : "false",
        csvField(item.baseUnitCode || "pcs"),
        csvField(item.taxCategoryCode || "TAX_10"), // ▼ 追加
        csvField(item.productBarcode || ""),
        csvField(item.accountCode || ""),
        csvField(item.supplierId || ""),
        csvField(item.supplierPartNumber || ""),
        csvField(item.memo || ""),
        item.standardSalesPrice,
        item.standardPurchasePrice,
      ].join(",");
    });

    return withBom(buildCsvContent(header, csvRows, CRLF));
  }

  async importCsv(c: Context<{ Bindings: Env }>) {
    const opId = await this.repo.getFallbackOperatorId(c);
    const now = new Date();
    let csvData = "";

    const contentType = c.req.header("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const file = formData.get("file");
      if (file && file instanceof File) csvData = await file.text();
    } else if (contentType.includes("application/json")) {
      const body = await c.req.json();
      csvData = body.csvData || "";
    } else {
      csvData = await c.req.text();
    }

    if (!csvData || typeof csvData !== "string" || csvData.trim() === "") {
      throw new BadRequestError("CSVデータが空か不正です");
    }

    const allRows = parseCsv(csvData);
    if (allRows.length <= 1) {
      throw new BadRequestError("CSVにデータ行が含まれていません");
    }

    const header = allRows[0].map((h) => h.trim());
    const idxId = header.indexOf("id");
    const idxName = header.indexOf("name");
    const idxPurchased = header.indexOf("isPurchased");
    const idxSales = header.indexOf("isSales");
    const idxService = header.indexOf("isService");
    const idxUnit = header.indexOf("baseUnitCode");
    const idxTax = header.indexOf("taxCategoryCode"); // ▼ 追加
    const idxBarcode = header.indexOf("productBarcode");
    const idxAccount = header.indexOf("accountCode");
    const idxSupplier = header.indexOf("supplierId");
    const idxSupplierPart = header.indexOf("supplierPartNumber");
    const idxMemo = header.indexOf("memo");
    const idxSalesPrice = header.indexOf("standardSalesPrice");
    const idxPurchasePrice = header.indexOf("standardPurchasePrice");

    if (idxId === -1 || idxName === -1) {
      throw new BadRequestError("CSVに必要な列(id, name)がありません");
    }

    let count = 0;
    let currentProcessingId = "UNKNOWN";

    try {
      for (const cols of allRows.slice(1)) {
        const rawId = cols[idxId];
        const rawName = cols[idxName];

        if (!rawId || !rawName) continue;
        currentProcessingId = rawId;

        const row = {
          id: rawId,
          name: rawName,
          isPurchased:
            idxPurchased !== -1
              ? cols[idxPurchased]?.toLowerCase() === "true" ||
                cols[idxPurchased] === "1"
              : true,
          isSales:
            idxSales !== -1
              ? cols[idxSales]?.toLowerCase() === "true" ||
                cols[idxSales] === "1"
              : true,
          isService:
            idxService !== -1
              ? cols[idxService]?.toLowerCase() === "true" ||
                cols[idxService] === "1"
              : false,
          baseUnitCode: idxUnit !== -1 && cols[idxUnit] ? cols[idxUnit] : "pcs",
          taxCategoryCode:
            idxTax !== -1 && cols[idxTax] ? cols[idxTax] : "TAX_10", // ▼ 追加
          productBarcode:
            idxBarcode !== -1 && cols[idxBarcode] ? cols[idxBarcode] : null,
          accountCode:
            idxAccount !== -1 &&
            cols[idxAccount] &&
            cols[idxAccount] !== "" &&
            cols[idxAccount] !== "null"
              ? cols[idxAccount]
              : null,
          supplierId:
            idxSupplier !== -1 && cols[idxSupplier] ? cols[idxSupplier] : null,
          supplierPartNumber:
            idxSupplierPart !== -1 && cols[idxSupplierPart]
              ? cols[idxSupplierPart]
              : null,
          memo: idxMemo !== -1 && cols[idxMemo] ? cols[idxMemo] : null,
          salesPriceVal:
            idxSalesPrice !== -1 && cols[idxSalesPrice]
              ? Number(cols[idxSalesPrice]) || 0
              : 0,
          purchasePriceVal:
            idxPurchasePrice !== -1 && cols[idxPurchasePrice]
              ? Number(cols[idxPurchasePrice]) || 0
              : 0,
        };

        await this.repo.importProductRow(row, opId, now);
        count++;
      }
    } catch (err) {
      // 仕入先コードが無いなど、理由が分かっている業務エラーはそのまま画面に伝える
      if (isHttpError(err)) throw err;
      console.error("D1 SQLite Database Error Details:", err);
      const errStr = String(err).toLowerCase();
      let friendlyMessage = `インポート失敗(対象コード: ${currentProcessingId}): データの形式が正しくないか、パースに失敗しました。`;
      if (isForeignKeyConstraintError(err) || errStr.includes("no such table")) {
        friendlyMessage = `【マスタ同期エラー】品目コード [${currentProcessingId}] の登録でエラーが発生しました。DBスキーマの同期を確認するか、CSVで指定されている「基本単位(baseUnitCode)」「消費税区分(taxCategoryCode)」「勘定科目(accountCode)」または「仕入先コード(supplierId)」が登録されているか確認してください。`;
      }
      throw new BadRequestError(friendlyMessage);
    }

    c.executionCtx.waitUntil(
      logAuditEvent(c, "BULK_IMPORT_PRODUCTS_CSV", RESOURCE_KEY, "BULK_OPERATION", null, {
      processedCount: count,
    }),
    );

    return count;
  }
}
