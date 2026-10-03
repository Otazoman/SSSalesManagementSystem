"use client";

import { usePathname } from "next/navigation";
import { usePermissionContext } from "../context/permissioncontext";

export function usePagePermissions() {
  const pathname = usePathname();
  const { user, flatScreens, loading } = usePermissionContext();

  // ロード中、またはユーザー情報がない場合のデフォルト安全フォールバック
  if (loading || !user) {
    return {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
      loading: true,
      resource: null,
      departments: [],
      isPartnerWfEnabled: false,
      isQuoteWfEnabled: false,
      isPartnerContactWfEnabled: false,
      isUnitWfEnabled: false,
      isLocationWfEnabled: false,
      isProductPriceWfEnabled: false,
      isProductWfEnabled: false,
      isAccountWfEnabled: false,
      isWarehouseWfEnabled: false,
      isBusinessLocationWfEnabled: false,
      isItemStructureWfEnabled: false,
      isReceivingWfEnabled: false,
      isShippingWfEnabled: false,
      isInventoryWfEnabled: false,
      isDamageWfEnabled: false,
      isDisposalWfEnabled: false,
      isReturnWfEnabled: false,
      isShippingInstructionWfEnabled: false,
      isShippingResultWfEnabled: false,
      isReceivingInstructionWfEnabled: false,
      isReceivingResultWfEnabled: false,
      isSalesOrderWfEnabled: false,
      isPurchaseRequisitionWfEnabled: false,
      isPurchaseOrderWfEnabled: false,
      isSalesInvoiceWfEnabled: false,
      isPurchaseRecognitionWfEnabled: false,
    };
  }

  // 💡 特権管理者ロール "admin" の場合は、マトリクスの設定に関わらず全操作を無条件許可
  const isAdmin = user.roleId === "admin";

  // 現在のURLパスから、画面マスタ上の定義（resource）を逆引き特定する
  const cleanPathname = pathname.replace(/\/$/, "");
  const matchedScreen = flatScreens.find(
    (s) =>
      s.path.replace(/\/$/, "") === cleanPathname ||
      cleanPathname.startsWith(s.path.replace(/\/$/, "") + "/"),
  );

  // 画面マスタにない定義、またはマッチしない場合はadmin以外拒否
  if (!matchedScreen) {
    return {
      canCreate: isAdmin,
      canRead: isAdmin,
      canUpdate: isAdmin,
      canDelete: isAdmin,
      loading: false,
      resource: null,
      departments: user.departments || [],
      isPartnerWfEnabled: user.isPartnerWfEnabled || false,
      isQuoteWfEnabled: user.isQuoteWfEnabled || false,
      isPartnerContactWfEnabled: user.isPartnerContactWfEnabled || false,
      isUnitWfEnabled: user.isUnitWfEnabled || false,
      isLocationWfEnabled: user.isLocationWfEnabled || false,
      isProductPriceWfEnabled: user.isProductPriceWfEnabled || false,
      isProductWfEnabled: user.isProductWfEnabled || false,
      isAccountWfEnabled: user.isAccountWfEnabled || false,
      isWarehouseWfEnabled: user.isWarehouseWfEnabled || false,
      isBusinessLocationWfEnabled: user.isBusinessLocationWfEnabled || false,
      isItemStructureWfEnabled: user.isItemStructureWfEnabled || false,
      isReceivingWfEnabled: user.isReceivingWfEnabled || false,
      isShippingWfEnabled: user.isShippingWfEnabled || false,
      isInventoryWfEnabled: user.isInventoryWfEnabled || false,
      isDamageWfEnabled: user.isDamageWfEnabled || false,
      isDisposalWfEnabled: user.isDisposalWfEnabled || false,
      isReturnWfEnabled: user.isReturnWfEnabled || false,
      isShippingInstructionWfEnabled: user.isShippingInstructionWfEnabled || false,
      isShippingResultWfEnabled: user.isShippingResultWfEnabled || false,
      isReceivingInstructionWfEnabled: user.isReceivingInstructionWfEnabled || false,
      isReceivingResultWfEnabled: user.isReceivingResultWfEnabled || false,
      isSalesOrderWfEnabled: user.isSalesOrderWfEnabled || false,
      isPurchaseRequisitionWfEnabled:
        user.isPurchaseRequisitionWfEnabled || false,
      isPurchaseOrderWfEnabled: user.isPurchaseOrderWfEnabled || false,
      isSalesInvoiceWfEnabled: user.isSalesInvoiceWfEnabled || false,
      isPurchaseRecognitionWfEnabled:
        user.isPurchaseRecognitionWfEnabled || false,
    };
  }

  const res = matchedScreen.resource; // 例: "approval_flows"

  // 💡 マスタ配列（STANDARD_ACTIONS）のキー名 "create", "read", "update", "delete" と完全一致判定
  return {
    canCreate: isAdmin || user.permissions.includes(`${res}:create`),
    canRead:
      isAdmin ||
      user.permissions.includes(`${res}:read`) ||
      user.permissions.includes(`${res}:menu`),
    canUpdate: isAdmin || user.permissions.includes(`${res}:update`),
    canDelete: isAdmin || user.permissions.includes(`${res}:delete`),
    loading: false,
    resource: res,
    departments: user.departments || [],
    isPartnerWfEnabled: user.isPartnerWfEnabled || false,
    isQuoteWfEnabled: user.isQuoteWfEnabled || false,
    isPartnerContactWfEnabled: user.isPartnerContactWfEnabled || false,
    isUnitWfEnabled: user.isUnitWfEnabled || false,
    isLocationWfEnabled: user.isLocationWfEnabled || false,
    isProductPriceWfEnabled: user.isProductPriceWfEnabled || false,
    isProductWfEnabled: user.isProductWfEnabled || false,
    isAccountWfEnabled: user.isAccountWfEnabled || false,
    isWarehouseWfEnabled: user.isWarehouseWfEnabled || false,
    isBusinessLocationWfEnabled: user.isBusinessLocationWfEnabled || false,
    isItemStructureWfEnabled: user.isItemStructureWfEnabled || false,
    isReceivingWfEnabled: user.isReceivingWfEnabled || false,
    isShippingWfEnabled: user.isShippingWfEnabled || false,
    isInventoryWfEnabled: user.isInventoryWfEnabled || false,
    isDamageWfEnabled: user.isDamageWfEnabled || false,
    isDisposalWfEnabled: user.isDisposalWfEnabled || false,
    isReturnWfEnabled: user.isReturnWfEnabled || false,
    isShippingInstructionWfEnabled: user.isShippingInstructionWfEnabled || false,
    isShippingResultWfEnabled: user.isShippingResultWfEnabled || false,
    isReceivingInstructionWfEnabled: user.isReceivingInstructionWfEnabled || false,
    isReceivingResultWfEnabled: user.isReceivingResultWfEnabled || false,
    isSalesOrderWfEnabled: user.isSalesOrderWfEnabled || false,
    isPurchaseRequisitionWfEnabled:
      user.isPurchaseRequisitionWfEnabled || false,
    isPurchaseOrderWfEnabled: user.isPurchaseOrderWfEnabled || false,
    isSalesInvoiceWfEnabled: user.isSalesInvoiceWfEnabled || false,
    isPurchaseRecognitionWfEnabled:
      user.isPurchaseRecognitionWfEnabled || false,
  };
}
