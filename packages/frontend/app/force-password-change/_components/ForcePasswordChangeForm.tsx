import { useForcePasswordChange } from "../_hooks/useForcePasswordChange";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { usePasswordPolicyDescription } from "../../_shared/hooks/use-password-policy-description";
import {
  PublicCard,
  PublicField,
  publicButtonClass,
  publicInputClass,
} from "../../_shared/ui/PublicCard";

export function ForcePasswordChangeForm() {
  const {
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
  } = useForcePasswordChange();
  const passwordPolicy = usePasswordPolicyDescription();

  return (
    <PublicCard
      onSubmit={handleUpdatePassword}
      title="🔒 初回パスワードの変更義務"
      description={
        <span className="text-rose-700 font-semibold">
          【{userName}{" "}
          様】セキュリティ保護のため、初期パスワードからの変更が必要です。
        </span>
      }
    >
      <MessageBanner
        error={error ? `⚠️ ${error}` : undefined}
        message={message ? `✅ ${message}` : undefined}
      />

      <div className="space-y-3">
        <PublicField label="現在のパスワード(通知された初期パスワード)">
          <input
            type="password"
            required
            className={publicInputClass}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </PublicField>
        <PublicField label="新しいパスワード">
          <input
            type="password"
            required
            className={publicInputClass}
            placeholder="新しい安全なパスワード"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          {passwordPolicy && (
            <p className="mt-1 px-1 text-[11px] text-slate-600">{passwordPolicy}</p>
          )}
        </PublicField>
        <PublicField label="新しいパスワード(確認用入力)">
          <input
            type="password"
            required
            className={publicInputClass}
            placeholder="もう一度入力してください"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </PublicField>
      </div>

      <button
        type="submit"
        disabled={loading}
        className={publicButtonClass.primary}
      >
        {loading ? "更新処理を実行中..." : "パスワードを確定してログインへ戻る"}
      </button>
    </PublicCard>
  );
}
