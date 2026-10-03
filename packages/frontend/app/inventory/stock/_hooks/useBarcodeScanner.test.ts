import { describe, it, expect } from "vitest";
import { buildCameraConstraints, nativeScanFormats, SCAN_FORMATS } from "./useBarcodeScanner";

function windowWithDetector(supported: string[] | null) {
  if (supported === null) return {} as Window;
  return { BarcodeDetector: { getSupportedFormats: async () => supported } } as unknown as Window;
}

describe("nativeScanFormats(端末の標準機能を使うかの判定)", () => {
  it("BarcodeDetector が無い端末(iPhone の Safari など)では null(ZXing を使う)", async () => {
    expect(await nativeScanFormats(windowWithDetector(null))).toBeNull();
  });

  it("QR と CODE128 の両方に対応していれば、読み取る形式の一覧を返す", async () => {
    const formats = await nativeScanFormats(windowWithDetector(["qr_code", "code_128", "ean_13", "aztec"]));
    expect(formats).toEqual(["qr_code", "code_128", "ean_13"]);
  });

  it("QR か CODE128 のどちらかに対応していなければ null(ラベルを読めないため ZXing を使う)", async () => {
    expect(await nativeScanFormats(windowWithDetector(["qr_code", "ean_13"]))).toBeNull();
    expect(await nativeScanFormats(windowWithDetector(["code_128"]))).toBeNull();
  });

  it("対応形式の取得に失敗したら null", async () => {
    const win = { BarcodeDetector: { getSupportedFormats: async () => Promise.reject(new Error("x")) } } as unknown as Window;
    expect(await nativeScanFormats(win)).toBeNull();
  });
});

describe("buildCameraConstraints(カメラの指定)", () => {
  it("背面カメラ・高い解像度を希望する(対応しない端末でもエラーにならない ideal 指定)", () => {
    const video = buildCameraConstraints().video as MediaTrackConstraints;
    expect(video.facingMode).toEqual({ ideal: "environment" });
    expect(video.width).toEqual({ ideal: 1920 });
    expect(video.height).toEqual({ ideal: 1080 });
  });
});

describe("SCAN_FORMATS(読み取るコードの種類)", () => {
  it("ロケーションのラベル(QR)・品目のラベル(CODE128)・JAN(EAN-13)を含む", () => {
    expect(SCAN_FORMATS).toEqual(expect.arrayContaining(["qr_code", "code_128", "ean_13"]));
  });
});
