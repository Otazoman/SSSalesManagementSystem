import { useAuth } from "../_hooks/useAuth";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import {
  PublicCard,
  PublicField,
  publicButtonClass,
  publicInputClass,
} from "../../_shared/ui/PublicCard";

export function LoginForm() {
  const {
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
  } = useAuth();

  const modeButtonClass = (mode: typeof loginMode) =>
    `flex-1 py-2.5 sm:py-1.5 rounded-lg transition-colors cursor-pointer ${
      loginMode === mode
        ? "bg-white text-indigo-700 shadow-sm"
        : "text-slate-600 hover:text-slate-800"
    }`;

  return (
    <PublicCard
      onSubmit={handleSignIn}
      badge={
        <div className="mx-auto w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center text-xl font-black mb-4 shadow-sm border border-indigo-100 select-none">
          SMS
        </div>
      }
      title="販売管理システム"
      description="ログインして販売管理システムを利用してください"
    >
      <MessageBanner error={error ? `⚠️ ${error}` : undefined} />

      <div className="space-y-3.5">
        <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs sm:text-[11px] font-bold">
          <button
            type="button"
            onClick={() => setLoginMode("email")}
            className={modeButtonClass("email")}
          >
            メールアドレスでログイン
          </button>
          <button
            type="button"
            onClick={() => setLoginMode("employeeNumber")}
            className={modeButtonClass("employeeNumber")}
          >
            従業員番号でログイン
          </button>
        </div>

        {loginMode === "email" ? (
          <PublicField label="メールアドレス">
            <input
              type="email"
              required
              className={publicInputClass}
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </PublicField>
        ) : (
          <PublicField label="従業員番号">
            <input
              type="text"
              required
              className={publicInputClass}
              placeholder="EMP-0001"
              value={employeeNumber}
              onChange={(e) => setEmployeeNumber(e.target.value)}
            />
          </PublicField>
        )}

        <PublicField label="アクセスパスワード">
          <input
            type="password"
            required
            className={publicInputClass}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </PublicField>

        <div className="text-right px-1">
          <button
            type="button"
            onClick={() => {
              console.log("パスワード再設定画面へ遷移します");
              router.push("/forgot-password");
            }}
            className="text-xs sm:text-[11px] text-indigo-700 font-bold hover:underline cursor-pointer select-none inline-block py-2 sm:py-1"
          >
            パスワードをお忘れですか？
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className={publicButtonClass.primary}
      >
        {loading ? "セキュリティ検証中..." : "システムへログイン"}
      </button>

      <div className="text-center pt-2">
        <span className="text-[10px] text-slate-600 font-mono">
          &copy; {new Date().getFullYear()} Sales Management System Workshop
        </span>
      </div>
    </PublicCard>
  );
}
