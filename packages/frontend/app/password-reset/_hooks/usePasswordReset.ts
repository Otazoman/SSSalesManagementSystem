import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ResetPasswordResponse } from "../_types";

export function usePasswordReset() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = searchParams.get("token");
    if (!t) {
      setError(
        "URLトークンが消失しているか無効です。もう一度やり直してください。",
      );
    } else {
      setToken(t);
    }
  }, [searchParams]);

  const handleResetSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!token) {
      setError("無効なセッションです");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("パスワードが一致しません");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/users/reset-password-via-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
        credentials: "include",
      });
      const data: ResetPasswordResponse = await res.json();
      if (!res.ok) throw new Error(data.message || "パスワードの再設定に失敗しました");

      setMessage(
        "パスワードを正常に書き換えました。5秒後にログイン画面へ転送します。",
      );
      setTimeout(() => {
        router.push("/login");
      }, 5000);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return {
    token,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    message,
    loading,
    handleResetSubmit,
  };
}
