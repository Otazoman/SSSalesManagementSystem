import { Hono } from "hono";
import { vValidator } from "@hono/valibot-validator";
import { Env } from "../../../types/env";
import { CompanySettingsService } from "./company-settings.service";
import { respondError, validationHook } from "../../../platform/http/error-handler";
import {
  UpdateCompanySettingsSchema,
  SendTestEmailSchema,
} from "./company-settings.schema";
import { describeApiRoute, describeMutationRoute } from "../../../platform/openapi/describe-route";

export const companySettingsRouter = new Hono<{ Bindings: Env }>();

// DIヘルパー関数
function getService(c: any) {
  return new CompanySettingsService(c.env);
}

// 1. システム設定情報の取得 (GET)
companySettingsRouter.get(
  "/",
  describeApiRoute({
    summary: "会社設定情報取得",
    tags: ["company-settings"],
    responses: {
      200: {
        description:
          "会社設定情報(KVから取得、無ければデフォルト値)。SMTPのパスワード・SlackのBotトークンは空文字で返し、設定済みかどうかを smtp_pass_configured・slack_bot_token_configured で返す",
      },
    },
  }),
  async (c) => {
  try {
    const service = getService(c);
    const settings = await service.getSettingsForClient();
    return c.json(settings);
  } catch (err) {
    return respondError(c, err, "Cloudflare KVからの設定同期に失敗しました");
  }
});

// 2. システム設定情報の保存・更新 (PUT)
companySettingsRouter.put(
  "/",
  describeMutationRoute({
    summary: "会社設定情報保存・更新",
    tags: ["company-settings"],
    json: UpdateCompanySettingsSchema,
    successDescription: "更新成功",
  }),
  vValidator("json", UpdateCompanySettingsSchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.updateSettings(c, body);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "Cloudflare KVへの永続化に失敗しました");
    }
  },
);

// 3. テストメール送信機能のエンドポイント (POST)
companySettingsRouter.post(
  "/test-email",
  describeMutationRoute({
    summary: "会社設定テストメール送信",
    tags: ["company-settings"],
    json: SendTestEmailSchema,
    successDescription: "送信成功",
  }),
  vValidator("json", SendTestEmailSchema, validationHook()),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const service = getService(c);
      const result = await service.sendTestEmail(c, body);
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "テストメールの送信に失敗しました");
    }
  },
);
