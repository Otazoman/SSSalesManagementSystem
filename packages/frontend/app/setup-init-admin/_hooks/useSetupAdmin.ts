"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserCountResponse } from "../_types";

export function useSetupAdmin() {
  const router = useRouter();

  // 直アクセスガード用ステート
  const [isChecking, setIsChecking] = useState(true);

  // フォーム用ステート
  const [empNum] = useState("admin");
  const [setupToken, setSetupToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // 🛡️ クライアント側での直アクセスガード処理
  useEffect(() => {
    async function checkAdminExists() {
      try {
        // Cookieなしでも叩けるカウント用APIをフェッチ
        const res = await fetch("/api/users/count");
        if (!res.ok) throw new Error("ユーザー数の取得に失敗しました");

        const data: UserCountResponse = await res.json();

        // 既にユーザー（管理者含む）が1人以上存在する場合は、即座にログイン画面へ飛ばす
        if (data.totalUsers > 0) {
          router.replace("/login");
        } else {
          // まだ誰も登録されていない場合のみ、チェック中フラグを落として画面を表示する
          setIsChecking(false);
        }
      } catch (err) {
        console.error("アクセスガード確認エラー:", err);
        // APIがエラーを返した場合も安全側に倒してログイン画面へリダイレクト
        router.replace("/login");
      }
    }

    checkAdminExists();
  }, [router]);

  // フォーム送信処理
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    if (password !== confirmPassword) {
      setError("パスワードと確認用パスワードが一致しません");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/users/setup-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupToken,
          employeeNumber: empNum,
          name,
          email,
          password,
        }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "管理者登録に失敗しました");

      setSuccess(
        "システム管理者の初期登録が完了しました！ログイン画面へ移動します",
      );
      setTimeout(() => router.push("/login"), 3000);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("登録処理中に予期せぬエラーが発生しました");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isChecking,
    empNum,
    setupToken,
    setSetupToken,
    name,
    setName,
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    success,
    isLoading,
    handleSubmit,
  };
}
