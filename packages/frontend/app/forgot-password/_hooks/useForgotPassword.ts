import { useState } from "react";
import { useRouter } from "next/navigation";
import { ForgotPasswordResponse } from "../_types";

export function useForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRequestReset = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/users/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include",
      });
      const data: ForgotPasswordResponse = await res.json();
      if (!res.ok) throw new Error(data.message || "送信に失敗しました");

      setMessage(data.message || "再設定案内メールの送信を予約しました");
      setEmail("");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return {
    email,
    setEmail,
    error,
    message,
    loading,
    handleRequestReset,
    router,
  };
}
