import { useState } from "react";
import { ProjectRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../../_shared/hooks/use-csv-import";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UseProjectsProps {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  loading: boolean;
}

// J-2-e(2026-09-13ユーザー確認済み): プロジェクトマスタ。承認ワークフロー無しの
// 単純なactive/suspended 2状態のみ(accounts/locations等のtemporary仮登録フローは対象外)
export function useProjects({ canRead, canCreate, canUpdate, canDelete, loading }: UseProjectsProps) {
  const confirm = useConfirm();
  const { paginationEnabled } = usePaginationSetting();

  const [editingProject, setEditingProject] = useState<ProjectRecord | null>(null);
  const [searchId, setSearchId] = useState("");
  const [searchName, setSearchName] = useState("");
  const [searchStatus, setSearchStatus] = useState("active");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const searchParams = new URLSearchParams({
    id: searchId.trim(),
    name: searchName.trim(),
    status: searchStatus.trim(),
  });

  const {
    items: projects,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncProjects,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<ProjectRecord>(`/api/projects?${searchParams.toString()}`, {
    paginationEnabled,
    enabled: canRead && !loading,
  });

  const handleClearSearch = () => {
    setSearchId("");
    setSearchName("");
    setSearchStatus("active");
  };

  const handleSubmit = async (formData: {
    id: string;
    name: string;
    memo: string;
    startDate: string;
    endDate: string;
  }) => {
    if (isSubmitting) return;
    setError("");
    setMessage("");

    if (!editingProject && !canCreate) {
      setError("登録する権限がありません");
      return;
    }
    if (editingProject && !canUpdate) {
      setError("更新する権限がありません");
      return;
    }

    setIsSubmitting(true);
    try {
      const url = editingProject ? `/api/projects/${editingProject.id}` : "/api/projects/register";
      await apiFetch(url, {
        method: editingProject ? "PUT" : "POST",
        json: {
          id: formData.id.trim(),
          name: formData.name.trim(),
          memo: formData.memo || null,
          startDate: formData.startDate || null,
          endDate: formData.endDate || null,
        },
      });

      setMessage(editingProject ? "プロジェクト情報を更新しました" : "新しいプロジェクトを登録しました");
      setEditingProject(null);
      await syncProjects();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuspend = async (project: ProjectRecord) => {
    if (!canDelete || isSubmitting) return;
    if (!(await confirm(`プロジェクト [${project.id}: ${project.name}] を無効化しますか？`))) return;

    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/projects/${project.id}/suspend`, {
        method: "POST",
        defaultErrorMessage: "無効化に失敗しました",
      });
      setMessage("プロジェクトを無効化しました");
      if (editingProject?.id === project.id) setEditingProject(null);
      await syncProjects();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "projects_export",
    onError: () => setError("CSVダウンロードエラー"),
  });
  const handleDownloadCsv = async () => {
    const isCsvExportable = canCreate || canUpdate;
    if (!isCsvExportable || isSubmitting) return;
    await downloadCsv(`/api/projects/csv-download?${searchParams.toString()}`);
  };

  const { importCsv, importing } = useCsvImport({
    onSuccess: syncProjects,
    onMessage: setMessage,
    onError: setError,
  });
  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canCreate || isSubmitting) return;
    setError("");
    setMessage("");
    await importCsv("/api/projects/bulk-register", e);
  };

  const handleDelete = async (project: ProjectRecord) => {
    if (!canDelete || isSubmitting) return;
    if (!(await confirm(`プロジェクト [${project.id}: ${project.name}] を削除しますか？`))) return;

    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/projects/${project.id}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });
      setMessage("プロジェクトを削除しました");
      if (editingProject?.id === project.id) setEditingProject(null);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      await syncProjects();
      setIsSubmitting(false);
    }
  };

  return {
    projects,
    editingProject,
    setEditingProject,
    searchId,
    setSearchId,
    searchName,
    setSearchName,
    searchStatus,
    setSearchStatus,
    message,
    error,
    isSubmitting: isSubmitting || importing,
    handleClearSearch,
    handleSubmit,
    handleDownloadCsv,
    handleImportCsv,
    handleDelete,
    handleSuspend,
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
