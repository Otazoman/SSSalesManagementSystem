import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { respondError } from "../platform/http/error-handler";
import { QuoteMailService } from "./sales/quotes/quote-mail.service";
import { SalesOrderMailService } from "./sales/orders/sales-order-mail.service";
import { PurchaseOrderMailService } from "./purchase/orders/purchase-order-mail.service";
import { SalesInvoiceMailService } from "./sales/invoices/sales-invoice-mail.service";

// BUG-029: 1件のメール送信でも、帳票の PDF が無ければその場で作ってから送る(一括送信・検収書・請求書と同じ動き)。
// PDF の作成そのもの(テンプレート・フォント)は各 pdf.service のテストで確かめるため、ここでは作成の呼び出しだけを偽物にする。

type AnyService = { singleSendEmail: (c: any, id: string, payload: { recipientEmail: string }) => Promise<unknown> };

const doc = { id: "DOC-1", companyName: "テスト商事", partnerName: "テスト商事", totalAmount: 1000, updatedBy: "EMP001" };

function makeFakes(findApprovedMethod: string, { pdfCreatable }: { pdfCreatable: boolean }) {
  const state = { pdfCreated: false, generateCalls: 0 };
  const repo: Record<string, unknown> = {
    findMailTemplate: async () => ({ subjectTemplate: "件名 {doc_id}", bodyTemplate: "本文 {doc_id}", ccAddress: null, smtpFrom: null }),
    [findApprovedMethod]: async () => [doc],
    findLatestPdfAttachment: async () => (state.pdfCreated ? { id: "ATT-1", attachmentR2Path: "docs/DOC-1.pdf" } : null),
  };
  const pdfService = {
    generatePdf: async () => {
      state.generateCalls++;
      if (!pdfCreatable) throw new Error("テンプレートがありません");
      state.pdfCreated = true;
    },
  };
  return { repo, pdfService, state };
}

async function send(service: AnyService) {
  const app = new Hono<{ Bindings: typeof env }>();
  app.post("/send", async (c) => {
    try {
      return c.json(await service.singleSendEmail(c, "DOC-1", { recipientEmail: "to@example.com" }));
    } catch (err) {
      // 各ルーターと同じく、業務エラー(HttpError)は理由をそのまま返す
      return respondError(c, err);
    }
  });
  const ctx = createExecutionContext();
  const res = await app.request("/send", { method: "POST" }, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: (await res.json()) as { success?: boolean; message?: string } };
}

const cases = [
  { label: "見積書", Service: QuoteMailService, findApproved: "findApprovedQuotesByIds" },
  { label: "注文請書", Service: SalesOrderMailService, findApproved: "findApprovedOrdersByIds" },
  { label: "発注書", Service: PurchaseOrderMailService, findApproved: "findApprovedOrdersByIds" },
  { label: "売上関連書類", Service: SalesInvoiceMailService, findApproved: "findApprovedInvoicesByIds" },
] as const;

beforeEach(async () => {
  await env.COMPANY_SETTINGS.put("config", JSON.stringify({ site_url: "https://example.com" }));
});

describe("1件のメール送信での PDF の自動作成(BUG-029)", () => {
  for (const { label, Service, findApproved } of cases) {
    it(`${label}: PDF が無ければ作ってから送信を予約する`, async () => {
      const { repo, pdfService, state } = makeFakes(findApproved, { pdfCreatable: true });
      const service = new (Service as any)(repo, pdfService) as AnyService;
      const res = await send(service);
      expect(state.generateCalls).toBe(1);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it(`${label}: PDF が既にあれば作らずに送る`, async () => {
      const { repo, pdfService, state } = makeFakes(findApproved, { pdfCreatable: true });
      state.pdfCreated = true;
      const service = new (Service as any)(repo, pdfService) as AnyService;
      const res = await send(service);
      expect(state.generateCalls).toBe(0);
      expect(res.status).toBe(200);
    });

    it(`${label}: PDF を作れなかった場合は、作成に失敗したことを伝える`, async () => {
      const { repo, pdfService } = makeFakes(findApproved, { pdfCreatable: false });
      const service = new (Service as any)(repo, pdfService) as AnyService;
      const res = await send(service);
      // 業務エラー(400)として理由を返す(500 だと共通のエラー処理で「問い合わせ番号」だけになり、理由が画面に出ない)
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(`${label}PDFの作成に失敗しました。帳票テンプレートの設定をご確認ください。`);
    });
  }
});

// BUG-040: 設定の不足は、利用者が直せる理由として 400 で画面に出す(以前は通常の Error で、問い合わせ番号だけの 500 だった)
describe("1件のメール送信での設定の不足(BUG-040)", () => {
  for (const { label, Service, findApproved } of cases) {
    it(`${label}: 会社設定が無い場合は、理由を 400 で返す`, async () => {
      await env.COMPANY_SETTINGS.delete("config");
      const { repo, pdfService } = makeFakes(findApproved, { pdfCreatable: true });
      const res = await send(new (Service as any)(repo, pdfService) as AnyService);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("会社設定が登録されていません。管理画面の「会社設定」を保存してください。");
    });

    it(`${label}: メールのテンプレートが無い場合は、理由を 400 で返す`, async () => {
      const { repo, pdfService } = makeFakes(findApproved, { pdfCreatable: true });
      repo.findMailTemplate = async () => null;
      const res = await send(new (Service as any)(repo, pdfService) as AnyService);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/^メール送信設定に「.+」のテンプレートが登録されていません$/);
    });
  }
});
