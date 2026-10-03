"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePermissionContext } from "../../context/permissioncontext";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusBadge } from "../../_shared/ui/StatusBadge";
import { WorkflowHistoryTask } from "../../workflow/histories/_types";

const DASHBOARD_LIMIT = 10;

interface HistoryPageResponse {
  data: WorkflowHistoryTask[];
  pagination: { total: number };
}

// 承認ワークフロー上のステータス表示(申請履歴画面の「要対応」タブに出る2状態が中心)
const STATUS_DISPLAY: Record<string, { label: string; tone: "amber" | "orange" | "emerald" | "sky" }> = {
  PENDING: { label: "承認待ち", tone: "amber" },
  REMANDED: { label: "差戻し(要修正)", tone: "orange" },
  APPROVED: { label: "承認済み", tone: "emerald" },
  CANCELED: { label: "取下げ", tone: "sky" },
};

function MyApplicationsBody({ userId }: { userId: string }) {
  const [items, setItems] = useState<WorkflowHistoryTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        // 申請履歴画面の「要対応」タブ(ACTIVE_TASKS = 承認待ち・差戻し)を、申請者=自分で取得する
        const params = new URLSearchParams({
          userId,
          applicantId: userId,
          status: "ACTIVE_TASKS",
          page: "1",
          limit: String(DASHBOARD_LIMIT),
        });
        const res = await apiFetch<HistoryPageResponse>(`/api/workflow-tasks/history?${params.toString()}`);
        setItems(res.data);
        setTotal(res.pagination.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "申請状況の取得に失敗しました");
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
              <th className="px-3 py-2 text-left sticky top-0 bg-slate-100">状態</th>
              <th className="px-3 py-2 text-left sticky top-0 bg-slate-100">承認ステップ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-700">
                  承認待ち・差戻し中のあなたの申請はありません
                </td>
              </tr>
            )}
            {items.map((item) => {
              const spec = STATUS_DISPLAY[item.status] ?? { label: item.status, tone: "sky" as const };
              return (
                <tr key={item.logId}>
                  <td className="px-3 py-1.5 font-semibold">
                    <Link href="/workflow/histories" className="text-indigo-800 underline hover:text-indigo-950">
                      {item.targetName}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">{item.requestType}</td>
                  <td className="px-3 py-1.5">
                    <StatusBadge label={spec.label} tone={spec.tone} />
                  </td>
                  <td className="px-3 py-1.5">第{item.layer}承認</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total > items.length && (
        <p className="text-xs text-slate-700">
          全{total}件のうち、{items.length}件を表示しています。残りは申請履歴・進捗一覧画面で確認できます。
        </p>
      )}
    </div>
  );
}

// ログインユーザー自身が申請した案件のうち、承認待ち・差戻し中のもの(申請履歴画面の「要対応」と同じ集計)。
// 申請履歴・進捗一覧画面の閲覧権限がある場合のみ表示する
export function MyApplicationsSection() {
  const { user } = usePermissionContext();
  if (!user?.id) return null;

  const canReadHistories =
    user.roleId === "admin" ||
    user.permissions.includes("wf_histories:read") ||
    user.permissions.includes("wf_histories:menu");
  if (!canReadHistories) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-800">📋 あなたの申請(承認待ち・差戻し)</h2>
        <Link href="/workflow/histories" className="text-xs font-semibold text-indigo-800 underline hover:text-indigo-950">
          申請履歴・進捗一覧で詳しく見る →
        </Link>
      </div>
      <MyApplicationsBody userId={user.id} />
    </div>
  );
}
