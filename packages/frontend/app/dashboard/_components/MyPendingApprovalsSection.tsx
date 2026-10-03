"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePermissionContext } from "../../context/permissioncontext";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { WorkflowTask } from "../../workflow/tasks/_types";

const DASHBOARD_LIMIT = 10;

interface PendingResponse {
  data: WorkflowTask[];
  pagination: { total: number };
}

function PendingApprovalsBody({ userId }: { userId: string }) {
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        // page/limitを指定するとbackendは{data, pagination}形式で返す(会社設定のページング有無に依存しない)
        const res = await apiFetch<PendingResponse>(
          `/api/workflow-tasks/my-pending?userId=${encodeURIComponent(userId)}&page=1&limit=${DASHBOARD_LIMIT}`,
        );
        setTasks(res.data);
        setTotal(res.pagination.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "承認待ち案件の取得に失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <LoadingGate label="読み込み中..." />;

  return (
    <div className="space-y-2">
      <MessageBanner error={error} />
      <div className="overflow-auto max-h-80 border border-slate-200 rounded-lg bg-white">
        <table className="min-w-full text-xs text-slate-900">
          <thead className="bg-slate-100 text-slate-900">
            <tr>
              <th className="px-3 py-2 text-left sticky top-0 bg-slate-100">対象</th>
              <th className="px-3 py-2 text-left sticky top-0 bg-slate-100">申請種別</th>
              <th className="px-3 py-2 text-left sticky top-0 bg-slate-100">承認ステップ</th>
              <th className="px-3 py-2 text-left sticky top-0 bg-slate-100">申請者</th>
              <th className="px-3 py-2 text-left sticky top-0 bg-slate-100">申請日時</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-700">
                  承認待ちの案件はありません
                </td>
              </tr>
            )}
            {tasks.map((task) => (
              <tr key={task.logId}>
                <td className="px-3 py-1.5 font-semibold">
                  <Link href="/workflow/tasks" className="text-indigo-800 underline hover:text-indigo-950">
                    {task.targetName}
                  </Link>
                </td>
                <td className="px-3 py-1.5">{task.requestType}</td>
                <td className="px-3 py-1.5">第{task.layer}承認</td>
                <td className="px-3 py-1.5">{task.applicantId}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{new Date(task.createdAt).toLocaleString("ja-JP")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > tasks.length && (
        <p className="text-xs text-slate-700">
          全{total}件のうち、{tasks.length}件を表示しています。残りは承認タスク管理画面で確認できます。
        </p>
      )}
    </div>
  );
}

// ログインユーザー自身が承認すべき案件(承認タスク管理と同じ`my-pending`)の一覧。
// 承認タスク管理画面の閲覧権限がある場合のみ表示する。承認の実行は承認タスク管理画面で行う
export function MyPendingApprovalsSection() {
  const { user } = usePermissionContext();
  if (!user?.id) return null;

  const canReadTasks =
    user.roleId === "admin" ||
    user.permissions.includes("wf_tasks:read") ||
    user.permissions.includes("wf_tasks:menu");
  if (!canReadTasks) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-800">✅ あなたの承認待ち案件</h2>
        <Link href="/workflow/tasks" className="text-xs font-semibold text-indigo-800 underline hover:text-indigo-950">
          承認タスク管理で承認・差戻しする →
        </Link>
      </div>
      <PendingApprovalsBody userId={user.id} />
    </div>
  );
}
