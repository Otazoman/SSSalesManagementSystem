import { useState, useEffect } from "react";
import { AccountRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../../_shared/hooks/use-csv-import";
import type { ApplicantDepartmentOption } from "../../../types";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UseAccountsProps {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isAccountWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  loading: boolean;
}

export function useAccounts({
  canRead,
  canCreate,
  canUpdate,
  canDelete,
  isAccountWfEnabled = false,
  departments = [],
  loading,
}: UseAccountsProps) {
  const confirm = useConfirm();
  const { paginationEnabled } = usePaginationSetting();
  // 追加要望F: 複数部門所属時の申請部門選択(初期値は所属部門の先頭=従来の暗黙動作と同じ)。
  // departmentsはusePagePermissions()から非同期に取得されるため、useState初期値だけでは
  // 反映されない場合がある。ロード完了後にuseEffectで未選択(null)の場合のみ先頭部門を
  // 補完する(ユーザーが既に選択した値は上書きしない)。
  const [applicantDepartmentSurrogateId, setApplicantDepartmentSurrogateId] =
    useState<string | null>(null);
  useEffect(() => {
    if (applicantDepartmentSurrogateId === null && departments.length > 0) {
      setApplicantDepartmentSurrogateId(departments[0].surrogateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);

  const [editingAccount, setEditingAccount] = useState<AccountRecord | null>(
    null,
  );
  const [wfStatus, setWfStatus] = useState<string | null>(null);

  const [searchCode, setSearchCode] = useState("");
  const [searchName, setSearchName] = useState("");
  const [searchStatus, setSearchStatus] = useState(
    isAccountWfEnabled ? "temporary" : "active",
  );

  useEffect(() => {
    if (isAccountWfEnabled === true) {
      setSearchStatus("temporary");
    }
  }, [isAccountWfEnabled]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 💡 取引先マスタ等と同じロック機構: 編集中の科目が承認ワークフロー審査中(PENDING)なら、
  // フォームを完全ロックする(上書き・再編集防止)
  const isAccountCurrentlyLocked =
    !!editingAccount &&
    isAccountWfEnabled &&
    editingAccount.status === "temporary" &&
    wfStatus === "PENDING";

  useEffect(() => {
    if (!editingAccount || !isAccountWfEnabled) {
      setWfStatus(null);
      return;
    }
    const fetchWfStatus = async () => {
      try {
        const data = await apiFetch<{ status: string }>(
          `/api/workflow-tasks/request-status/${editingAccount.code}?targetType=master_accounts`,
        );
        setWfStatus(data.status);
      } catch (err) {
        console.error("最新の申請状態の取得に失敗しました", err);
      }
    };
    void fetchWfStatus();
  }, [editingAccount, isAccountWfEnabled]);

  const searchParams = new URLSearchParams({
    code: searchCode.trim(),
    name: searchName.trim(),
    status: searchStatus.trim(),
  });

  const {
    items: accounts,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncAccounts,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<AccountRecord>(`/api/accounts?${searchParams.toString()}`, {
    paginationEnabled,
    enabled: canRead && !loading,
  });

  const handleClearSearch = () => {
    setSearchCode("");
    setSearchName("");
    setSearchStatus("active");
  };

  // ➕/💾 登録・更新処理
  const handleSubmit = async (formData: {
    code: string;
    name: string;
    externalMappingCode: string;
    status: "temporary" | "active" | "suspended";
    memo: string;
  }) => {
    if (isSubmitting) return;
    setError("");
    setMessage("");

    if (!editingAccount && !canCreate) {
      setError("登録する権限がありません");
      return;
    }
    if (editingAccount && !canUpdate) {
      setError("更新する権限がありません");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isAccountWfEnabled) {
        // 💡 承認機能有効時は、まずマスタ本体へ「仮登録(temporary)」状態として
        // 先行して直接書き込み・更新を行う(取引先・単位等と同じ二段階方式)。
        // 変更申請時は変更後の値を本体に書き込んではいけないため、既存レコードの値を
        // そのまま使い、statusだけをtemporary(ロック)にして送信する。
        if (editingAccount) {
          await apiFetch(`/api/accounts/${editingAccount.code}`, {
            method: "PUT",
            json: {
              name: editingAccount.name,
              externalMappingCode: editingAccount.externalMappingCode,
              status: "temporary",
              memo: editingAccount.memo,
            },
            defaultErrorMessage:
              "マスタ本体への一時保存(仮登録)に失敗しました",
          });
        } else {
          await apiFetch("/api/accounts/register", {
            method: "POST",
            json: {
              code: formData.code.trim(),
              name: formData.name.trim(),
              externalMappingCode: formData.externalMappingCode.trim() || null,
              memo: formData.memo || null,
            },
            defaultErrorMessage:
              "マスタ本体への一時保存(仮登録)に失敗しました",
          });
        }

        const targetId = editingAccount ? editingAccount.code : formData.code.trim();
        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_accounts",
            targetId,
            requestType: editingAccount ? "UPDATE" : "REGISTER",
            payload: {
              name: formData.name.trim(),
              externalMappingCode: formData.externalMappingCode.trim() || null,
              memo: formData.memo || null,
              status: editingAccount ? formData.status : "active",
            },
            applicantDepartmentSurrogateId,
            comment: editingAccount
              ? `勘定科目[${targetId}] 情報変更申請`
              : `勘定科目 新規登録申請`,
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });

        setMessage(
          editingAccount
            ? "勘定科目の変更承認をワークフローへ申請しました(承認待ちロック)"
            : "勘定科目を仮登録し、承認を申請しました(承認待ち)",
        );
      } else {
        const url = editingAccount
          ? `/api/accounts/${editingAccount.code}`
          : "/api/accounts/register";

        await apiFetch(url, {
          method: editingAccount ? "PUT" : "POST",
          json: {
            code: formData.code.trim(),
            name: formData.name.trim(),
            externalMappingCode: formData.externalMappingCode.trim() || null,
            status: editingAccount ? formData.status : undefined,
            memo: formData.memo || null,
          },
        });

        setMessage(
          editingAccount
            ? "勘定科目情報を更新しました"
            : "新しい勘定科目を新規登録しました",
        );
      }

      setEditingAccount(null);
      await syncAccounts();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 無効化。取引先・単位等と同じく、承認機能有効時は直接無効化せず承認申請を経由する。
  const handleSuspend = async (account: AccountRecord) => {
    if (!canDelete || isSubmitting) return;
    if (!(await confirm(`科目 [${account.code}: ${account.name}] を無効化しますか？`)))
      return;

    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      if (isAccountWfEnabled) {
        await apiFetch(`/api/accounts/${account.code}`, {
          method: "PUT",
          json: {
            name: account.name,
            externalMappingCode: account.externalMappingCode,
            status: "temporary",
            memo: account.memo,
          },
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_accounts",
            targetId: account.code,
            requestType: "UPDATE",
            payload: {
              name: account.name,
              externalMappingCode: account.externalMappingCode,
              memo: account.memo,
              status: "suspended",
            },
            applicantDepartmentSurrogateId,
            comment: `勘定科目[${account.code}] 無効化申請`,
          },
          defaultErrorMessage: "無効化の申請に失敗しました",
        });

        setMessage("勘定科目の無効化をワークフローへ申請しました(承認待ちロック)");
      } else {
        await apiFetch(`/api/accounts/${account.code}/suspend`, {
          method: "POST",
          defaultErrorMessage: "無効化に失敗しました",
        });
        setMessage("勘定科目を無効化しました");
      }

      if (editingAccount?.code === account.code) setEditingAccount(null);
      await syncAccounts();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 📥 CSVダウンロード処理
  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "accounts_export",
    onError: () => setError("CSVダウンロードエラー"),
  });
  const handleDownloadCsv = async () => {
    const isCsvExportable = canCreate || canUpdate;
    if (!isCsvExportable || isSubmitting) return;
    await downloadCsv(`/api/accounts/csv-download?${searchParams.toString()}`);
  };

  // 📤 CSVインポート処理
  const { importCsv, importing } = useCsvImport({
    onSuccess: syncAccounts,
    onMessage: setMessage,
    onError: setError,
  });
  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canCreate || isSubmitting || isAccountWfEnabled) return;
    setError("");
    setMessage("");
    await importCsv("/api/accounts/bulk-register", e);
  };

  // ❌ 物理削除処理
  const handleDelete = async (account: AccountRecord) => {
    if (!canDelete || isSubmitting) return;

    if (!(await confirm(`科目 [${account.code}: ${account.name}] を削除しますか？`)))
      return;

    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/accounts/${account.code}`, { method: "DELETE" });
      setMessage("科目をマスタから削除しました");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      // 従来の挙動を踏襲: 成否に関わらず一覧を再同期する
      await syncAccounts();
      setIsSubmitting(false);
    }
  };

  return {
    accounts,
    editingAccount,
    setEditingAccount,
    isAccountCurrentlyLocked,
    searchCode,
    setSearchCode,
    searchName,
    setSearchName,
    searchStatus,
    setSearchStatus,
    message,
    error,
    isSubmitting: isSubmitting || importing,
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
