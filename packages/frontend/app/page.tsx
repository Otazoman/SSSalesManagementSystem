"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function IndexPage() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function checkSystem() {
      try {
        const res = await fetch("/api/users/count");
        const data = await res.json();

        if (!isMounted) return;

        if (data.totalUsers === 0) {
          router.replace("/setup-init-admin"); // 💡 push ではなく replace にすることで「戻る」ボタンで再度このページに戻るのを防止
        } else {
          router.replace("/dashboard");
        }
      } catch (err) {
        console.error("システムチェックエラー:", err);
        if (isMounted) setIsChecking(false);
      }
    }

    void checkSystem();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
      {isChecking
        ? "システムを最適化中..."
        : "システムの読み込みに失敗しました"}
    </div>
  );
}
