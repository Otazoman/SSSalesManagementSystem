"use client";

interface AccessDeniedInlineProps {
  title?: string;
  description?: string;
}

/**
 * 「🚫 アクセス権限がありません」ボックスの共通化。
 * `tax-categories`（権限ガード自体が欠落）・`quotes`（canRead欠落）の是正時にも使用する想定。
 */
export function AccessDeniedInline({
  title = "🔒 この画面を閲覧する権限がありません",
  description = "この画面を表示する権限(read / menu)が割り当てられていません。",
}: AccessDeniedInlineProps) {
  return (
    <div className="w-full p-6 bg-red-50 border border-red-200 rounded-xl text-center">
      <h2 className="text-sm font-bold text-red-800">{title}</h2>
      {description && (
        <p className="text-xs text-red-600 mt-1">{description}</p>
      )}
    </div>
  );
}
