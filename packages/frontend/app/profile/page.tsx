"use client";

import { useUserProfile } from "./_hooks/useUserProfile";
import { PageHeader } from "../_shared/ui/PageHeader";
import { RelationList } from "./_components/RelationList";
import { PasswordForm } from "./_components/PasswordForm";
import { NotificationSettingsForm } from "./_components/NotificationSettingsForm";
import { DisplaySettingsForm } from "./_components/DisplaySettingsForm";

export default function ProfilePage() {
  const { userId, userRelations, slackUserId, notificationChannel, loading } =
    useUserProfile();

  return (
    <div className="max-w-xl w-full space-y-6">
      {/* 画面ヘッダー */}
      <PageHeader title="プロフィール設定" />

      {/* 所属組織・役職権限カード */}
      <RelationList loading={loading} userRelations={userRelations} />

      {/* 通知設定フォーム(承認依頼等をメール/Slackどちらで受け取るか) */}
      {!loading && (
        <NotificationSettingsForm
          initialSlackUserId={slackUserId}
          initialNotificationChannel={notificationChannel}
        />
      )}

      {/* 表示設定(ダークモード・基調色。ユーザーごとに保存) */}
      <DisplaySettingsForm />

      {/* パスワード変更フォーム */}
      <PasswordForm userId={userId} />
    </div>
  );
}
