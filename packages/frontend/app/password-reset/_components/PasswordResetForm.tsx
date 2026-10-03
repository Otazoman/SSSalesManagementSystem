import { usePasswordReset } from "../_hooks/usePasswordReset";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import {
  PublicCard,
  PublicField,
  publicButtonClass,
  publicInputClass,
} from "../../_shared/ui/PublicCard";

export function PasswordResetForm() {
  const {
    token,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    message,
    loading,
    handleResetSubmit,
  } = usePasswordReset();

  return (
    <PublicCard
      onSubmit={handleResetSubmit}
      title="🔄 新しいパスワードの設定"
      description="本人確認トークンを確認しました。新しいアクセスパスワードを入力してください。"
    >
      <MessageBanner
        error={error ? `⚠️ ${error}` : undefined}
        message={message ? `✅ ${message}` : undefined}
      />

      <div className="space-y-3">
        <PublicField label="新しいパスワード">
          <input
            type="password"
            required
            disabled={!token}
            className={publicInputClass}
            placeholder="新しいパスワード"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </PublicField>
        <PublicField label="新しいパスワード(確認入力)">
          <input
            type="password"
            required
            disabled={!token}
            className={publicInputClass}
            placeholder="もう一度入力"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </PublicField>
      </div>

      <button
        type="submit"
        disabled={loading || !token}
        className={publicButtonClass.primary}
      >
        {loading
          ? "パスワード上書き処理中..."
          : "この内容でパスワードを確定する"}
      </button>
    </PublicCard>
  );
}
