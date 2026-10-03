import { useForgotPassword } from "../_hooks/useForgotPassword";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import {
  PublicCard,
  PublicField,
  publicButtonClass,
  publicInputClass,
} from "../../_shared/ui/PublicCard";

export function ForgotPasswordForm() {
  const {
    email,
    setEmail,
    error,
    message,
    loading,
    handleRequestReset,
    router,
  } = useForgotPassword();

  return (
    <PublicCard
      onSubmit={handleRequestReset}
      title="🔑 パスワードの再設定"
      description="登録されているメールアドレス宛に、パスワード再設定リンクをお送りします。"
    >
      <MessageBanner
        error={error ? `⚠️ ${error}` : undefined}
        message={message ? `✅ ${message}` : undefined}
      />

      <PublicField label="登録メールアドレス">
        <input
          type="email"
          required
          className={publicInputClass}
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </PublicField>

      <button
        type="submit"
        disabled={loading}
        className={publicButtonClass.primary}
      >
        {loading ? "配信リクエスト送信中..." : "再設定メールを送信する"}
      </button>

      <div className="text-center pt-2">
        <button
          type="button"
          onClick={() => router.push("/login")}
          className={publicButtonClass.text}
        >
          ログイン画面へ戻る
        </button>
      </div>
    </PublicCard>
  );
}
