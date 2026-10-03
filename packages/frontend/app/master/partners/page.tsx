"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState, useEffect } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { PartnerRecord } from "./_types";
import { usePartnerForm } from "./_hooks/usePartnerForm";

import SearchPanel from "./_components/SearchPanel";
import PartnerForm from "./_components/PartnerForm";
import CsvImportPanel from "./_components/CsvImportPanel";
import PartnerTable from "./_components/PartnerTable";
import { PartnerDeliveryDestinationsModal } from "./_components/PartnerDeliveryDestinationsModal";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../_shared/hooks/use-csv-download";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";
import { Pagination } from "../../_shared/ui/Pagination";
import { useConfirm } from "../../_shared/hooks/use-confirm";

export default function PartnersPage() {
  const confirm = useConfirm();
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    loading,
    isPartnerWfEnabled,
    departments,
  } = usePagePermissions();

  const { paginationEnabled } = usePaginationSetting();

  const [filterStatus, setFilterStatus] = useState<string>(
    isPartnerWfEnabled ? "temporary" : "active",
  );

  const [showForm, setShowForm] = useState(false);
  const guard = useDiscardGuard(showForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 新規要望(2026-09-23): 取引先ごとの複数納品先(受注の納品先選択で使う)管理モーダル
  const [deliveryDestinationsModalTarget, setDeliveryDestinationsModalTarget] =
    useState<PartnerRecord | null>(null);

  // 🔎 検索パネル用State
  const [searchId, setSearchId] = useState("");
  const [searchName, setSearchName] = useState("");
  const [searchNameMode, setSearchNameMode] = useState<"partial" | "exact">(
    "partial",
  );
  const [searchType, setSearchType] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // ワークフロー有効フラグを監視して、Stateの初期値を安全に合わせる
  useEffect(() => {
    if (isPartnerWfEnabled === true) {
      setFilterStatus("temporary");
    }
  }, [isPartnerWfEnabled]);

  const searchParams2 = new URLSearchParams({
    status: filterStatus,
    id: searchId,
    name: searchName,
    nameMode: searchNameMode,
    type: searchType,
  });

  const {
    items: partners,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncPartners,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<PartnerRecord>(
    `/api/partners?${searchParams2.toString()}`,
    { paginationEnabled, enabled: canRead && !loading },
  );

  const handleClearSearch = () => {
    setSearchId("");
    setSearchName("");
    setSearchNameMode("partial");
    setSearchType("");
  };

  const searchParams = useSearchParams();
  const urlEditId = searchParams.get("editId");

  useEffect(() => {
    if (urlEditId && partners.length > 0) {
      const targetPartner = partners.find((c) => c.id === urlEditId);
      if (targetPartner) {
        // 自動で編集フォームを起動
        handleRowSelection(targetPartner);

        // 重複実行を防ぐため、ブラウザのURLからパラメータのみをクリア
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    }
  }, [urlEditId, partners]);

  const handleSuccess = (successMessage: string) => {
    setMessage(successMessage);
    void syncPartners();
  };

  const handleClose = () => {
    setShowForm(false);
    setEditingId(null);
  };

  // カスタムフック（フォーム制御・送信ロジック）
  const formProps = usePartnerForm(
    editingId,
    isPartnerWfEnabled,
    canCreate,
    canUpdate,
    handleSuccess,
    handleClose,
    departments,
  );

  const handleRowSelection = (c: PartnerRecord) => {
    setEditingId(c.id);

    // 💡 差戻し状態（REMANDED）かつ、退避データが存在するかをチェック
    const isRemanded =
      (c as any).wfStatus === "REMANDED" && (c as any).savedPayload;
    // 💡 差戻しなら退避データ（修正途中の内容）を、そうでなければマスタ本体のデータをソースとして採用
    const dataSource = isRemanded ? (c as any).savedPayload : c;

    formProps.setFormData({
      id: c.id, // 取引先コードは一貫して c.id（本体）を使用
      name: dataSource.name,
      type: dataSource.type,
      postalCode: dataSource.postalCode || "",
      address: dataSource.address || "",
      phone: dataSource.phone || "",
      fax: dataSource.fax || "",
      creditLimit: dataSource.creditLimit ?? "",
      status: c.status, // 表示ステータスは本体の temporary に準拠
      memo: dataSource.memo || "",
      closingDay: dataSource.closingDay ?? "",
      paymentMonthOffset: dataSource.paymentMonthOffset ?? "",
      paymentDay: dataSource.paymentDay ?? "",
      paymentMethod: dataSource.paymentMethod || "",
      qualifiedInvoiceNumber: dataSource.qualifiedInvoiceNumber || "",
      corporateNumber: dataSource.corporateNumber || "",
      antiSocialCheckStatus: dataSource.antiSocialCheckStatus || "UNCHECKED",
      antiSocialCheckMemo: dataSource.antiSocialCheckMemo || "",
      contractDate: dataSource.contractDate
        ? new Date(dataSource.contractDate).toISOString().split("T")[0]
        : "",
      contractValidTo: dataSource.contractValidTo
        ? new Date(dataSource.contractValidTo).toISOString().split("T")[0]
        : "",
      attachments: dataSource.attachments || [],
      bankAccounts: dataSource.bankAccounts || [],
      // 💡 フック側でロックを判別できるように、ワークフローの状態をオブジェクトに付加して渡します
      wfStatus: (c as any).wfStatus || null,
    } as any);

    setShowForm(true);
  };

  // 物理削除
  const handlePurgePartner = async (id: string, name: string) => {
    if (!canDelete || isSubmitting) return;
    setError("");
    setMessage("");
    if (!(await confirm(`⚠️ 警告: 取引先「${name}」のデータを完全に消去しますか？`)))
      return;

    setIsSubmitting(true);
    try {
      await apiFetch(`/api/partners/${id}/purge`, {
        method: "DELETE",
        defaultErrorMessage: "物理削除に失敗しました",
      });
      setMessage(`取引先「${name}」をマスタから完全に削除しました`);
      void syncPartners();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 取引停止
  const handleSuspendPartner = async (id: string, name: string) => {
    if (!canDelete || isSubmitting) return;
    setError("");
    setMessage("");
    if (!(await confirm(`「${name}」との取引を停止しますか？`))) return;

    setIsSubmitting(true);
    try {
      if (isPartnerWfEnabled) {
        const currentRecord = partners.find((c) => c.id === id);
        if (!currentRecord) throw new Error("対象のデータが見つかりません");

        // 💡【追加】マスタ本体を先行して "temporary"（審査中）に更新し、画面上で編集ロック & 申請中であることを明示する
        await apiFetch(`/api/partners/${id}`, {
          method: "PUT",
          json: {
            ...currentRecord,
            status: "temporary", // 承認されるまでは仮登録（審査中ロック）状態にする
          },
          defaultErrorMessage: "取引先ステータスの一次更新に失敗しました",
        });

        // 先行更新に成功したら、予定通りワークフロー側に「最終ステータス：suspended」として申請を出す
        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_partners",
            targetId: id,
            payload: {
              ...currentRecord,
              status: "suspended", // 最終的に承認されたら suspended (取引停止) にする
              phone: (currentRecord as any).phone || null,
              fax: (currentRecord as any).fax || null,
              creditLimit: (currentRecord as any).creditLimit
                ? Number((currentRecord as any).creditLimit)
                : 0,
              closingDay: (currentRecord as any).closingDay
                ? Number((currentRecord as any).closingDay)
                : null,
              paymentMonthOffset: (currentRecord as any).paymentMonthOffset
                ? Number((currentRecord as any).paymentMonthOffset)
                : null,
              paymentDay: (currentRecord as any).paymentDay
                ? Number((currentRecord as any).paymentDay)
                : null,
              // 追加要望L-4-a: 停止申請のスナップショットでも番号を保持する(承認時に消えないように)
              qualifiedInvoiceNumber:
                (currentRecord as any).qualifiedInvoiceNumber || null,
              corporateNumber: (currentRecord as any).corporateNumber || null,
            },
            applicantDepartmentSurrogateId:
              formProps.applicantDepartmentSurrogateId,
            comment: `取引先「${name}」の取引停止(凍結)申請`,
          },
          defaultErrorMessage: "取引停止申請に失敗しました",
        });

        setMessage(
          `取引先「${name}」の取引停止をワークフローへ申請しました(承認待ちロック)`,
        );
      } else {
        await apiFetch(`/api/partners/${id}/suspend`, {
          method: "POST",
          defaultErrorMessage: "取引停止処理に失敗しました",
        });

        setMessage(`取引先「${name}」のステータスを取引停止に変更しました`);
      }

      void syncPartners();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "customers_export",
    onError: () => setError("CSVダウンロードエラー"),
  });
  const handleDownloadCsv = async () => {
    if (!canCreate && !canUpdate) return;
    await downloadCsv(`/api/partners/csv-download?${searchParams2.toString()}`);
  };

  const isFormEditable = editingId ? canUpdate : canCreate;
  const isDownloadAllowed = canCreate || canUpdate;

  if (loading) {
    return <LoadingGate />;
  }

  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  return (
    <div className="w-full space-y-6">
      {/* タイトル */}
      <PageHeader
        title="🏢 取引先マスタ"
        description="得意先および仕入先を一元管理し、サイト決済条件などを設定します。"
        actions={
          <>
            <button
              onClick={handleDownloadCsv}
              disabled={!isDownloadAllowed || isSubmitting}
              className={`text-xs border px-3 py-1.5 rounded font-bold text-white transition-colors shadow-sm ${isDownloadAllowed && !isSubmitting ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer" : "bg-slate-300 text-slate-500 border-slate-300 cursor-not-allowed"}`}
            >
              📥 CSVダウンロード
            </button>
          </>
        }
      />

      <MessageBanner message={message} error={error || formProps.error} />

      {/* 🔍 検索パネル */}
      <SearchPanel
        searchId={searchId}
        setSearchId={setSearchId}
        searchName={searchName}
        setSearchName={setSearchName}
        searchNameMode={searchNameMode}
        setSearchNameMode={setSearchNameMode}
        searchType={searchType}
        setSearchType={setSearchType}
        onClear={handleClearSearch}
      />

      {/* サブバー */}
      <div className="flex flex-wrap justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200 gap-4">
        <div className="min-w-96 shrink-0">
          <StatusTabs
            options={[
              { value: "active", label: "🟢 有効" },
              { value: "temporary", label: "🟡 仮登録" },
              { value: "suspended", label: "🔴 無効" },
              { value: "all", label: "🌐 すべて" },
            ]}
            value={filterStatus}
            onChange={setFilterStatus}
          />
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
            📊 該当件数:{" "}
            <span className="text-sm font-black text-indigo-600">{total}</span>{" "}
            件
          </span>
          <button
            onClick={async () =>
              showForm
                ? (await guard.confirmDiscard()) && formProps.handleCloseForm()
                : setShowForm(true)
            }
            disabled={!canCreate && !showForm}
            className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${canCreate || showForm ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700" : "bg-slate-300 text-slate-500 cursor-not-allowed"}`}
          >
            {showForm ? "キャンセル" : "➕ 新規個別登録・CSVインポート"}
          </button>
        </div>
      </div>

      {/* 登録・編集フォーム & CSVインポート */}
      {showForm && (
        <div
          {...guard.scopeProps}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200"
        >
          <PartnerForm
            editingId={editingId}
            formData={formProps.formData}
            isSubmitting={formProps.isSubmitting}
            isFormEditable={isFormEditable}
            isPartnerWfEnabled={isPartnerWfEnabled}
            isMasterCurrentlyLocked={formProps.isMasterCurrentlyLocked}
            departments={departments}
            applicantDepartmentSurrogateId={
              formProps.applicantDepartmentSurrogateId
            }
            setApplicantDepartmentSurrogateId={
              formProps.setApplicantDepartmentSurrogateId
            }
            extUrlInput={formProps.extUrlInput}
            setExtUrlInput={formProps.setExtUrlInput}
            extTitleInput={formProps.extTitleInput}
            setExtTitleInput={formProps.setExtTitleInput}
            handleInputChange={formProps.handleInputChange}
            handleSubmit={formProps.handleSubmit}
            handleFileUpload={formProps.handleFileUpload}
            handleAddExternalLink={formProps.handleAddExternalLink}
            handleRemoveAttachment={formProps.handleRemoveAttachment}
            handleAddBankAccount={formProps.handleAddBankAccount}
            handleRemoveBankAccount={formProps.handleRemoveBankAccount}
            handleBankAccountChange={formProps.handleBankAccountChange}
          />
          <CsvImportPanel
            canCreate={canCreate}
            editingId={editingId}
            isPartnerWfEnabled={isPartnerWfEnabled}
            onSuccess={() => {
              setMessage("CSVインポートが完了しました");
              void syncPartners();
            }}
            onError={(msg) => setError(msg)}
          />
        </div>
      )}

      {/* データ一覧テーブル */}
      <PartnerTable
        partners={partners}
        canUpdate={canUpdate}
        canDelete={canDelete}
        isSubmitting={isSubmitting || formProps.isSubmitting}
        onSelectRow={handleRowSelection}
        onSuspend={handleSuspendPartner}
        onPurge={handlePurgePartner}
        onManageDeliveryDestinations={(c) => setDeliveryDestinationsModalTarget(c)}
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortKeys={sortKeys}
        onSortChange={setSort}
      />

      {deliveryDestinationsModalTarget && (
        <PartnerDeliveryDestinationsModal
          partnerId={deliveryDestinationsModalTarget.id}
          partnerName={deliveryDestinationsModalTarget.name}
          canUpdate={canUpdate}
          onClose={() => setDeliveryDestinationsModalTarget(null)}
        />
      )}

      <Pagination
        paginationEnabled={paginationEnabled}
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPageChange={setPage}
        onLimitChange={setLimit}
      />
    </div>
  );
}
