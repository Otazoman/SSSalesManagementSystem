"use client";

interface LoadingGateProps {
  label?: string;
}

/**
 * 「権限を確認中...」等、10箇所以上に同一のJSXがコピーされているローディング表示の共通化。
 * 呼び出し側で`if (loading) return <LoadingGate />;`のように早期returnして使う想定
 * （既存の各featureページの書き方をそのまま踏襲）。
 */
export function LoadingGate({ label = "権限を確認中..." }: LoadingGateProps) {
  return (
    <div className="w-full text-center py-12 text-xs text-slate-700 font-medium">
      {label}
    </div>
  );
}
