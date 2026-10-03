"use client";

import { useState } from "react";
import { Button } from "../../_shared/ui/Button";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { useMatrixState } from "./_hooks/useMatrixState";

import { STANDARD_ACTIONS } from "./_types";
import { Header } from "./_components/Header";
import { CsvImportPanel } from "./_components/CsvImportPanel";
import { TemplateTool } from "./_components/TemplateTool";
import { MatrixTable } from "./_components/MatrixTable";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";

export default function MasterPermissionsPage() {
  // 💡 認可ガードフック
  const { canRead, canCreate, canUpdate, loading } = usePagePermissions();

  // 💡 画面固有の状態管理とAPIハンドラを集約したカスタムフック
  const state = useMatrixState({ canRead, canCreate, canUpdate, loading });

  // 他マスタ(roles/approval-flows等)の「新規個別登録・CSVインポート」トグルと位置を揃えるための開閉状態
  const [showTools, setShowTools] = useState(false);

  // 1. ローディング状態
  if (loading) {
    return <LoadingGate label="ユーザー権限を確認中..." />;
  }

  // 2. 閲覧権限ガード
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🛡️ アクセス拒否"
        description="この画面を閲覧する権限が付与されていません。"
      />
    );
  }

  return (
    <div className="w-full space-y-6">
      {/* 上部ヘッダー部 */}
      <Header
        screenOptions={state.screenOptions}
        permissions={state.permissions}
        roles={state.roles}
        selectedRoleId={state.selectedRoleId}
        checkedPermissionIds={state.checkedPermissionIds}
        canDownload={canRead}
        isSubmitting={state.isSaving}
        onDownloadCsv={state.downloadCsv}
      />

      {/* 通知メッセージエリア */}
      <MessageBanner message={state.message} error={state.error} />
      {!canUpdate && (
        <div className="p-3 bg-amber-50 text-amber-800 text-xs font-medium rounded border border-amber-200">
          ⚠️
          あなたのアカウントには編集権限(update)がないため、読み取り専用となります。
        </div>
      )}

      {/* サブバー */}
      <div className="flex justify-end items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
        <Button size="sm" onClick={() => setShowTools(!showTools)}>
          {showTools ? "ツールを閉じる" : "📋 ひな型コピー・CSVインポート"}
        </Button>
      </div>

      {/* ひな型コピーツール & CSVインポート(他マスタの登録フォーム+CSVインポートと同じ位置・同じ2列グリッド) */}
      {showTools && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-slate-100 rounded-xl border border-slate-200">
          <TemplateTool
            canUpdate={canUpdate}
            copiedRoleName={state.copiedRoleName}
            hasCopiedTemplate={state.hasCopiedTemplate}
            onCopy={state.handleCopyAsTemplate}
            onPaste={state.handlePasteTemplate}
          />
          <CsvImportPanel
            canCreate={canCreate}
            isSubmitting={state.isSaving}
            onImportCsv={state.importCsv}
          />
        </div>
      )}

      {/* マトリクス一覧(全幅表示) */}
      <MatrixTable
        roles={state.roles}
        permissions={state.permissions}
        screenOptions={state.screenOptions}
        dynamicHeaderActions={STANDARD_ACTIONS}
        selectedRoleId={state.selectedRoleId}
        checkedPermissionIds={state.checkedPermissionIds}
        canUpdate={canUpdate}
        isSaving={state.isSaving}
        onRoleChange={state.setSelectedRoleId}
        onSave={state.handleSaveRoleMapping}
        onToggleColumn={state.handleToggleColumnCheckboxes}
        onToggleRow={state.handleToggleRowCheckboxes}
        onCellChange={state.handleMatrixCheckChange}
      />
    </div>
  );
}
