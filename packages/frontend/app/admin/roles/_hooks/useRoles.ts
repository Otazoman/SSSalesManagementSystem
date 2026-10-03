import { useState, useCallback } from "react";
import { RoleRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";

export function useRoles(canRead: boolean, loadingPermission: boolean) {
  const { paginationEnabled } = usePaginationSetting();

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleCatchError = useCallback((err: unknown) => {
    console.error(err);
    if (err instanceof Error) {
      setError(err.message);
    } else {
      setError(
        "予期せぬエラーが発生しました。時間をおいて再度お試しください。",
      );
    }
  }, []);

  const {
    items: roles,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncRolesData,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<RoleRecord>("/api/roles", {
    paginationEnabled,
    enabled: canRead && !loadingPermission,
  });

  const createRole = async (id: string, name: string, description: string) => {
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await apiFetch("/api/roles/register", {
        method: "POST",
        json: { id, name, description },
        defaultErrorMessage: "登録に失敗しました",
      });

      setMessage("新しい業務ロールを作成しました");
      await syncRolesData();
    } catch (err) {
      handleCatchError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateRole = async (id: string, name: string, description: string) => {
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/roles/${id}`, {
        method: "PUT",
        json: { name, description },
        defaultErrorMessage: "更新に失敗しました",
      });

      setMessage("業務ロール情報を更新しました");
      setEditingId(null);
      await syncRolesData();
    } catch (err) {
      handleCatchError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteRole = async (id: string) => {
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/roles/${id}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });

      setMessage("業務ロールを削除しました");
      await syncRolesData();
    } catch (err) {
      handleCatchError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { download } = useCsvDownload({
    fileNamePrefix: "roles_export",
    onError: handleCatchError,
  });
  const downloadCsv = async () => {
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await download("/api/roles/csv-download");
      setMessage("CSVファイルをダウンロードしました");
    } finally {
      setIsSubmitting(false);
    }
  };

  const importCsv = async (file: File) => {
    setError("");
    setMessage("");
    setIsSubmitting(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const data = await apiFetch<{ message: string }>(
        "/api/roles/bulk-register",
        { method: "POST", body: formData },
      );
      setMessage(data.message || "CSVインポートが完了しました");
      await syncRolesData();
    } catch (err) {
      handleCatchError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    roles,
    message,
    error,
    isSubmitting,
    editingId,
    setEditingId,
    setError,
    setMessage,
    createRole,
    updateRole,
    deleteRole,
    downloadCsv,
    importCsv,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  };
}
