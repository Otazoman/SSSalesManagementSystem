// 承認タスク・申請履歴で、申請の種類(targetType)の名前を出すための表(画面の一覧 /api/permissions/screens に無い種類)。
// BUG-103(2026-11-15): 承認フローはメニュー単位にしたため、承認フローの「対象申請種別」には出さない(伝票を作るメニューのフローを使う)。
// 例: 入金(請求への入金・単体入金)は「請求管理」、支払の消込は「支払管理」、入出庫・指示は「入荷」「出荷」「在庫・棚卸管理」のフローを使う
export const APPROVAL_ONLY_REQUEST_TYPES: Array<{ resource: string; name: string; category: string }> = [
  { resource: "sales_payment_receipts", name: "入金(請求への入金)", category: "daily_work" },
  { resource: "sales_cash_receipts", name: "入金(単体入金)", category: "daily_work" },
  { resource: "purchase_payment_disbursements", name: "支払の消込", category: "daily_work" },
  { resource: "inventory_stock", name: "入出庫・品質区分変更・廃棄・返品", category: "daily_work" },
  { resource: "inventory_instructions", name: "入荷指示・出荷指示", category: "daily_work" },
  { resource: "purchase_recognitions", name: "仕入", category: "daily_work" },
  // BUG-112: 取引先の納品先(承認フローは「取引先マスタ」のものを使う。分岐条件 documentKind = DELIVERY_DESTINATION)
  { resource: "master_delivery_destinations", name: "取引先の納品先", category: "business_master" },
];
