// REQ-018: 画面(メニュー)を持たない申請の種類。承認フローの「対象申請種別」と、承認タスク・申請履歴の種類の表示に使う
// (画面の一覧 /api/permissions/screens には入らないため、ここで足す)
export const APPROVAL_ONLY_REQUEST_TYPES: Array<{ resource: string; name: string; category: string }> = [
  { resource: "sales_payment_receipts", name: "入金(請求への入金)", category: "daily_work" },
  { resource: "sales_cash_receipts", name: "入金(単体入金)", category: "daily_work" },
  { resource: "purchase_payment_disbursements", name: "支払の消込", category: "daily_work" },
];
