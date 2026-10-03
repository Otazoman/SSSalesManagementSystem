"use client";

import Link from "next/link";
import { usePermissionContext } from "../../context/permissioncontext";
import { useProgress } from "../../progress/_hooks/useProgress";
import { ProgressTable } from "../../progress/_components/ProgressTable";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { MessageBanner } from "../../_shared/ui/MessageBanner";

const DASHBOARD_LIMIT = 10;

function MyProgressBody({ employeeNumber }: { employeeNumber: string }) {
  const { rows, hasMore, loading, error } = useProgress(true, {
    fixedEmployeeNumber: employeeNumber,
    defaultLimit: DASHBOARD_LIMIT,
  });

  return (
    <div className="space-y-3">
      <MessageBanner error={error} />
      {loading ? <LoadingGate label="読み込み中..." /> : <ProgressTable rows={rows} />}
      {!loading && hasMore && (
        <p className="text-xs text-slate-700">
          進行中の案件を新しい順に{rows.length}件表示しています。続きは進捗確認画面で確認できます。
        </p>
      )}
    </div>
  );
}

// 進捗確認(/progress)の検索結果のうち、ログインユーザー自身が担当の案件(起点伝票の営業担当/購買担当/
// 入力担当者/申請者が自分)だけを表示する。進捗確認画面の閲覧権限がある場合のみ表示する
export function MyProgressSection() {
  const { user } = usePermissionContext();
  if (!user) return null;

  const canReadProgress =
    user.roleId === "admin" ||
    user.permissions.includes("progress_overview:read") ||
    user.permissions.includes("progress_overview:menu");
  if (!canReadProgress || !user.employeeNumber) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-800">🧭 あなたの担当分の進捗</h2>
        <Link href="/progress" className="text-xs font-semibold text-indigo-800 underline hover:text-indigo-950">
          進捗確認画面で条件を指定して見る →
        </Link>
      </div>
      <MyProgressBody employeeNumber={user.employeeNumber} />
    </div>
  );
}
