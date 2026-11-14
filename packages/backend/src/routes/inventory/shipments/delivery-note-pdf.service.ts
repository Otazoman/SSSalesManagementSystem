import { Context } from "hono";
import { Env } from "../../../types/env";
import { ShipmentsRepository } from "./shipments.repository";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { PartnersRepository } from "../../master/partners/partners.repository";
import { ProductsRepository } from "../../master/products/products.repository";
import { SalesOrderRepository } from "../../sales/orders/sales-order.repository";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { type ReportPdfSource, type InstructionPdfData, type PDFInvoiceData } from "report-renderer";
import { loadCustomLayoutSource } from "../../../platform/report-templates/load-custom-layout";
import { resolveInstructionPlaceholders } from "../../../platform/report-templates/resolve-instruction-placeholders";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { todayJst } from "../../../platform/date/format-jst-date";
import { logAuditEvent } from "../../../platform/audit/log-audit-event";

const REPORT_TEMPLATE_CATEGORY = "sales_invoice";

// Item6 Phase6-4: 納品書PDF。PERF-07 B-6 で、出庫の確定の時にサーバーで自動で作るのをやめた(無料プランの CPU 時間の上限を超えるため)。
// 出荷の画面の「納品書PDFを作成」で、ブラウザが pdf-source のデータから作り、POST /:id/pdf で保存する。
// R2保存先は専用のDELIVERY_NOTES_BUCKET。以前の SYSTEM_BUCKET に保存したファイルは、読み取りの時に
// 「新バケット→SYSTEM_BUCKET」の順で探す(platform/r2/bucket-with-fallback.ts)。
// Item7残課題7: 得意先へのOTPダウンロード配布に対応。得意先への案内メールは「選択して送信(方式A)」
// (delivery-note-mail.service.tsのDeliveryNoteMailService)で、PDF が未発行なら送らない。
export class DeliveryNotePdfService {
  constructor(private repo: ShipmentsRepository) {}

