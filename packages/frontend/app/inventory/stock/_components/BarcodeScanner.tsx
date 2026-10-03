"use client";

import { useBarcodeScanner } from "../_hooks/useBarcodeScanner";
import { Button } from "../../../_shared/ui/Button";

interface BarcodeScannerProps {
  label: string;
  onDetect: (text: string) => void;
  /**
   * 読み取った結果のメッセージ(成功・エラー)。カメラの映像のすぐ下に表示する。
   * スマートフォンでは画面上部のメッセージ欄がスキャン中に見えないため(BUG-006)、ここにも出す
   */
  resultMessage?: string;
  resultError?: string;
}

/**
 * QR/バーコードのカメラスキャンUI共通コンポーネント(@zxing/browserを使用)。
 * カメラが使えない/権限拒否時は呼び出し元のPC手入力欄が代替経路となる。
 */
export function BarcodeScanner({ label, onDetect, resultMessage, resultError }: BarcodeScannerProps) {
  const { videoRef, status, errorMessage, engine, resolution, start, stop } =
    useBarcodeScanner(onDetect);

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-slate-800">📷 {label}</span>
        {status === "scanning" ? (
          <Button variant="danger" size="sm" onClick={stop}>
            無効
          </Button>
        ) : (
          <Button size="sm" onClick={start}>
            {status === "starting" ? "起動中..." : "カメラ起動"}
          </Button>
        )}
      </div>

      {/*
        意図的に常時マウント・表示する(display:noneで隠さない)。
        @zxing/browserはスキャン開始時にvideo要素の現在の寸法からキャプチャ用canvasを
        一度だけ作成するため、非表示状態と初期化タイミングが重なると正しく機能しないことがある。
      */}
      <video
        ref={videoRef}
        className="w-full max-h-56 bg-slate-900 rounded object-cover"
        muted
        playsInline
      />

      {(resultError || resultMessage) && (
        <p
          role="status"
          aria-live="polite"
          className={`text-base font-bold rounded px-3 py-2 border ${
            resultError
              ? "bg-red-50 text-red-800 border-red-200"
              : "bg-emerald-50 text-emerald-800 border-emerald-200"
          }`}
        >
          {resultError || resultMessage}
        </p>
      )}

      {status === "scanning" && (
        <>
          <p className="text-sm text-slate-600">
            読み取り中です。QR/バーコードを枠内に大きく、ピントが合うようにゆっくり近づけてください。
          </p>
          {/* 実機で読み取れない時の確認用(読み取りの方式とカメラの解像度) */}
          <p className="text-xs text-slate-600">
            読み取り方式: {engine === "native" ? "端末の標準機能" : "ZXing"}
            {resolution && ` / カメラ: ${resolution}`}
          </p>
        </>
      )}
      {status === "unsupported" && (
        <p className="text-sm text-amber-700 font-semibold">{errorMessage}</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-700 font-semibold">{errorMessage}</p>
      )}
    </div>
  );
}
