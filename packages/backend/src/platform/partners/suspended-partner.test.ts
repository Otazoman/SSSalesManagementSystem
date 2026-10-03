import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { BadRequestError } from "../http/http-error";
import { assertPartnerNotSuspended } from "./suspended-partner";
import { QuoteCrudService } from "../../routes/sales/quotes/quote-crud.service";
import { QuoteRepository } from "../../routes/sales/quotes/quote.repository";
import { SalesOrderCrudService } from "../../routes/sales/orders/sales-order-crud.service";
import { SalesOrderRepository } from "../../routes/sales/orders/sales-order.repository";
import { SalesInvoiceCrudService } from "../../routes/sales/invoices/sales-invoice-crud.service";
import { SalesInvoiceRepository } from "../../routes/sales/invoices/sales-invoice.repository";
import { BillingCrudService } from "../../routes/sales/billing/billing-crud.service";
import { BillingRepository } from "../../routes/sales/billing/billing.repository";
import { CashReceiptsService } from "../../routes/sales/cash-receipts/cash-receipts.service";
import { CashReceiptsRepository } from "../../routes/sales/cash-receipts/cash-receipts.repository";
import { PurchaseRequisitionCrudService } from "../../routes/purchase/requisitions/purchase-requisition-crud.service";
import { PurchaseRequisitionRepository } from "../../routes/purchase/requisitions/purchase-requisition.repository";
import { PurchaseOrderCrudService } from "../../routes/purchase/orders/purchase-order-crud.service";
import { PurchaseOrderRepository } from "../../routes/purchase/orders/purchase-order.repository";
import { PurchaseRecognitionCrudService } from "../../routes/purchase/recognitions/purchase-recognition-crud.service";
import { PurchaseRecognitionRepository } from "../../routes/purchase/recognitions/purchase-recognition.repository";
import { PaymentCrudService } from "../../routes/purchase/payment/payment-crud.service";
import { PaymentRepository } from "../../routes/purchase/payment/payment.repository";

const db = drizzle(env.DB, { schema });
const now = new Date("2026-10-01T00:00:00Z");
const audit = { createdBy: "EMP001", createdAt: now, updatedBy: "EMP001", updatedAt: now };

beforeEach(async () => {
  await db.delete(schema.partners);
  await db.insert(schema.partners).values([
    { id: "P-ACTIVE", name: "取引中", type: "CUSTOMER", status: "active", ...audit },
    { id: "P-STOP", name: "停止先", type: "BOTH", status: "suspended", ...audit },
  ]);
});

describe("BUG-066: 取引停止の取引先", () => {
  it("取引停止の取引先は400(BadRequestError)", async () => {
    await expect(assertPartnerNotSuspended(env.DB, "P-STOP")).rejects.toThrow(BadRequestError);
    await expect(assertPartnerNotSuspended(env.DB, "P-STOP")).rejects.toThrow("取引停止中");
  });

  it("取引中・未指定・存在しない取引先は、ここでは止めない(既存の検証に任せる)", async () => {
    await expect(assertPartnerNotSuspended(env.DB, "P-ACTIVE")).resolves.toBeUndefined();
    await expect(assertPartnerNotSuspended(env.DB, null)).resolves.toBeUndefined();
    await expect(assertPartnerNotSuspended(env.DB, "P-NONE")).resolves.toBeUndefined();
  });

  // 各伝票の新規登録は、他の処理より前に取引停止を確認する(DBへ何も書かない)
  const c = { env } as any;
  const fd = new FormData();
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["見積", () => new QuoteCrudService(new QuoteRepository(env.DB)).createQuote(c, fd, { customerId: "P-STOP" } as any)],
    ["受注", () => new SalesOrderCrudService(new SalesOrderRepository(env.DB)).createOrder(c, fd, { partnerId: "P-STOP" } as any)],
    ["売上", () => new SalesInvoiceCrudService(new SalesInvoiceRepository(env.DB)).createInvoice(c, fd, { partnerId: "P-STOP" } as any)],
    ["請求", () => new BillingCrudService(new BillingRepository(env.DB)).createBilling(c, { partnerId: "P-STOP" } as any)],
    ["単体入金", () => new CashReceiptsService(new CashReceiptsRepository(env.DB)).register(c, { partnerId: "P-STOP" } as any)],
    ["購買申請", () => new PurchaseRequisitionCrudService(new PurchaseRequisitionRepository(env.DB)).createRequisition(c, fd, { partnerId: "P-STOP" } as any)],
    ["発注", () => new PurchaseOrderCrudService(new PurchaseOrderRepository(env.DB)).createOrder(c, fd, { partnerId: "P-STOP" } as any)],
    ["仕入", () => new PurchaseRecognitionCrudService(new PurchaseRecognitionRepository(env.DB)).createRecognition(c, fd, { supplierId: "P-STOP" } as any)],
    ["支払", () => new PaymentCrudService(new PaymentRepository(env.DB)).createPayment(c, { partnerId: "P-STOP" } as any)],
  ];
  for (const [label, create] of cases) {
    it(`${label}の新規登録は、取引停止の取引先を指定すると拒否する`, async () => {
      await expect(create()).rejects.toThrow("取引停止中");
    });
  }
});