  // PERF-07 B-3: PDF を作るためのデータ(GET /:id/pdf-source)。作れない場合は理由をエラーで返す。
  // withLayout が false の時(受け取った PDF の保存の時)は、Excel テンプレートのレイアウトを読まない
  async buildPdfSource(c: Context<{ Bindings: Env }>, shipmentHeaderId: string, withLayout = true) {
    const header = await this.repo.findHeaderById(shipmentHeaderId);
    if (!header) throw new NotFoundError("対象の出庫が見つかりません");
    if (!header.partnerId) throw new BadRequestError("得意先が設定されていない出庫には、納品書を作成できません");

    const items = await this.repo.findItemsWithPricingByHeaderId(shipmentHeaderId);
    if (items.length === 0) throw new BadRequestError("明細の無い出庫には、納品書を作成できません");

    const warehousesRepo = new WarehousesRepository(c.env.DB);
    const partnersRepo = new PartnersRepository(c.env.DB);
    const productsRepo = new ProductsRepository(c.env.DB);

    const [warehouse, partner] = await Promise.all([
      warehousesRepo.findById((items[0] as any).warehouseId),
      partnersRepo.findById(header.partnerId),
    ]);
    if (!partner) throw new BadRequestError("出庫の得意先が取引先マスタに見つかりません");

    // 不具合修正(2026-09-23): 納品書には受注で選択された納品先の住所を印字する必要がある。
    // 従来はpartner.address(取引先の代表住所)しか見ておらず、受注ごとの納品先
    // (Item10 Phase C、deliveryPlace)が反映されていなかった。未設定の受注/単独出庫では
    // 従来通りpartner.addressにフォールバックする
    let orderDeliveryPlace: string | null = null;
    if (header.salesOrderId) {
      const salesOrderRepo = new SalesOrderRepository(c.env.DB);
      const salesOrder = await salesOrderRepo.findOrderById(header.salesOrderId);
      orderDeliveryPlace = salesOrder?.deliveryPlace || null;
    }
    const recipientAddress = orderDeliveryPlace || partner.address;

    const itemsWithNames = await Promise.all(
      items.map(async (item: any) => {
        const product = await productsRepo.findProductById(item.itemId);
        return {
          itemId: item.itemId,
          itemName: product?.name || item.itemId,
          // ロット未指定時の既定値"NONE"はそのまま表示すると紛らわしいため、帳票上は空欄にする
          // (shipment-instruction-pdf.service.tsと同じ扱い)
          lotNumber: item.lotNumber === "NONE" ? "" : item.lotNumber,
          quantity: item.shippedQuantity,
          // Item7残課題7: 受注に紐づく明細のみ設定される(単独出庫明細はnull=空欄表示)
          unitPrice: item.unitPrice ?? null,
          amount: item.amount ?? null,
        };
      }),
    );

    const systemConfig = (await getCompanySettings(c.env.COMPANY_SETTINGS)) ?? {};

    const deliveryNoteData: InstructionPdfData = {
      documentTitle: "納品書",
      code: shipmentHeaderId,
      date: todayJst(),
      recipientLabel: "納品先(得意先)",
      recipientName: partner.name,
      recipientAddress,
      recipientTel: partner.phone,
      partnerLabel: "出荷元倉庫",
      partnerName: warehouse?.name || "-",
      scheduledDateLabel: "出荷日",
      scheduledDate: new Date(header.shippedDate).toISOString().slice(0, 10),
      companyName: (systemConfig as any).company_name || "",
      companyZip: (systemConfig as any).company_zip || "",
      companyAddress: (systemConfig as any).company_address || "",
      companyTel: (systemConfig as any).company_tel || "",
      companyFax: (systemConfig as any).company_fax || "",
      memo: header.memo,
      items: itemsWithNames,
      // Item7残課題7: 受注に紐づく出庫のみ設定(単独出庫はnullのまま、受注番号欄・単価列を出さない)
      salesOrderId: header.salesOrderId || null,
      showPriceColumns: true,
    };

    // カスタムExcelテンプレート判定は既存の指示書向けデータ構造(InstructionPdfData)のまま
    // 維持する(resolveInstructionPlaceholders側で既に納品書のフィールドを解決できているため
    // 変更不要)。既定レイアウト(フォールバック)のみ、画面構成再編により注文請書と同じ
    // pdfGenerator.tsのパイプラインへ切り替える(忠実移行: ロット番号は品名へ付記し、
    // 小計/消費税/合計はreportLayouts.jsonのDELIVERYエントリでshowTotals:falseとして
    // 元々表示していなかった見た目を維持する)
    const customLayout = !withLayout
      ? null
      : await loadCustomLayoutSource(c.env, REPORT_TEMPLATE_CATEGORY, () =>
          resolveInstructionPlaceholders(deliveryNoteData),
        );

    {
      const pdfData: PDFInvoiceData = {
        templateType: "DELIVERY",
        code: shipmentHeaderId,
        date: todayJst(),
        customCompanyName: (systemConfig as any).company_name || "",
        customCompanyZip: (systemConfig as any).company_zip || "",
        customCompanyAddress: (systemConfig as any).company_address || "",
        customCompanyTel: (systemConfig as any).company_tel || "",
        customCompanyFax: (systemConfig as any).company_fax || "",
        customerName: partner.name,
        totalAmount: 0,
        taxAmount: 0,
        memo: header.memo,
        deliveryDate: new Date(header.shippedDate).toISOString().slice(0, 10),
        deliveryPlace: recipientAddress,
        sourceWarehouseName: warehouse?.name || "-",
        salesOrderNumber: header.salesOrderId || "",
        items: itemsWithNames.map((item) => ({
          itemName: item.lotNumber ? `${item.itemName}(ロット:${item.lotNumber})` : item.itemName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      };
      const source: ReportPdfSource = {
        documentType: REPORT_TEMPLATE_CATEGORY,
        customLayout,
        fallback: { kind: "document", data: pdfData },
      };
      return { source };
    }
  }

  // PERF-07 B-4: できた PDF を保存し、出庫に納品書として記録する(generate-pdf と、ブラウザから受け取った PDF の両方)
  async storePdf(
    c: Context<{ Bindings: Env }>,
    shipmentHeaderId: string,
    pdfBinary: Uint8Array,
    _built?: unknown,
    uploadedBy?: { userId: string; size: number },
  ) {
    const r2Path = generateAttachmentKey(
      `inventory-documents/delivery-notes/${shipmentHeaderId}`,
      "delivery_note.pdf",
    );
    await c.env.DELIVERY_NOTES_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await this.repo.updateDeliveryNotePath(shipmentHeaderId, r2Path);
    // 納品書はこれまで監査ログを残していなかった。ブラウザから受け取った時は、誰がどの大きさの PDF を上げたかを残す(PERF-07 B-4)
    if (uploadedBy) {
      c.executionCtx.waitUntil(
        logAuditEvent(c, "UPLOAD_DELIVERY_NOTE_PDF", "inventory_stock", shipmentHeaderId, null, {
          r2Path,
          generatedIn: "browser",
          uploadedBy: uploadedBy.userId,
          pdfBytes: uploadedBy.size,
        }),
      );
    }
    return { success: true as const, message: "納品書PDFを作成しました" };
  }
}
