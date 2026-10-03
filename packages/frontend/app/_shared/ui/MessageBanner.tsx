"use client";

interface MessageBannerProps {
  message?: string;
  error?: string;
  warning?: string;
}

/**
 * 成功/エラーメッセージバナー。15箇所以上でバイト単位同一のTailwindクラスとともに
 * コピーされているマークアップを1箇所にまとめたもの。
 */
export function MessageBanner({ message, error, warning }: MessageBannerProps) {
  if (!message && !error && !warning) return null;

  return (
    <div className="space-y-2">
      {message && (
        <div className="p-3 bg-emerald-50 text-emerald-800 text-xs font-semibold rounded border border-emerald-100">
          {message}
        </div>
      )}
      {warning && (
        <div className="p-3 bg-amber-50 text-amber-800 text-xs font-semibold rounded border border-amber-200">
          {warning}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded border border-red-100">
          {error}
        </div>
      )}
    </div>
  );
}
