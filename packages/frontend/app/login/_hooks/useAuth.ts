import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginResponse, OtpChallenge, UserData } from "../_types";

export type LoginMode = "email" | "employeeNumber";

export function useAuth() {
  const router = useRouter();
  const [loginMode, setLoginMode] = useState<LoginMode>("email");
  const [email, setEmail] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // REQ-004: ログイン時の OTP(パスワードが合った後、確認コードの入力を待つ)
  const [otpChallenge, setOtpChallenge] = useState<OtpChallenge | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [info, setInfo] = useState("");
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // 再送できるまでの残り秒数の表示のため、OTP の入力中だけ1秒ごとに時刻を進める
  useEffect(() => {
    if (!otpChallenge) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [otpChallenge]);
  const resendWaitSeconds = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));

  // セッションの発行後の画面遷移(パスワードだけ・OTP の確認後の両方で使う)
  const goAfterLogin = (user: UserData) => {
    if (user.mustChangePassword === true) {
      router.push("/force-password-change");
      return;
    }
    router.push("/dashboard");
  };

  const backToPassword = (message = "") => {
    setOtpChallenge(null);
    setOtpCode("");
    setInfo("");
    setError(message);
  };

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

      // REQ-004: OTP を使うユーザーは、確認コードの入力へ進む(セッションはまだ発行されていない)
      if (data.otpRequired && data.challengeId) {
        setOtpChallenge({
          challengeId: data.challengeId,
          channel: data.channel ?? "email",
          digitCount: data.digitCount ?? 6,
          expiresInMinutes: data.expiresInMinutes ?? 10,
          resendIntervalSeconds: data.resendIntervalSeconds ?? 60,
        });
        setOtpCode("");
        setInfo("");
        setResendAvailableAt(Date.now() + (data.resendIntervalSeconds ?? 60) * 1000);
        setNow(Date.now());
        return;
      }

      // セッションcookie(httpOnly・署名付き)はBackendのSet-Cookieで発行済みのため、
      // フロントエンド側でのcookie書き込みは不要。
      if (data.user) goAfterLogin(data.user);
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

  // REQ-004: 確認コードを確かめる。合っていればセッションが発行される
  const handleVerifyOtp = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!otpChallenge) return;
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/auth/login/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: otpChallenge.challengeId, code: otpCode }),
        credentials: "include",
      });
      const data: LoginResponse = await res.json();
      if (!res.ok) {
        if (data.restart) {
          backToPassword(data.message || "もう一度ログインしてください");
          return;
        }
        throw new Error(data.message || "確認コードが正しくありません");
      }
      if (data.user) goAfterLogin(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "確認コードの確認中に予期せぬエラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  // REQ-004: 確認コードを送り直す(会社設定の間隔が過ぎるまでは押せない)
  const handleResendOtp = async () => {
    if (!otpChallenge) return;
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/auth/login/otp/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: otpChallenge.challengeId }),
        credentials: "include",
      });
      const data: LoginResponse = await res.json();
      if (!res.ok) {
        if (data.restart) {
          backToPassword(data.message || "もう一度ログインしてください");
          return;
        }
        if (data.retryAfterSeconds) setResendAvailableAt(Date.now() + data.retryAfterSeconds * 1000);
        throw new Error(data.message || "確認コードを送れませんでした");
      }
      setOtpChallenge({ ...otpChallenge, channel: data.channel ?? otpChallenge.channel });
      setOtpCode("");
      setResendAvailableAt(Date.now() + (data.resendIntervalSeconds ?? otpChallenge.resendIntervalSeconds) * 1000);
      setNow(Date.now());
      setInfo("確認コードを送り直しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "確認コードの再送中に予期せぬエラーが発生しました");
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
    otpChallenge,
    otpCode,
    setOtpCode,
    info,
    resendWaitSeconds,
    handleVerifyOtp,
    handleResendOtp,
    backToPassword,
  };
}
