"use client";

import { useEffect, useState } from "react";
import { Modal } from "../../../_shared/ui/Modal";
import { Button } from "../../../_shared/ui/Button";
import { FormField, formFieldInputClass } from "../../../_shared/ui/FormField";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { ScreenRecord } from "../_types";

interface PreviewUser {
  id: string;
  name: string;
}

interface PreviewStepResult {
  stepOrder: number;
  stepName: string | null;
  approverRoleId: string;
  roleName: string | null;
  approverNames: string[];
  autoPassed: boolean;
}

interface PreviewResult {
  matched: boolean;
  message: string;
  flowName?: string;
  matchReason?: string;
  steps?: PreviewStepResult[];
}

interface RoutePreviewModalProps {
  /** 承認フロー定義で使う書類種別一覧(useApprovalFlowのscreensをそのまま渡す) */
  screens: ScreenRecord[];
  onClose: () => void;
}

/**
 * 新規要望: 承認フローの申請経路プレビュー(2026-09-22確定)。
 * ユーザー・書類種別・仮の金額を指定すると、そのユーザーが実際に申請した場合にどの承認フロー
 * (経路)を通るかをread-onlyでシミュレーションする(GET /api/approval-flows/preview-route)。
 * 一覧から選ぶだけの参照専用モーダルのため、DiscardGuard(warnOnDiscard)の対象外。
 */
export function RoutePreviewModal({ screens, onClose }: RoutePreviewModalProps) {
  const [users, setUsers] = useState<PreviewUser[]>([]);
  const [userId, setUserId] = useState("");
  const [targetType, setTargetType] = useState(screens[0]?.resource ?? "");
  const [amount, setAmount] = useState("0");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<PreviewUser[]>("/api/users")
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setUsers(list);
        if (list.length > 0) setUserId((prev) => prev || list[0].id);
      })
      .catch(() => setUsers([]));
  }, []);

  const handlePreview = async () => {
    setError("");
    setResult(null);
    if (!userId || !targetType) {
      setError("ユーザーと書類種別を選択してください");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        userId,
        targetType,
        amount: String(Number(amount) || 0),
      });
      const data = await apiFetch<PreviewResult>(
        `/api/approval-flows/preview-route?${params.toString()}`,
        { defaultErrorMessage: "申請経路のプレビューに失敗しました" },
      );
      setResult(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "申請経路のプレビューに失敗しました",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="🔍 申請経路プレビュー" onClose={onClose} size="lg">
      <p className="text-xs text-slate-600">
        ユーザー・書類種別・仮の金額を指定すると、そのユーザーが実際に申請した場合に通る承認フロー(経路)をシミュレーションします。申請データは作成されません。
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="ユーザー" required>
          <select
            className={formFieldInputClass}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            {users.length === 0 && <option value="">(ユーザーがいません)</option>}
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="書類種別" required>
          <select
            className={formFieldInputClass}
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
          >
            {screens.length === 0 && <option value="">(書類種別がありません)</option>}
            {screens.map((s) => (
              <option key={s.resource} value={s.resource}>
                {s.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="仮の金額(円)" required>
          <input
            type="number"
            min={0}
            className={formFieldInputClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
      </div>

      <div>
        <Button variant="primary" size="sm" onClick={handlePreview} disabled={loading}>
          {loading ? "シミュレーション中..." : "経路をシミュレーションする"}
        </Button>
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-700">
          {error}
        </p>
      )}

      {result && !result.matched && (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs font-bold text-amber-800">
          {result.message}
        </p>
      )}

      {result && result.matched && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold text-slate-800">
            採用フロー: <span className="text-indigo-700">{result.flowName}</span>
          </p>
          <p className="text-[11px] text-slate-700">{result.matchReason}</p>
          <ol className="space-y-2">
            {result.steps?.map((step) => (
              <li
                key={step.stepOrder}
                className="rounded border border-slate-200 bg-white p-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">
                    {step.stepOrder}. {step.stepName || step.roleName || step.approverRoleId}
                  </span>
                  {step.autoPassed && (
                    <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      申請時に自動通過
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-700">
                  承認者ロール: {step.roleName || step.approverRoleId}
                </p>
                <p className="text-[11px] text-slate-700">
                  承認候補者:{" "}
                  {step.approverNames.length > 0
                    ? step.approverNames.join("、")
                    : "該当者なし"}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}
