/**
 * Item6: 商品のQR/バーコードに印刷・照合する値の解決ロジック。
 * 商品マスタに「商品バーコード」が登録されている商品はその値のみで照合する
 * (登録済みバーコードと商品IDが偶然一致する事故を避けるため)。
 * 未登録の商品は商品IDを印刷・照合対象とする。
 */
export interface ScannableProduct {
  id: string;
  productBarcode?: string | null;
}

export function resolveProductScanCode(product: ScannableProduct): string {
  const barcode = product.productBarcode?.trim();
  return barcode || product.id;
}

export function matchProductByScanCode<T extends ScannableProduct>(
  products: T[],
  scannedCode: string,
): T | null {
  const trimmed = scannedCode.trim();
  const byBarcode = products.find((p) => p.productBarcode?.trim() === trimmed);
  if (byBarcode) return byBarcode;
  return products.find((p) => !p.productBarcode?.trim() && p.id === trimmed) || null;
}
