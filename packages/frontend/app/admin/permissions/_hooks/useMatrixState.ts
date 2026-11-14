"use client";

import { useState, useEffect, useCallback } from "react";
import {
  PermissionRecord,
  RoleRecord,
  ScreenOption,
  STANDARD_ACTIONS,
} from "../_types";
import { apiFetch, apiFetchShared, clearSharedApiCache } from "../../../_shared/hooks/use-api-fetch";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UseMatrixStateProps {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  loading: boolean;
}

export function useMatrixState({
  canRead,
  canCreate,
  canUpdate,
  loading,
}: UseMatrixStateProps) {
  const confirm = useConfirm();
  // マスタデータState
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [screenOptions, setScreenOptions] = useState<ScreenOption[]>([]);

  // 操作State
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [checkedPermissionIds, setCheckedPermissionIds] = useState<string[]>(
    [],
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // テンプレート用State
  const [copiedTemplatePerms, setCopiedTemplatePerms] = useState<
    string[] | null
  >(null);
  const [copiedRoleName, setCopiedRoleName] = useState("");

  // マスタデータの自動同期・取得
  const syncMasterData = useCallback(async () => {
    try {
      const [fetchedPermissionsInit, fetchedRoles, fetchedScreens] =
        await Promise.all([
          apiFetch<PermissionRecord[]>("/api/permissions").catch(() => []),
          apiFetch<RoleRecord[]>("/api/roles").catch(() => []),
          apiFetchShared<ScreenOption[]>("/api/permissions/screens").catch(
            () => [],
          ),
        ]);

      let fetchedPermissions = fetchedPermissionsInit;

      const missingBasicItems: any[] = [];
      fetchedScreens.forEach((screen) => {
        STANDARD_ACTIONS.forEach((act) => {
          const targetId = `${screen.resource}:${act.key}`.toLowerCase();
          const isExist = fetchedPermissions.some((p) => p.id === targetId);

          if (!isExist) {
            missingBasicItems.push({
              id: targetId,
              resource: screen.resource,
              action: act.key,
              name: `${screen.name} [${act.label}]`,
              description: `${screen.name}画面における${act.label}標準権限(自動初期展開)`,
            });
          }
        });
      });

      if (missingBasicItems.length > 0 && canUpdate) {
        try {
          await apiFetch("/api/permissions/bulk", {
            method: "POST",
            json: { items: missingBasicItems },
          });
          fetchedPermissions = await apiFetch<PermissionRecord[]>(
            "/api/permissions",
          );
        } catch (err) {
          console.error("標準権限の自動展開に失敗しました", err);
        }
      }

      setPermissions(fetchedPermissions);
      setRoles(fetchedRoles);
      setScreenOptions(fetchedScreens);

      if (fetchedRoles.length > 0 && !selectedRoleId) {
        const defaultRole = fetchedRoles.find((r) => r.id !== "admin");
        setSelectedRoleId(defaultRole ? defaultRole.id : fetchedRoles[0].id);
      }
    } catch (err) {
      console.error("マスタデータの自動同期・取得に失敗しました", err);
    }
  }, [selectedRoleId, canUpdate]);

  useEffect(() => {
    if (!loading && canRead) void syncMasterData();
  }, [syncMasterData, loading, canRead]);

  // ロール固有の権限ロード
  const fetchRolePermissions = useCallback(async () => {
    if (!selectedRoleId) return;
    try {
      const data = await apiFetch<string[]>(
        `/api/permissions/role/${selectedRoleId}`,
      );
      setCheckedPermissionIds(data);
    } catch (err) {
      console.error("ロール権限のロードに失敗しました", err);
    }
  }, [selectedRoleId]);

  useEffect(() => {
    if (!loading && canRead) void fetchRolePermissions();
  }, [fetchRolePermissions, loading, canRead]);

  // マトリクスの個別チェック変更
  const handleMatrixCheckChange = (permissionId: string) => {
    if (!canUpdate) return;
    setCheckedPermissionIds((prev) =>
      prev.includes(permissionId)
        ? prev.filter((id) => id !== permissionId)
        : [...prev, permissionId],
    );
  };

  // BUG-082: 一括操作は「すべてON」「すべてOFF」を明示して指定する(現在の状態で切り替えない)。
  // 画面のチェック状態を変えるだけで、保存ボタンを押すまで確定しない
  const setPermissionIds = (targetIds: string[], enabled: boolean) => {
    if (!canUpdate || targetIds.length === 0) return;
    if (enabled) {
      setCheckedPermissionIds((prev) => Array.from(new Set([...prev, ...targetIds])));
    } else {
      setCheckedPermissionIds((prev) => prev.filter((id) => !targetIds.includes(id)));
    }
  };

  // 縦一列一括(アクション単位・すべての画面)
  const handleSetColumnPermissions = (actionKey: string, enabled: boolean) => {
    setPermissionIds(
      permissions.filter((p) => p.action === actionKey).map((p) => p.id),
      enabled,
    );
  };

  // 横一行一括(画面単位・すべてのアクション)
  const handleSetRowPermissions = (resourceKey: string, enabled: boolean) => {
    setPermissionIds(
      permissions.filter((p) => p.resource === resourceKey).map((p) => p.id),
      enabled,
    );
  };

  // ロールへのマッピング保存
  const handleSaveRoleMapping = async () => {
    if (!canUpdate) {
      setError("権限マトリクスを保存する権限がありません");
      return;
    }
    setError("");
    setMessage("");
    setIsSaving(true);
    try {
      await apiFetch(`/api/permissions/role/${selectedRoleId}`, {
        method: "PUT",
        json: { permissionIds: checkedPermissionIds },
        defaultErrorMessage: "権限マトリクスの更新に失敗しました",
      });
      // PERF-06: 権限から決まるプロフィール・メニューを取り直すようにする
      clearSharedApiCache();

      const roleName =
        roles.find((r) => r.id === selectedRoleId)?.name || "対象ロール";
      setMessage(
        `ロール「${roleName}」の権限マトリクスを保存し、認可KVキャッシュを即時更新しました。💾`,
      );
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // テンプレートコピー・ペースト
  const handleCopyAsTemplate = () => {
    if (!canUpdate) return;
    const currentRoleName =
      roles.find((r) => r.id === selectedRoleId)?.name || "選択中ロール";
    setCopiedTemplatePerms([...checkedPermissionIds]);
    setCopiedRoleName(currentRoleName);
    setMessage(
      `ロール「${currentRoleName}」のチェック状態をコピーしました。📋`,
    );
    setError("");
  };

  const handlePasteTemplate = () => {
    if (!canUpdate || !copiedTemplatePerms) return;
    setCheckedPermissionIds([...copiedTemplatePerms]);
    setMessage(
      `保持していた「${copiedRoleName}」のひな型をロードしました。保存するまで変更は確定されません。`,
    );
    setError("");
  };

  // CSVダウンロード
  const { download } = useCsvDownload({
    fileNamePrefix: "role_permissions_export",
    onError: setError,
  });
  const downloadCsv = async () => {
    setError("");
    setMessage("");
    await download("/api/permissions/csv-download");
    setMessage("権限マトリクスCSVをダウンロードしました");
  };

  // CSVインポート（ロール単位で全上書きされるため確認ダイアログを挟む）
  const importCsv = async (file: File) => {
    if (!canCreate) {
      setError("CSVインポートを実行する権限がありません");
      return;
    }
    if (
      !(await confirm(
        "この内容でロールの権限マトリクスを全上書きします。よろしいですか？",
      ))
    ) {
      return;
    }

    setError("");
    setMessage("");
    setIsSaving(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const data = await apiFetch<{ message: string }>(
        "/api/permissions/bulk-register",
        { method: "POST", body: formData },
      );
      setMessage(data.message || "CSVインポートが完了しました");
      clearSharedApiCache();
      void syncMasterData();
      void fetchRolePermissions();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return {
    permissions,
    roles,
    screenOptions,
    selectedRoleId,
    checkedPermissionIds,
    message,
    error,
    isSaving,
    copiedRoleName,
    hasCopiedTemplate: !!copiedTemplatePerms,
    setSelectedRoleId,
    handleMatrixCheckChange,
    handleSetColumnPermissions,
    handleSetRowPermissions,
    handleSaveRoleMapping,
    handleCopyAsTemplate,
    handlePasteTemplate,
    downloadCsv,
    importCsv,
    setMessage,
    setError,
  };
}
