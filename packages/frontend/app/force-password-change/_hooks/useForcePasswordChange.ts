import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChangePasswordResponse } from "../_types";

export function useForcePasswordChange() {
  const router = useRouter();

  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch("/api/auth/profile", {
          method: "GET",
          credentials: "include",
        });
        if (!res.ok) {
          router.push("/login");
          return;
        }
        const data = await res.json();
        setUserId(data.id);
        setUserName(data.name || "");
      } catch (err) {
        console.error("プロフィールの取得に失敗しました", err);
        router.push("/login");
      }
    }
    void loadProfile();
  }, [router]);

  const handleUpdatePassword = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError("新しいパスワードと確認用パスワードが一致しません");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, currentPassword, newPassword }),
        credentials: "include",
      });
      const data: ChangePasswordResponse = await res.json();
      if (!res.ok) throw new Error(data.message || "更新に失敗しました");

      setMessage(
        "パスワードを初期化しました。新しいパスワードで再度ログインしてください。",
      );
      setTimeout(() => {
        router.push("/login");
      }, 2500);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return {
    userName,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    message,
    loading,
    handleUpdatePassword,
  };
}
