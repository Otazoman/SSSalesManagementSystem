"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ScannerStatus = "idle" | "starting" | "scanning" | "unsupported" | "error";

/** 読み取りの方式。native = 端末の標準機能(BarcodeDetector)、zxing = @zxing/browser */
export type ScanEngine = "native" | "zxing";

// scan()の内部ループが(想定外のエラー等で)静かに停止した場合を検知するための監視間隔。
// 通常は検出の有無に関わらず高頻度でコールバックが呼ばれ続けるため、この間隔を超えて
// 一度もコールバックが呼ばれなければループが死んでいると判断し、再起動を促す
const WATCHDOG_INTERVAL_MS = 6000;

// 端末の標準機能(BarcodeDetector)で読み取りを試す間隔
const NATIVE_SCAN_INTERVAL_MS = 150;

// カメラは同じコードを1秒に何回も読むため、同じ内容はこの間隔の間は繰り返し通知しない
const SAME_CODE_SUPPRESS_MS = 1500;

/**
 * 読み取るコードの種類。ロケーションのラベル(QR)、品目のラベル(CODE128)、市販品の JAN(EAN-13/8)と、
 * 一般的な1次元バーコードに絞る(全種類を毎回試すより速く、誤読も減る)。
 * 名前は BarcodeDetector の形式名。ZXing の BarcodeFormat への対応は ZXING_FORMAT_NAMES。
 */
export const SCAN_FORMATS = ["qr_code", "code_128", "ean_13", "ean_8", "code_39", "upc_a", "upc_e", "itf", "codabar"] as const;

const ZXING_FORMAT_NAMES: Record<(typeof SCAN_FORMATS)[number], string> = {
  qr_code: "QR_CODE",
  code_128: "CODE_128",
  ean_13: "EAN_13",
  ean_8: "EAN_8",
  code_39: "CODE_39",
  upc_a: "UPC_A",
  upc_e: "UPC_E",
  itf: "ITF",
  codabar: "CODABAR",
};

// @zxing/library の DecodeHintType の値(@zxing/browser からは再 export されていないため、値で指定する)
const DECODE_HINT_POSSIBLE_FORMATS = 2;
const DECODE_HINT_TRY_HARDER = 3;

/**
 * カメラの指定。背面カメラ・高い解像度・近くへの連続オートフォーカスを希望する。
 * 既定(解像度の指定なし)だとスマートフォンでは 640×480 程度になり、細い線のバーコードが読めないことがある。
 * いずれも ideal(希望)なので、対応していない端末でもエラーにはならない。
 */
export function buildCameraConstraints(): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      // focusMode は標準の型定義に無いが、Android の Chrome などで連続オートフォーカスになる
      advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
    },
  };
}

interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
interface NativeBarcodeDetectorClass {
  new (options: { formats: string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

/**
 * 端末の標準機能(BarcodeDetector)で使える形式。使えない端末(iPhone の Safari など)では null。
 * QR と CODE128 の両方に対応している場合だけ使う(ラベルの読み取りに必要なため)
 */
export async function nativeScanFormats(win: Window = window): Promise<string[] | null> {
  const Detector = (win as unknown as { BarcodeDetector?: NativeBarcodeDetectorClass }).BarcodeDetector;
  if (!Detector?.getSupportedFormats) return null;
  try {
    const supported = await Detector.getSupportedFormats();
    const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
    return formats.includes("qr_code") && formats.includes("code_128") ? [...formats] : null;
  } catch {
    return null;
  }
}

/**
 * QR/バーコードのカメラスキャナー。
 *
 * 読み取りの方式は2つ。端末の標準機能(BarcodeDetector、Android の Chrome など)が使えればそれを使い、
 * 使えなければ @zxing/browser を使う。
 *
 * 実機検証の結果判明した点に対応している:
 * 1. スキャン用<video>要素をCSSで非表示(display:none)にした状態で開始すると、
 *    キャプチャ用canvasの寸法を正しく取れない場合があるため、videoは常時マウント・表示する。
 * 2. @zxing/browserの内部スキャンループは、コード未検出以外の想定外のエラーが1回でも発生すると
 *    静かに停止する。このためエラーを必ずログし、一定時間コールバックが呼ばれなければ
 *    停止したとみなしてエラー状態にする(監視タイマー)。
 * 3. (2026-09-23 BUG-006)スマートフォンで「カメラは映るが読み取らない」不具合への対応として、
 *    カメラの解像度・ピントを指定し(buildCameraConstraints)、読むコードの種類を絞り、
 *    ZXing では精度を上げる設定(TRY_HARDER)を使う。端末の標準機能が使える場合はそちらを優先する。
 *
 * PC手入力(ManualLocationPicker等)は別経路として常に併用可能。
 */
export function useBarcodeScanner(onDetect: (text: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  // 実機で状況を確かめられるよう、読み取りの方式とカメラの解像度を画面に出す
  const [engine, setEngine] = useState<ScanEngine | null>(null);
  const [resolution, setResolution] = useState("");
  const stopRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCallbackAtRef = useRef(0);
  const onDetectRef = useRef(onDetect);
  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);
  const lastDetectedRef = useRef({ text: "", at: 0 });

  /** 読み取った内容を通知する(同じ内容の連続は抑止し、読み取れたことを振動で知らせる) */
  const notifyDetected = useCallback((text: string) => {
    const now = Date.now();
    const last = lastDetectedRef.current;
    if (text === last.text && now - last.at < SAME_CODE_SUPPRESS_MS) return;
    lastDetectedRef.current = { text, at: now };
    navigator.vibrate?.(80);
    onDetectRef.current(text);
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    clearWatchdog();
    stopRef.current?.();
    stopRef.current = null;
    setStatus("idle");
  }, [clearWatchdog]);

  /** 読み取りを開始できたら、状態・解像度の表示と監視タイマーを設定する */
  const beginMonitoring = useCallback(
    (generation: number) => {
      const video = videoRef.current;
      const updateResolution = () => {
        if (video?.videoWidth) setResolution(`${video.videoWidth}×${video.videoHeight}`);
      };
      updateResolution();
      video?.addEventListener("loadedmetadata", updateResolution, { once: true });
      setStatus("scanning");

      clearWatchdog();
      watchdogRef.current = setInterval(() => {
        if (generation !== generationRef.current) return;
        if (Date.now() - lastCallbackAtRef.current > WATCHDOG_INTERVAL_MS) {
          clearWatchdog();
          stopRef.current?.();
          stopRef.current = null;
          setStatus("error");
          setErrorMessage(
            "スキャナーが応答を停止しました。もう一度「カメラ起動」を押してやり直してください。",
          );
        }
      }, 1000);
    },
    [clearWatchdog],
  );

  /** 端末の標準機能(BarcodeDetector)で読み取る */
  const startNative = useCallback(
    async (generation: number, formats: string[]) => {
      const video = videoRef.current;
      if (!video) return;
      const Detector = (window as unknown as { BarcodeDetector: NativeBarcodeDetectorClass }).BarcodeDetector;
      const detector = new Detector({ formats });
      const stream = await navigator.mediaDevices.getUserMedia(buildCameraConstraints());
      if (generation !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();

      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      const tick = async () => {
        if (stopped || generation !== generationRef.current) return;
        lastCallbackAtRef.current = Date.now();
        try {
          if (video.readyState >= 2) {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue && !stopped && generation === generationRef.current) {
              notifyDetected(codes[0].rawValue);
            }
          }
        } catch (err) {
          console.warn("バーコードスキャン中にエラーが発生しました:", err);
        }
        timer = setTimeout(tick, NATIVE_SCAN_INTERVAL_MS);
      };
      stopRef.current = () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
      };
      lastCallbackAtRef.current = Date.now();
      void tick();
      beginMonitoring(generation);
    },
    [beginMonitoring, notifyDetected],
  );

  /** @zxing/browser で読み取る */
  const startZxing = useCallback(
    async (generation: number) => {
      const { BrowserMultiFormatReader, BarcodeFormat } = await import("@zxing/browser");
      const hints = new Map<number, unknown>();
      hints.set(
        DECODE_HINT_POSSIBLE_FORMATS,
        SCAN_FORMATS.map((f) => BarcodeFormat[ZXING_FORMAT_NAMES[f] as keyof typeof BarcodeFormat]),
      );
      hints.set(DECODE_HINT_TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints as ConstructorParameters<typeof BrowserMultiFormatReader>[0]);
      if (!videoRef.current || generation !== generationRef.current) return;

      lastCallbackAtRef.current = Date.now();
      const controls = await reader.decodeFromConstraints(
        buildCameraConstraints(),
        videoRef.current,
        (result, decodeError) => {
          if (generation !== generationRef.current) return;
          lastCallbackAtRef.current = Date.now();
          if (result) {
            notifyDetected(result.getText());
            return;
          }
          if (decodeError && decodeError.getKind() !== "NotFoundException") {
            // コード未検出以外の異常(内部ループが停止する原因になりうる)は診断用にログする。
            // .name はミニファイ後にクラス名が失われる可能性があるため、
            // ミニファイの影響を受けない静的kind文字列で判定する
            console.warn("バーコードスキャン中にエラーが発生しました:", decodeError);
          }
        },
      );

      if (generation !== generationRef.current) {
        controls.stop();
        return;
      }
      stopRef.current = () => controls.stop();
      beginMonitoring(generation);
    },
    [beginMonitoring, notifyDetected],
  );

  const start = useCallback(async () => {
    setErrorMessage("");
    setResolution("");
    setStatus("starting");
    generationRef.current += 1;
    const generation = generationRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setErrorMessage("このブラウザはカメラを利用できません。PC入力をご利用ください。");
      return;
    }

    try {
      const formats = await nativeScanFormats();
      if (generation !== generationRef.current) return;
      if (formats) {
        setEngine("native");
        await startNative(generation, formats);
      } else {
        setEngine("zxing");
        await startZxing(generation);
      }
    } catch (err: unknown) {
      if (generation !== generationRef.current) return;
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "カメラの起動に失敗しました");
    }
  }, [startNative, startZxing]);

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { videoRef, status, errorMessage, engine, resolution, start, stop };
}
