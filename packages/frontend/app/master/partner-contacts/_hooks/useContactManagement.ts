import { useState, useEffect } from "react";
import { ContactRecord, PartnerLookup, UserLookup } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import { useCsvImport } from "../../../_shared/hooks/use-csv-import";
import type { ApplicantDepartmentOption } from "../../../types";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface UseContactManagementProps {
  canRead: boolean;
  canCreate: boolean;
  loading: boolean;
  isPartnerContactWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
}

export function useContactManagement({
  canRead,
  canCreate,
  loading,
  isPartnerContactWfEnabled = false,
  departments = [],
}: UseContactManagementProps) {
  const confirm = useConfirm();
  const { paginationEnabled } = usePaginationSetting();
  // 追加要望F: 複数部門所属時の申請部門選択(初期値は所属部門の先頭=従来の暗黙動作と同じ)。
  // departmentsはusePagePermissions()から非同期に取得されるため、マウント時点では
  // 空配列のことがある。useState初期値だけでは反映されないため、ロード完了後にuseEffectで
  // 未選択(null)の場合のみ先頭部門を補完する(ユーザーが既に選択した値は上書きしない)。
  const [applicantDepartmentSurrogateId, setApplicantDepartmentSurrogateId] =
    useState<string | null>(null);
  useEffect(() => {
    if (applicantDepartmentSurrogateId === null && departments.length > 0) {
      setApplicantDepartmentSurrogateId(departments[0].surrogateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);

  const [partners, setPartners] = useState<PartnerLookup[]>([]);
  const [users, setUsers] = useState<UserLookup[]>([]);

  // 🔎 検索用State（partnerId に統一）
  const [searchPartnerId, setSearchPartnerId] = useState("");
  const [searchName, setSearchName] = useState("");

  // 🔎 ステータス絞り込み（取引先マスタと同じパターン）
  const [filterStatus, setFilterStatus] = useState<string>(
    isPartnerContactWfEnabled ? "temporary" : "active",
  );

  useEffect(() => {
    if (isPartnerContactWfEnabled === true) {
      setFilterStatus("temporary");
    }
  }, [isPartnerContactWfEnabled]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // プルダウン用マスタ取得
  useEffect(() => {
    if (loading || !canRead) return;

    async function loadLookups() {
      try {
        const [custData, userData] = await Promise.all([
          apiFetch<PartnerLookup[]>("/api/partners?status=all"),
          apiFetch<UserLookup[]>("/api/users"),
        ]);
        setPartners(custData);
        setUsers(userData);
      } catch (err) {
        console.error("マスタ参照取得失敗", err);
      }
    }
    void loadLookups();
  }, [loading, canRead]);

  // 一覧同期
  const searchParams = new URLSearchParams();
  if (searchPartnerId) searchParams.append("partnerId", searchPartnerId);
  if (searchName) searchParams.append("name", searchName);
  searchParams.append("status", filterStatus);

  const {
    items: contacts,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncContacts,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<ContactRecord>(
    `/api/partner-contacts?${searchParams.toString()}`,
    { paginationEnabled, enabled: canRead && !loading },
  );

  // 📥 CSVダウンロード
  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "contacts_export",
    onError: setError,
  });
  const handleDownloadCsv = async () => {
    if (!canRead || !canCreate) {
      setError("CSVダウンロードする権限がありません");
      return;
    }
    setError("");
    setMessage("");
    await downloadCsv(`/api/partner-contacts/csv-download?${searchParams.toString()}`);
  };

  // 📤 CSVインポート
  const { importCsv } = useCsvImport({
    onSuccess: syncContacts,
    onMessage: setMessage,
    onError: setError,
  });
  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canCreate) return;
    setError("");
    setMessage("");
    await importCsv("/api/partner-contacts/bulk-register", e);
  };

  // 🗑️ 削除
  const handleDeleteContact = async (id: string) => {
    if (!(await confirm("削除しますか？"))) return;
    try {
      await apiFetch(`/api/partner-contacts/${id}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });
      await syncContacts();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  // 無効化。取引先マスタと同じく、承認機能有効時は直接無効化せず承認申請を経由する。
  const handleSuspendContact = async (id: string) => {
    if (!(await confirm("無効化しますか？"))) return;
    try {
      if (isPartnerContactWfEnabled) {
        const current = contacts.find((c) => c.id === id);
        if (!current) throw new Error("対象のデータが見つかりません");

        await apiFetch(`/api/partner-contacts/${id}`, {
          method: "PUT",
          json: {
            partnerId: current.partnerId,
            contactType: current.contactType,
            internalUserId: current.internalUserId || null,
            name: current.name || null,
            email: current.email || null,
            phone: current.phone || null,
            fax: current.fax || null,
            departmentName: current.departmentName || null,
            isEmailTarget: current.isEmailTarget,
            memo: current.memo || null,
            status: "temporary",
          },
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_contacts",
            targetId: id,
            requestType: "UPDATE",
            payload: {
              id,
              partnerId: current.partnerId,
              contactType: current.contactType,
              internalUserId: current.internalUserId || null,
              name: current.name || null,
              email: current.email || null,
              phone: current.phone || null,
              fax: current.fax || null,
              departmentName: current.departmentName || null,
              isEmailTarget: current.isEmailTarget,
              memo: current.memo || null,
              status: "suspended",
            },
            applicantDepartmentSurrogateId,
            comment: `取引先担当者マスタ[${id}] 無効化申請`,
          },
          defaultErrorMessage: "無効化の申請に失敗しました",
        });

        setMessage(
          "担当者の無効化をワークフローへ申請しました(承認待ちロック)",
        );
      } else {
        await apiFetch(`/api/partner-contacts/${id}/suspend`, {
          method: "POST",
          defaultErrorMessage: "無効化に失敗しました",
        });
      }
      await syncContacts();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    }
  };

  return {
    contacts,
    partners,
    users,
    searchPartnerId,
    setSearchPartnerId,
    searchName,
    setSearchName,
    filterStatus,
    setFilterStatus,
    message,
    setMessage,
    error,
    setError,
    syncContacts,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    handleDownloadCsv,
    handleImportCsv,
    handleDeleteContact,
    handleSuspendContact,
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
