import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { ItemReorderSettingsService } from "./item-reorder-settings.service";
import { ItemReorderSettingPayloadSchema } from "./item-reorder-settings.schema";
import { validationHook, respondError } from "../../../platform/http/error-handler";
import {
  describeListRoute,
  describeMutationRoute,
  describeDeleteRoute,
  describeApiRoute,
  describeCsvDownloadRoute,
} from "../../../platform/openapi/describe-route";
import { todayJst } from "../../../platform/date/format-jst-date";

const itemReorderSettingsRouter = new Hono<{ Bindings: Env }>();

itemReorderSettingsRouter.onError((err, c) => respondError(c, err));

function getService(c: any): ItemReorderSettingsService {
  return new ItemReorderSettingsService(c.env.DB);
}

// ==========================================
// 一覧取得
// ==========================================
itemReorderSettingsRouter.get(
  "/",
  describeListRoute({
    summary: "発注点/安全在庫マスタ一覧取得",
    tags: ["item-reorder-settings"],
    itemDescription: "発注点/安全在庫マスタ(品目×倉庫)",
  }),
  async (c) => {
    const query = c.req.query();
    const result = await getService(c).getAll({ sortBy: query.sortBy, sortOrder: query.sortOrder });
    return c.json(result);
  },
);

// ==========================================
// CSVエクスポート
// ==========================================
itemReorderSettingsRouter.get(
  "/csv-download",
  describeCsvDownloadRoute({ summary: "発注点/安全在庫マスタCSVダウンロード", tags: ["item-reorder-settings"] }),
  async (c) => {
    const csvContent = await getService(c).exportCsv();
    return c.body(csvContent, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="item_reorder_settings_export_${todayJst()}.csv"`,
    });
  },
);

// ==========================================
// CSVインポート
// ==========================================
itemReorderSettingsRouter.post(
  "/bulk-register",
  describeApiRoute({
    summary: "発注点/安全在庫マスタCSVインポート",
    tags: ["item-reorder-settings"],
    responses: {
      200: { description: "インポート成功" },
      400: { description: "CSVファイル未添付" },
    },
  }),
  async (c) => {
    const count = await getService(c).importCsv(c);
    return c.json({ success: true, message: `${count}件のデータをインポートしました` });
  },
);

// ==========================================
// 欠品自動提案②(発注点/安全在庫方式): 低在庫候補一覧
// ==========================================
itemReorderSettingsRouter.get(
  "/low-stock-candidates",
  describeApiRoute({
    summary: "発注点を下回った品目×倉庫の候補一覧(欠品自動提案②)",
    tags: ["item-reorder-settings"],
    responses: {
      200: { description: "候補一覧" },
    },
  }),
  async (c) => {
    const result = await getService(c).getLowStockCandidates();
    return c.json(result);
  },
);

// ==========================================
// 新規登録
// ==========================================
itemReorderSettingsRouter.post(
  "/register",
  describeMutationRoute({
    summary: "発注点/安全在庫マスタ新規登録",
    tags: ["item-reorder-settings"],
    json: ItemReorderSettingPayloadSchema,
    successDescription: "登録成功",
  }),
  vValidator("json", ItemReorderSettingPayloadSchema, validationHook()),
  async (c) => {
    const input = c.req.valid("json");
    const result = await getService(c).create(c, input);
    return c.json({ success: true, message: "発注点/安全在庫設定を登録しました", id: result.id });
  },
);

// ==========================================
// 更新
// ==========================================
itemReorderSettingsRouter.put(
  "/:id",
  describeMutationRoute({
    summary: "発注点/安全在庫マスタ更新",
    tags: ["item-reorder-settings"],
    json: ItemReorderSettingPayloadSchema,
    successDescription: "更新成功",
  }),
  vValidator("json", ItemReorderSettingPayloadSchema, validationHook()),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    await getService(c).update(c, id, input);
    return c.json({ success: true, message: "発注点/安全在庫設定を更新しました" });
  },
);

// ==========================================
// 削除
// ==========================================
itemReorderSettingsRouter.delete(
  "/:id",
  describeDeleteRoute({
    summary: "発注点/安全在庫マスタ削除",
    tags: ["item-reorder-settings"],
    successDescription: "削除成功",
  }),
  async (c) => {
    const id = c.req.param("id");
    await getService(c).delete(c, id);
    return c.json({ success: true, message: "発注点/安全在庫設定を削除しました" });
  },
);

export { itemReorderSettingsRouter };
