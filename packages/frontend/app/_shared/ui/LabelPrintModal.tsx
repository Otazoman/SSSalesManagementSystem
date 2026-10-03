"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../_shared/ui/Button";
import { Modal } from "../../_shared/ui/Modal";
import qrcode from "qrcode-generator";
import JsBarcode from "jsbarcode";
import { labelBarcodeFormat } from "../barcode-format";

interface LabelPrintModalProps {
  title: string;
  value: string;
  onClose: () => void;
}

type LabelFormat = "qr" | "barcode";

/**
 * ロケーション/商品ラベルのQR・バーコード表示＋印刷用モーダル(Item6)。
 * 印刷はポップアップウィンドウにラベルのみを描画してwindow.print()する方式
 * (ページ全体を@media printで出し分けるより単純・確実なため)。
 */
export function LabelPrintModal({
  title,
  value,
  onClose,
}: LabelPrintModalProps) {
  const [format, setFormat] = useState<LabelFormat>("qr");
  const barcodeRef = useRef<SVGSVGElement | null>(null);

  const qrDataUrl = useMemo(() => {
    if (format !== "qr" || !value) return "";
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return qr.createDataURL(8, 4);
  }, [format, value]);

  useEffect(() => {
    if (format !== "barcode" || !barcodeRef.current || !value) return;
    try {
      JsBarcode(barcodeRef.current, value, {
        // BUG-007: 正しい JAN は JAN(EAN-13・EAN-8)で、それ以外は CODE128 で描く
        format: labelBarcodeFormat(value),
        displayValue: true,
        fontSize: 16,
        width: 2,
        height: 60,
        // CODE128・JAN は左右に線10本分(JAN は11本分)程度の余白(クワイエットゾーン)が要るため、
        // 線の太さ(2px)×10本分にする(以前の 8px は規格より狭かった)
        margin: 20,
      });
    } catch (err) {
      console.error("バーコード描画に失敗しました:", err);
    }
  }, [format, value]);

  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=420,height=520");
    if (!printWindow) return;

    const bodyHtml =
      format === "qr"
        ? `<img src="${qrDataUrl}" style="width:240px;height:240px;" />`
        : barcodeRef.current
          ? barcodeRef.current.outerHTML
          : "";

    printWindow.document.write(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;padding:24px;">
  ${bodyHtml}
  <p style="margin-top:12px;font-size:14px;word-break:break-all;text-align:center;">${title}<br/>${value}</p>
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    // BUG-007: 英数字の CODE128 は幅が広い(例: 12文字で約 370px)ため、左右の余白(クワイエットゾーン)まで
    // 欠けずに表示できるよう lg にする。さらに長い値は、縮めずに横スクロールで見せる(縮めると線が細くなる)
    <Modal title={<>{title}</>} size="lg" onClose={onClose}>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setFormat("qr")}
          className={`text-xs px-3 py-1.5 rounded font-bold cursor-pointer border ${
            format === "qr"
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-slate-600 border-slate-300"
          }`}
        >
          QRコード
        </button>
        <button
          type="button"
          onClick={() => setFormat("barcode")}
          className={`text-xs px-3 py-1.5 rounded font-bold cursor-pointer border ${
            format === "barcode"
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-slate-600 border-slate-300"
          }`}
        >
          バーコード
        </button>
      </div>

      <div className="flex flex-col items-center justify-center border border-slate-200 rounded-lg p-4 bg-white min-h-[180px]">
        {format === "qr" ? (
          qrDataUrl && <img src={qrDataUrl} alt={value} className="w-40 h-40" />
        ) : (
          <div className="max-w-full overflow-x-auto">
            <svg ref={barcodeRef} />
          </div>
        )}
        <p className="text-xs text-slate-700 mt-2 break-all text-center">
          {value}
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="success" className="flex-1" onClick={handlePrint}>
          🖨️ 印刷
        </Button>
        <button
          type="button"
          onClick={onClose}
          className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded font-bold cursor-pointer"
        >
          閉じる
        </button>
      </div>
    </Modal>
  );
}
