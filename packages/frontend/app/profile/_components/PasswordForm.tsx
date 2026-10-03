import { useState } from "react";
import { Button } from "../../_shared/ui/Button";
import { usePasswordPolicyDescription } from "../../_shared/hooks/use-password-policy-description";

interface PasswordFormProps {
  userId: string;
}

export function PasswordForm({ userId }: PasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const passwordPolicy = usePasswordPolicyDescription();

  const handleChangePassword = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmNewPassword) {
      setError("新しいパスワードと確認用パスワードが一致しません");
      return;
    }

    try {
      const res = await fetch("/api/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, currentPassword, newPassword }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "パスワードの変更に失敗しました");
      }

      setMessage("パスワードを正常に更新しました");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("予期せぬエラーが発生しました");
      }
    }
  };

  return (
    <form
      onSubmit={handleChangePassword}
      className="bg-white p-6 rounded-xl border border-slate-200 space-y-4 shadow-sm"
    >
      <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-1">
        セキュリティ・パスワードの変更
      </h3>
      {message && (
        <div className="p-3 bg-green-50 text-green-700 text-xs rounded font-medium border border-green-100">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 text-red-700 text-xs rounded font-medium border border-red-100">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-slate-800 mb-1">
          現在のパスワード
        </label>
        <input
          type="password"
          required
          className="w-full border border-slate-300 p-2 text-sm bg-white text-slate-900 placeholder-slate-500 rounded focus:border-indigo-500 focus:outline-none"
          placeholder="••••••••"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-800 mb-1">
          新しいパスワード
        </label>
        <input
          type="password"
          required
          className="w-full border border-slate-300 p-2 text-sm bg-white text-slate-900 placeholder-slate-500 rounded focus:border-indigo-500 focus:outline-none"
          placeholder="••••••••"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        {passwordPolicy && (
          <p className="mt-1 text-[11px] text-slate-600">{passwordPolicy}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-800 mb-1">
          新しいパスワード(確認用)
        </label>
        <input
          type="password"
          required
          className="w-full border border-slate-300 p-2 text-sm bg-white text-slate-900 placeholder-slate-500 rounded focus:border-indigo-500 focus:outline-none"
          placeholder="••••••••"
          value={confirmNewPassword}
          onChange={(e) => setConfirmNewPassword(e.target.value)}
        />
      </div>

      <Button className="w-full" type="submit">
        パスワードを更新する
      </Button>
    </form>
  );
}
