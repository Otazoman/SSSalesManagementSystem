import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { ProductsService } from "./products.service";
import {
  searchProductsQuerySchema,
  registerProductSchema,
  updateProductSchema,
} from "./products.schema";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import { parsePaginationParams } from "../../../platform/http/pagination";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import {
  describeApiRoute,
  describeListRoute,
  describeMutationRoute,
  describeCsvDownloadRoute,
} from "../../../platform/openapi/describe-route";

const productsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new ProductsService(c.env.DB);
}

// 1. 高度な検索 & 単価マスタ結合
// page/limit未指定時は従来通り配列を返す(後方互換)。指定時のみ{data,pagination}形式で返す。
productsRouter.get(
  "/",
  describeListRoute({
    summary: "品目マスタ高度検索(単価マスタ結合)",
    tags: ["products"],
    query: searchProductsQuerySchema,
    itemDescription: "品目マスタ(標準売単価・仕入単価・添付ファイル込み)",
  }),
  vValidator("query", searchProductsQuerySchema, validationHook()),
  async (c) => {
    try {
      const query = c.req.valid("query");
      const service = getService(c);
      const rawQuery = c.req.query();
      const sort = { sortBy: query.sortBy, sortOrder: query.sortOrder };
      if (rawQuery.page === undefined && rawQuery.limit === undefined) {
        const result = await service.searchProducts(query, sort);
        return c.json(result);
      }
      const params = parsePaginationParams(rawQuery);
      const result = await service.searchProductsPage(query, params, sort);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "検索内部エラー");
    }
  },
);

// 2. 新規登録 (POST /register)
productsRouter.post(
  "/register",
  describeApiRoute({
    summary: "品目マスタ新規登録",
    tags: ["products"],
    json: registerProductSchema,
    responses: {
      200: { description: "登録成功(品目IDを含む)" },
      400: { description: "登録エラー" },
    },
  }),
  vValidator("json", registerProductSchema, validationHook()),
  async (c) => {
    try {
      const input = c.req.valid("json");
      const service = getService(c);
      const result = await service.registerProduct(c, input);

      return c.json({
        success: true,
        message: `品目「${result.name}」を登録しました`,
        id: result.id,
      });
    } catch (err) {
      return respondError(c, err, "登録内部エラーが発生しました。");
    }
  },
);

// 3. 更新処理 (PUT /:id)
productsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "品目マスタ更新",
    tags: ["products"],
    json: updateProductSchema,
    successDescription: "更新成功",
  }),
  vValidator("json", updateProductSchema, validationHook()),
  async (c) => {
    const id = c.req.param("id");
    try {
      const input = c.req.valid("json");
      const service = getService(c);
      await service.updateProduct(c, id, input);

      return c.json({ success: true, message: "品目データを更新しました" });
    } catch (err) {
      return respondError(c, err, "更新エラー");
    }
  },
);

// 4. 一時停止処理 (POST /:id/suspend)
productsRouter.post(
  "/:id/suspend",
  describeMutationRoute({
    summary: "品目マスタ一時停止",
    tags: ["products"],
    successDescription: "一時停止成功",
  }),
  async (c) => {
  const id = c.req.param("id");
  try {
    const service = getService(c);
    await service.suspendProduct(c, id);
    return c.json({ success: true, message: "該当品目を一時停止しました" });
  } catch (err) {
    return respondError(c, err, "ステータス変更内部エラー");
  }
});

// 5. 完全削除 (DELETE /:id)
productsRouter.delete(
  "/:id",
  describeApiRoute({
    summary: "品目マスタ完全削除",
    tags: ["products"],
    responses: {
      200: { description: "削除成功(R2添付ファイルも自動消去)" },
      400: { description: "削除失敗" },
    },
  }),
  async (c) => {
  const id = c.req.param("id");
  try {
    const service = getService(c);
    await service.deleteProduct(c, id);
    return c.json({
      success: true,
      message: "品目を完全に削除しました(R2ファイルも自動消去)",
    });
  } catch (err) {
    return respondError(c, err, "削除に失敗しました");
  }
});

// CSVインポート (POST /bulk-register)
productsRouter.post(
  "/bulk-register",
  describeMutationRoute({
    summary: "品目マスタCSVインポート",
    tags: ["products"],
    successDescription: "同期成功",
  }),
  async (c) => {
  try {
    const service = getService(c);
    const count = await service.importCsv(c);
    return c.json({
      success: true,
      message: `CSVから ${count} 件の品目データを同期(更新)しました`,
    });
  } catch (err) {
    return respondError(c, err,
      "CSVインポート処理で予期せぬ内部エラーが発生しました。");
  }
});

// CSVダウンロード (GET /csv-download)
productsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "品目マスタCSVダウンロード", tags: ["products"] }),
  vValidator("query", searchProductsQuerySchema, validationHook()),
  async (c) => {
  try {
    const query = c.req.valid("query");
    const service = getService(c);
    const bomCsvContent = await service.exportCsv(query);
    const fileName = `products_export_${Date.now()}.csv`;

    return new Response(bomCsvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Access-Control-Expose-Headers": "Content-Disposition",
      },
    });
  } catch (err) {
    return respondError(c, err, "CSVダウンロード内部エラー");
  }
});

// 画像・ファイルアップロード専用API (POST /upload)
productsRouter.post(
  "/upload",
  describeApiRoute({
    summary: "品目マスタ画像・ファイルアップロード",
    tags: ["products"],
    responses: {
      200: { description: "アップロード成功(R2キーを含む)" },
      400: { description: "ファイルが見つからない" },
    },
  }),
  async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return c.json(
        { success: false, message: "ファイルが見つかりません" },
        400,
      );
    }

    const r2Key = generateAttachmentKey("products", file.name);

    await c.env.PRODUCTS_BUCKET.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    return c.json({
      success: true,
      fileName: file.name,
      attachmentR2Path: r2Key,
    });
  } catch (err) {
    return respondError(c, err, "R2へのアップロードに失敗しました");
  }
});

// 画像・ファイル配信API (GET /images/:itemId/:attachmentId、DB経由で解決)
productsRouter.get(
  "/images/:itemId/:attachmentId",
  describeApiRoute({
    summary: "品目マスタ画像・ファイル配信",
    tags: ["products"],
    responses: {
      200: { description: "ファイル本体、または外部リンクへのリダイレクト" },
      404: { description: "ファイルが見つからない" },
    },
  }),
  async (c) => {
  try {
    const itemId = c.req.param("itemId");
    const attachmentId = c.req.param("attachmentId");
    const service = getService(c);
    const res = await service.getFile(itemId, attachmentId, c.env.PRODUCTS_BUCKET);

    if (!res) {
      return c.text("ファイルが見つかりません", 404);
    }

    if (res.type === "redirect") {
      return c.redirect(res.url);
    }

    return new Response(res.body, { headers: res.headers });
  } catch (err) {
    return respondError(c, err, "ファイル配信エラー");
  }
});

export { productsRouter };
