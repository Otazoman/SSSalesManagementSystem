import { Context } from "hono";
import { Env } from "../../../types/env";
import { ShipmentsRepository } from "./shipments.repository";
import { WarehousesRepository } from "../../master/warehouses/warehouses.repository";
import { PartnersRepository } from "../../master/partners/partners.repository";
import { ProductsRepository } from "../../master/products/products.repository";
import { SalesOrderRepository } from "../../sales/orders/sales-order.repository";
import { getCompanySettings } from "../../../platform/kv/company-settings-cache";
import { generateAttachmentKey } from "../../../platform/r2/generate-attachment-key";
import { InstructionPdfData } from "../../../platform/report-templates/generate-instruction-pdf";
import { tryRenderInstructionPdfFromCustomTemplate } from "../../../platform/report-templates/try-render-instruction-pdf";
import { generateDocumentPDF, PDFInvoiceData } from "../../../utils/pdfGenerator";
import { BadRequestError, NotFoundError } from "../../../platform/http/http-error";
import { todayJst } from "../../../platform/date/format-jst-date";

const REPORT_TEMPLATE_CATEGORY = "sales_invoice";

// Item6 Phase6-4: 納品書PDFの自動生成。出荷指示書/入荷指示書と異なりオンデマンドAPIではなく、
// 出庫が確定(APPROVED、実際に在庫が減算された)タイミングで自動生成する(ユーザー確定要件:
// 「出荷の際には納品書の出力も必要」)。自社倉庫の即時確定パス・外部倉庫実績取込の両方が
// 同じcreateShipment()を通るため、トリガー箇所はcreateShipment/resubmitShipmentの即時確定分岐と
// inventory-stock.adapter.tsのapplyApproved(ワークフロー確定時)の2箇所のみで足りる。
// R2保存先は専用バケットを新設せず、既存SYSTEM_BUCKETを新規キープレフィックスで流用する。
// Item7残課題7: 得意先へのOTPダウンロード配布に対応(得意先が自ら/delivery-note-downloadで
// メールアドレスを入力してOTPを取得する自己申告方式)。得意先への案内メール送信自体は
// 見積・受注・発注と同じ「選択して送信(方式A)」に統一しており、生成完了時の自動送信は
// 行わない(delivery-note-mail.service.tsのDeliveryNoteMailServiceが担当、2026-09-08廃止)。
export class DeliveryNotePdfService {
  constructor(private repo: ShipmentsRepository) {}

  // 出庫の承認・確定の時に裏側(waitUntil)で呼ぶ。納品書の作成に失敗しても出庫の確定は止めず、ログだけ残す
  // (在庫反映は既に完了しているため)。得意先が設定されていない出庫は納品書の対象外のため、何もしない
  async generateAndStore(c: Context<{ Bindings: Env }>, shipmentHeaderId: string): Promise<void> {
    const header = await this.repo.findHeaderById(shipmentHeaderId);
    if (!header || !header.partnerId) return;
    try {
      await this.generatePdf(c, shipmentHeaderId);
    } catch (err) {
      console.error(
        `[DeliveryNotePdf] 納品書PDF生成に失敗しました(shipmentHeaderId=${shipmentHeaderId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // BUG-030: 納品書のPDFを作る(既にあれば作り直す)。作れない場合は理由をエラーで返す。
  // 画面の「納品書PDFを作成」と、メール送信(PDF が無い時)から呼ぶ
  async generatePdf(c: Context<{ Bindings: Env }>, shipmentHeaderId: string) {
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

    const [fontRes, logoRes, sealRes] = await Promise.all([
      c.env.SYSTEM_BUCKET.get("fonts/company_fonts.ttf"),
      c.env.SYSTEM_BUCKET.get("company/company_logo.png"),
      c.env.SYSTEM_BUCKET.get("company/company_seal.png"),
    ]);
    if (!fontRes) {
      throw new BadRequestError("帳票用の日本語フォントが見つかりません。フォントをアップロードしてください");
    }
    const fontBuffer = await fontRes.arrayBuffer();
    const logoBuffer = logoRes ? await logoRes.arrayBuffer() : null;
    const sealBuffer = sealRes ? await sealRes.arrayBuffer() : null;

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
    const customPdf = await tryRenderInstructionPdfFromCustomTemplate(
      c.env,
      REPORT_TEMPLATE_CATEGORY,
      deliveryNoteData,
      fontBuffer,
    );

    let pdfBinary: Uint8Array;
    if (customPdf) {
      pdfBinary = customPdf;
    } else {
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
      pdfBinary = await generateDocumentPDF(pdfData, { fontBuffer, logoBuffer, sealBuffer });
    }

    const r2Path = generateAttachmentKey(
      `inventory-documents/delivery-notes/${shipmentHeaderId}`,
      "delivery_note.pdf",
    );
    await c.env.SYSTEM_BUCKET.put(r2Path, pdfBinary, {
      httpMetadata: { contentType: "application/pdf" },
    });
    await this.repo.updateDeliveryNotePath(shipmentHeaderId, r2Path);
    return { success: true as const, message: "納品書PDFを作成しました" };
  }
}
