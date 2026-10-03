import { useState } from "react";
import { Button } from "../../_shared/ui/Button";

interface NotificationSettingsFormProps {
  initialSlackUserId: string | null;
  initialNotificationChannel: "email" | "slack";
}

export function NotificationSettingsForm({
  initialSlackUserId,
  initialNotificationChannel,
}: NotificationSettingsFormProps) {
  const [slackUserId, setSlackUserId] = useState(initialSlackUserId || "");
  const [notificationChannel, setNotificationChannel] = useState<
    "email" | "slack"
  >(initialNotificationChannel);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (notificationChannel === "slack" && !slackUserId.trim()) {
      setError(
        "通知方法を「Slack」にする場合はSlackメンバーIDの入力が必要です",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/profile/notification-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slackUserId: slackUserId.trim() || null,
          notificationChannel,
        }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "通知設定の更新に失敗しました");
      }

      setMessage("通知設定を更新しました");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "予期せぬエラーが発生しました",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white p-6 rounded-xl border border-slate-200 space-y-4 shadow-sm"
    >
      <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-1">
        通知設定
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
        <label className="block text-xs font-semibold text-slate-600 mb-1">
          承認依頼などの通知方法
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="radio"
              name="notificationChannel"
              value="email"
              checked={notificationChannel === "email"}
              onChange={() => setNotificationChannel("email")}
            />
            メール
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="radio"
              name="notificationChannel"
              value="slack"
              checked={notificationChannel === "slack"}
              onChange={() => setNotificationChannel("slack")}
            />
            Slack
          </label>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">
          SlackメンバーID
        </label>
        <input
          type="text"
          className="w-full border border-slate-300 p-2 text-sm bg-white text-slate-900 rounded focus:border-indigo-500 focus:outline-none"
          placeholder="例: U012AB3CD(Slackプロフィールの「メンバーIDをコピー」で取得)"
          value={slackUserId}
          onChange={(e) => setSlackUserId(e.target.value)}
        />
        <p className="text-[11px] text-slate-600 mt-1">
          通知方法を「Slack」にしていても、ここが未設定の場合は自動的にメールで通知されます。
        </p>
      </div>

      <Button className="w-full" type="submit" disabled={isSubmitting}>
        通知設定を保存する
      </Button>
    </form>
  );
}
