// app/types.ts
export interface ApplicantDepartmentOption {
  surrogateId: string;
  id: string;
  name: string;
}

export interface UserState {
  id: string;
  employeeNumber: string;
  name: string;
  roleId: string;
  deptName: string;
  companyName: string;
  permissions: string[];
  // 追加要望F: ユーザーが実際に所属する部門一覧(重複除去済み)。承認申請時の申請部門選択に使う。
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

export interface MenuItem {
  title: string;
  icon: string;
  path: string;
  resource: string;
  category: string;
}

export interface MenuSection {
  sectionTitle: string;
  items: MenuItem[];
}
