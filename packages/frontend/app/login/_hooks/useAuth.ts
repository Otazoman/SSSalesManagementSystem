import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginResponse } from "../_types";

export type LoginMode = "email" | "employeeNumber";

export function useAuth() {
  const router = useRouter();
  const [loginMode, setLoginMode] = useState<LoginMode>("email");
  const [email, setEmail] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 1. システム初期化チェック
  useEffect(() => {
    async function checkSystemInitialized() {
      try {
        const res = await fetch("/api/users/count");
        if (res.ok) {
          const data = await res.json();
          if (data.totalUsers === 0) {
            router.push("/setup-init-admin");
          }
        }
      } catch (err) {
        console.error("システム初期化チェックに失敗しました", err);
      }
    }
    checkSystemInitialized();
  }, [router]);

  // 2. ログイン処理
  const handleSignIn = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          loginMode === "email"
            ? { email, password }
            : { employeeNumber, password },
        ),
        credentials: "include",
      });

      const data: LoginResponse = await res.json();
      if (!res.ok) throw new Error(data.message || "ログインに失敗しました");

      // セッションcookie(httpOnly・署名付き)はBackendのSet-Cookieで発行済みのため、
      // フロントエンド側でのcookie書き込みは不要。

      if (data.user.mustChangePassword === true) {
        console.log("初回ログイン。パスワード強制変更画面へ遷移します。");
        router.push("/force-password-change");
        return;
      }

      console.log("通常ログイン。メニュー画面へ遷移します。");
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("ログイン処理中に予期せぬエラーが発生しました");
      }
    } finally {
      setLoading(false);
    }
  };

  return {
    loginMode,
    setLoginMode,
    email,
    setEmail,
    employeeNumber,
    setEmployeeNumber,
    password,
    setPassword,
    error,
    loading,
    handleSignIn,
    router,
  };
}
