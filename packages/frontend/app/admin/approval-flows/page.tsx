"use client";

import { useDiscardGuard } from "../../_shared/ui/DiscardGuard";
import { useState } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { useApprovalFlow } from "./_hooks/useApprovalFlow";
import { FlowForm } from "./_components/FlowForm";
import { FlowList } from "./_components/FlowList";
import { CsvImportPanel } from "./_components/CsvImportPanel";
import { RoutePreviewModal } from "./_components/RoutePreviewModal";
import { ApprovalFlowRecord } from "./_types";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { StatusTabs } from "../../_shared/ui/StatusTabs";

export default function MasterApprovalFlowsPage() {
  const {
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    loading: loadingPermissions,
  } = usePagePermissions();

  const [showForm, setShowForm] = useState(false);
  const guard = useDiscardGuard(showForm);
  const [showRoutePreview, setShowRoutePreview] = useState(false);

  const {
    roles,
    screens,
    departmentOptions,
    filterStatus,
    setFilterStatus,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
    filteredFlows,
    isSubmitting,
    editingFlowId,
    flowName,
    setFlowName,
    requestType,
    setRequestType,
    minAmount,
    setMinAmount,
    maxAmount,
    setMaxAmount,
    matchField,
    setMatchField,
    matchValue,
    setMatchValue,
    builderSteps,
    selectedRoleId,
    setSelectedRoleId,
    selectedDepartmentSurrogateId,
    setSelectedDepartmentSurrogateId,
    stepName,
    setStepName,
    stepMemo,
    setStepMemo,
    message,
    setMessage,
    error,
    setError,
    addStepToBuilder,
    removeStepFromBuilder,
    handleEditClick,
    handleCancelEdit,
    handleCsvDownload,
    handleCsvImport,
    handleSubmitFlow,
    handleDisableFlow,
    handleRestoreFlow,
    handlePurgeFlow,
  } = useApprovalFlow({ canRead, canCreate, canUpdate, loadingPermissions });

  if (loadingPermissions) {
    return <LoadingGate label="セキュリティ権限の検証中... 🛡️" />;
  }

  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="この画面のデータを閲覧(Read)する権限があなたのロールに付与されていません。"
      />
    );
  }

  const handleRowSelection = (flow: ApprovalFlowRecord) => {
    handleEditClick(flow);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    handleCancelEdit();
    setMessage("");
    setError("");
  };

  const requestCloseForm = async () => {
    if ((await guard.confirmDiscard())) handleCloseForm();
  };

  return (
    <div className="w-full space-y-6">
      {/* 画面ヘッダー */}
      <PageHeader
        title="🔀 承認フロー定義"
        description="金額・種別ごとの承認ルートを動的に設計・統制・変更します。"
        actions={
          <>
            <button
              onClick={() => setShowRoutePreview(true)}
              disabled={!canRead}
              className={`text-xs border px-3 py-1.5 rounded font-bold text-white transition-colors shadow-sm ${
                canRead
                  ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
                  : "bg-slate-300 text-slate-500 border-slate-300 cursor-not-allowed"
              }`}
            >
              🔍 申請経路プレビュー
            </button>
            <button
              onClick={handleCsvDownload}
              disabled={!canRead || isSubmitting}
              className={`text-xs border px-3 py-1.5 rounded font-bold text-white transition-colors shadow-sm ${
                canRead && !isSubmitting
                  ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
                  : "bg-slate-300 text-slate-500 border-slate-300 cursor-not-allowed"
              }`}
            >
              📥 CSVダウンロード
            </button>
          </>
        }
      />

      {/* アラート通知 */}
      <MessageBanner message={message} error={error} />

      {/* サブバー */}
      <div className="flex flex-wrap justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200 gap-4">
        <div className="min-w-64 shrink-0">
          <StatusTabs
            options={[
              { value: "active", label: "🟢 有効のみ" },
              { value: "inactive", label: "🔴 無効のみ" },
              { value: "all", label: "🌐 すべて" },
            ]}
            value={filterStatus}
            onChange={setFilterStatus}
          />
        </div>

        <div className="flex items-center space-x-4">
          <span className="text-xs font-bold text-slate-600 bg-slate-200/60 px-2.5 py-1 rounded-full">
            📊 該当件数:{" "}
            <span className="text-sm font-black text-indigo-600">
              {filteredFlows.length}
            </span>{" "}
            件
          </span>
          <button
            type="button"
            onClick={() => (showForm ? requestCloseForm() : setShowForm(true))}
            disabled={!canCreate && !showForm}
            className={`text-xs px-3 py-1.5 rounded font-bold transition-colors shadow-sm ${
              canCreate || showForm
                ? "bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700"
                : "bg-slate-300 text-slate-500 cursor-not-allowed"
            }`}
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
          <FlowForm
            canCreate={canCreate}
            canUpdate={canUpdate}
            editingFlowId={editingFlowId}
            isSubmitting={isSubmitting}
            flowName={flowName}
            setFlowName={setFlowName}
            requestType={requestType}
            setRequestType={setRequestType}
            minAmount={minAmount}
            setMinAmount={setMinAmount}
            maxAmount={maxAmount}
            setMaxAmount={setMaxAmount}
            matchField={matchField}
            setMatchField={setMatchField}
            matchValue={matchValue}
            setMatchValue={setMatchValue}
            roles={roles}
            selectedRoleId={selectedRoleId}
            setSelectedRoleId={setSelectedRoleId}
            departmentOptions={departmentOptions}
            selectedDepartmentSurrogateId={selectedDepartmentSurrogateId}
            setSelectedDepartmentSurrogateId={setSelectedDepartmentSurrogateId}
            stepName={stepName}
            setStepName={setStepName}
            stepMemo={stepMemo}
            setStepMemo={setStepMemo}
            builderSteps={builderSteps}
            addStepToBuilder={addStepToBuilder}
            removeStepFromBuilder={removeStepFromBuilder}
            handleSubmitFlow={handleSubmitFlow}
            handleCancelEdit={requestCloseForm}
            screens={screens}
          />
          <CsvImportPanel
            canCreate={canCreate}
            editingFlowId={editingFlowId}
            isSubmitting={isSubmitting}
            onImportCsv={handleCsvImport}
          />
        </div>
      )}

      {/* 一覧テーブル */}
      <FlowList
        filteredFlows={filteredFlows}
        screens={screens}
        canUpdate={canUpdate}
        canDelete={canDelete}
        isSubmitting={isSubmitting}
        onSelectRow={handleRowSelection}
        handleDisableFlow={handleDisableFlow}
        handleRestoreFlow={handleRestoreFlow}
        handlePurgeFlow={handlePurgeFlow}
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortKeys={sortKeys}
        onSortChange={setSort}
      />

      {showRoutePreview && (
        <RoutePreviewModal
          screens={screens}
          onClose={() => setShowRoutePreview(false)}
        />
      )}
    </div>
  );
}
