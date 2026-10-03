"use client";

import React, { createContext, useContext } from "react";

interface ApplicantDepartmentOption {
  surrogateId: string;
  id: string;
  name: string;
}

// RootLayoutで定義されているUserStateの型
interface UserState {
  id: string;
  employeeNumber: string;
  name: string;
  roleId: string;
  deptName: string;
  companyName: string;
  permissions: string[];
  departments: ApplicantDepartmentOption[];
  isPartnerWfEnabled: boolean;
  isQuoteWfEnabled: boolean;
  isPartnerContactWfEnabled: boolean;
  isUnitWfEnabled: boolean;
  isLocationWfEnabled: boolean;
  isProductPriceWfEnabled: boolean;
  isProductWfEnabled: boolean;
  isAccountWfEnabled: boolean;
  isWarehouseWfEnabled: boolean;
  isBusinessLocationWfEnabled: boolean;
  isItemStructureWfEnabled: boolean;
  isReceivingWfEnabled: boolean;
  isShippingWfEnabled: boolean;
  isInventoryWfEnabled: boolean;
  isDamageWfEnabled: boolean;
  isDisposalWfEnabled: boolean;
  isReturnWfEnabled: boolean;
  isShippingInstructionWfEnabled: boolean;
  isShippingResultWfEnabled: boolean;
  isReceivingInstructionWfEnabled: boolean;
  isReceivingResultWfEnabled: boolean;
  isSalesOrderWfEnabled: boolean;
  isPurchaseRequisitionWfEnabled: boolean;
  isPurchaseOrderWfEnabled: boolean;
  isSalesInvoiceWfEnabled: boolean;
  isPurchaseRecognitionWfEnabled: boolean;
}

interface MenuItem {
  title: string;
  icon: string;
  path: string;
  resource: string;
  category: string;
}

interface PermissionContextType {
  user: UserState | null;
  flatScreens: MenuItem[];
  loading: boolean;
}

const PermissionContext = createContext<PermissionContextType>({
  user: null,
  flatScreens: [],
  loading: true,
});

export function PermissionProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: PermissionContextType;
}) {
  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export const usePermissionContext = () => useContext(PermissionContext);
