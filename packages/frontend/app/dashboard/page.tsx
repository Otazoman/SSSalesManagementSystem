"use client";

import { AnnouncementsSection } from "./_components/AnnouncementsSection";
import { MyProgressSection } from "./_components/MyProgressSection";
import { MyPendingApprovalsSection } from "./_components/MyPendingApprovalsSection";
import { MyApplicationsSection } from "./_components/MyApplicationsSection";

// ダッシュボード(上から順に):
//  1. システムからのお知らせ(全ユーザー共通。登録は /admin/announcements)
//  2. あなたの承認待ち案件(自分が承認すべきもの)
//  3. あなたの申請(承認待ち・差戻し中)
//  4. あなたの担当分の進捗(進捗確認の検索結果のうち、自分が担当の案件)
// 2〜4は、対応する画面の閲覧権限がある場合のみ表示される
export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <AnnouncementsSection />
      <MyPendingApprovalsSection />
      <MyApplicationsSection />
      <MyProgressSection />
    </div>
  );
}
