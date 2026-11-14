import { useEffect, useState } from "react";
import { ProjectRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../../_shared/hooks/use-csv-import";
import { useConfirm } from "../../../_shared/hooks/use-confirm";
import type { ApplicantDepartmentOption } from "../../../types";

interface UseProjectsProps {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  loading: boolean;
  // BUG-097: 会社設定のプロジェクトの承認(ON の時は単位マスタと同じ「仮登録 → 申請 → 承認で有効」)
  isProjectWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
}

// J-2-e(2026-09-13ユーザー確認済み): プロジェクトマスタ。
// BUG-097: 承認 OFF の間は今まで通り active/suspended の2状態。ON の時は、新規登録は仮登録(temporary)で保存して申請し、
// 変更は今の行を temporary にロックしてから変更後の内容で申請する(単位マスタ useUnitApi.ts と同じ二段階方式)
export function useProjects({
  canRead,
  canCreate,
  canUpdate,
  canDelete,
  loading,
  isProjectWfEnabled = false,
  departments = [],
}: UseProjectsProps) {
  const confirm = useConfirm();
  const { paginationEnabled } = usePaginationSetting();

  const [editingProject, setEditingProject] = useState<ProjectRecord | null>(null);
  const [searchId, setSearchId] = useState("");
  const [searchName, setSearchName] = useState("");
  const [searchStatus, setSearchStatus] = useState("active");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // BUG-097: 申請部門(複数の部門に所属する時に選ぶ。選ぶまでは所属部門の先頭。単位マスタと同じ)
  const [selectedDepartmentId, setApplicantDepartmentSurrogateId] = useState<string | null>(null);
  const applicantDepartmentSurrogateId = selectedDepartmentId ?? departments[0]?.surrogateId ?? null;

  // BUG-097: 編集中のプロジェクトの最新の申請の状態。承認待ち(PENDING)の間は編集できない(単位マスタと同じロック)。
  // 取得した状態はプロジェクトのコードと一緒に持ち、編集中のプロジェクトのものだけを使う
  const [fetchedWfStatus, setFetchedWfStatus] = useState<{ id: string; status: string } | null>(null);
  const editingId = editingProject?.id ?? null;
  useEffect(() => {
    if (!editingId || !isProjectWfEnabled) return;
    void apiFetch<{ status: string }>(
      `/api/workflow-tasks/request-status/${encodeURIComponent(editingId)}?targetType=master_projects`,
    )
      .then((data) => setFetchedWfStatus({ id: editingId, status: data.status }))
      .catch((err) => console.error("最新の申請状態の取得に失敗しました", err));
  }, [editingId, isProjectWfEnabled]);
  const wfStatus =
    isProjectWfEnabled && editingProject && fetchedWfStatus?.id === editingProject.id ? fetchedWfStatus.status : null;
  const isProjectCurrentlyLocked =
    !!editingProject && isProjectWfEnabled && editingProject.status === "temporary" && wfStatus === "PENDING";

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

  // 保存に成功したら true を返す
  const handleSubmit = async (formData: {
    id: string;
    name: string;
    memo: string;
    startDate: string;
    endDate: string;
  }): Promise<boolean> => {
    if (isSubmitting) return false;
    setError("");
    setMessage("");

    if (!editingProject && !canCreate) {
      setError("登録する権限がありません");
      return false;
    }
    if (editingProject && !canUpdate) {
      setError("更新する権限がありません");
      return false;
    }
    if (isProjectCurrentlyLocked) {
      setError("承認待ちのため変更できません");
      return false;
    }

    const payload = {
      name: formData.name.trim(),
      memo: formData.memo || null,
      startDate: formData.startDate || null,
      endDate: formData.endDate || null,
    };

    setIsSubmitting(true);
    try {
      if (isProjectWfEnabled) {
        // BUG-097: まず本体へ書き込む。新規は仮登録(状態はサーバーが決める)。変更は、変更後の値を本体に書かず、
        // 今の内容のまま状態だけ temporary にしてロックする(変更後の内容は申請の退避データに持ち、承認で反映する)
        let targetId: string;
        if (editingProject) {
          await apiFetch(`/api/projects/${editingProject.id}`, {
            method: "PUT",
            json: {
              name: editingProject.name,
              memo: editingProject.memo ?? null,
              startDate: editingProject.startDate ?? null,
              endDate: editingProject.endDate ?? null,
              status: "temporary",
            },
            defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
          });
          targetId = editingProject.id;
        } else {
          const created = await apiFetch<{ id: string }>("/api/projects/register", {
            method: "POST",
            json: { id: formData.id.trim(), ...payload },
            defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
          });
          targetId = created.id;
        }
        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_projects",
            targetId,
            requestType: editingProject ? "UPDATE" : "REGISTER",
            payload: { id: targetId, ...payload, status: "active" },
            applicantDepartmentSurrogateId,
            comment: editingProject
              ? `プロジェクトマスタ[${targetId}] 情報変更申請`
              : `プロジェクトマスタ[${targetId}] 新規登録申請`,
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });
        setMessage(
          editingProject
            ? "プロジェクトの変更をワークフローへ申請しました(承認待ちロック)"
            : "プロジェクトを仮登録し、承認を申請しました(承認待ち)",
        );
      } else {
        const url = editingProject ? `/api/projects/${editingProject.id}` : "/api/projects/register";
        await apiFetch(url, {
          method: editingProject ? "PUT" : "POST",
          json: editingProject ? payload : { id: formData.id.trim(), ...payload },
        });
        setMessage(editingProject ? "プロジェクト情報を更新しました" : "新しいプロジェクトを登録しました");
      }

      setEditingProject(null);
      await syncProjects();
      return true;
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      return false;
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
    // BUG-097: 承認 ON の間は CSV で取り込めない(サーバーも拒否する。単位マスタと同じ)
    if (!canCreate || isSubmitting || isProjectWfEnabled) return;
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
    isProjectCurrentlyLocked,
    wfStatus,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
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
