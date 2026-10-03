import { useState, useEffect } from "react";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";

export interface WorkflowUserRelation {
  roleId: string;
  departmentSurrogateId?: string | null;
  departmentId?: string | null;
}

export interface WorkflowUserMasterEntry {
  id: string;
  name: string;
  relations?: WorkflowUserRelation[];
}

export interface WorkflowScreenEntry {
  resource: string;
  name: string;
  path?: string;
}

/**
 * 申請履歴・承認タスク両画面で共通して必要な「画面マスタ(targetType→日本語名/編集画面パス)」
 * 「ユーザーマスタ(承認候補者の解決用)」の取得と、それを使った変換関数群をまとめた共有hook。
 * 以前はhistories/page.tsxにのみ実装されていたロジックを、tasks画面でも承認フロー進捗
 * (WorkflowTimeline)を表示できるようにする際に共通化した。
 */
export function useWorkflowScreensAndUsers(enabled: boolean) {
  const [screens, setScreens] = useState<WorkflowScreenEntry[]>([]);
  const [userMaster, setUserMaster] = useState<WorkflowUserMasterEntry[]>([]);

  useEffect(() => {
    if (!enabled) return;
    async function loadMasters() {
      try {
        const [resScreens, resUsers] = await Promise.all([
          apiFetch<WorkflowScreenEntry[]>("/api/permissions/screens"),
          apiFetch<WorkflowUserMasterEntry[]>("/api/users"),
        ]);
        setScreens(resScreens);
        setUserMaster(resUsers);
      } catch (err) {
        console.error("マスタデータの同期に失敗しました", err);
      }
    }
    void loadMasters();
  }, [enabled]);

  const getTargetTypeJapanese = (targetType: string) => {
    const matched = screens.find(
      (s) => s.resource.toLowerCase() === targetType.toLowerCase(),
    );
    return matched ? matched.name : targetType;
  };

  // 💡 targetType+targetIdから、対応する編集画面のパスを解決する(差戻し履歴からの
  // 「修正して再提出」ボタンで使う)。画面構成再編フェーズ5: 1つのtargetTypeが複数の画面に
  // 分散しているケース(入出庫/出荷指示・入荷指示)ではDB参照による動的解決が必要なため、
  // バックエンドの一元的な解決API(screens.tsの静的マッピングへのフォールバックも含む)を呼ぶ。
  const resolveTargetTypeEditPath = async (
    targetType: string,
    targetId: string,
  ): Promise<string | null> => {
    try {
      const result = await apiFetch<{ path: string | null }>(
        `/api/workflow-tasks/edit-path/${encodeURIComponent(targetId)}?targetType=${encodeURIComponent(targetType)}`,
      );
      return result.path;
    } catch {
      return null;
    }
  };

  const getEligibleApprovers = (
    roleId: string,
    departmentId?: string | null,
    applicantDepartmentId?: string | null,
  ) => {
    // 💡 引数に値があるかないかで、判定基準にする部署IDを明確に切り分ける。
    // departmentIdが明示的に送られてきている場合はそれを最優先し、無い場合は申請者の部署(自部署)を使う
    const targetDeptId = departmentId ? departmentId : applicantDepartmentId;

    const eligibleUsers = userMaster.filter((u) =>
      u.relations?.some((rel) => {
        const matchesRole = rel.roleId === roleId;
        const currentDeptId = rel.departmentSurrogateId || rel.departmentId;
        const matchesDept = targetDeptId
          ? currentDeptId === targetDeptId
          : true;
        return matchesRole && matchesDept;
      }),
    );

    return eligibleUsers.length === 0
      ? "該当者なし"
      : eligibleUsers.map((u) => u.name).join(", ");
  };

  return {
    screens,
    userMaster,
    getTargetTypeJapanese,
    resolveTargetTypeEditPath,
    getEligibleApprovers,
  };
}
