// app/AccessDenied.tsx
"use client";

import { useRouter } from "next/navigation";
import { Button } from "./_shared/ui/Button";

export function AccessDenied() {
  const router = useRouter();

  return (
    <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-3 bg-white border border-slate-200 rounded-xl p-8 shadow-sm">
      <div className="text-3xl">⚠️</div>
      <h2 className="text-sm font-black text-slate-900">アクセス認可エラー</h2>
      <p className="text-xs text-slate-600 max-w-sm leading-normal">
        この画面を開くためのアクセス制限権限(menu)があなたのロールに付与されていません。
      </p>
      <Button className="mt-2" onClick={() => router.push("/dashboard")}>
        ダッシュボードへ戻る
      </Button>
    </div>
  );
}
