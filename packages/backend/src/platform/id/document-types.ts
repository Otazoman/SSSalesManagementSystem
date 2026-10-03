// 伝票番号(会社設定で種別ごとにフォーマット可能)の対象一覧を1箇所で管理する。
// 売上・発注・仕入・請求・支払(Item8-11未実装)は、実装時にここへ1行追加するだけで
// 会社設定・自動採番の両方に対応できる設計にしている。
export interface DocumentTypeDefinition {
  key: string;
  label: string;
  defaultPrefix: string;
}

export const DOCUMENT_TYPES: DocumentTypeDefinition[] = [
  { key: "quote", label: "見積", defaultPrefix: "QT" },
  { key: "sales_order", label: "受注", defaultPrefix: "SO" },
  { key: "purchase_requisition", label: "購買申請", defaultPrefix: "PR" },
  { key: "purchase_order", label: "発注", defaultPrefix: "PO" },
  { key: "shipment_instruction", label: "出荷指示書", defaultPrefix: "SI" },
  { key: "receipt_instruction", label: "入荷指示書", defaultPrefix: "RI" },
  { key: "shipment", label: "出庫(出荷実績含む)", defaultPrefix: "SH" },
  { key: "receipt", label: "入庫(入荷実績含む)", defaultPrefix: "RC" },
  { key: "audit", label: "棚卸", defaultPrefix: "TK" },
  { key: "disposal", label: "廃棄", defaultPrefix: "DP" },
  { key: "reclassification", label: "品質区分変更", defaultPrefix: "RQ" },
  { key: "return", label: "返品", defaultPrefix: "RT" },
  { key: "approval_request", label: "承認申請", defaultPrefix: "AP" },
  { key: "sales_invoice", label: "売上", defaultPrefix: "UR" },
  { key: "purchase_recognition", label: "仕入", defaultPrefix: "SR" },
  { key: "billing", label: "請求", defaultPrefix: "BL" },
  { key: "payment", label: "支払", defaultPrefix: "PM" },
  // 追加要望L-1-a: 単体入金(請求を介さない入金)。"receipt"は入庫で使用済みのため別キー
  { key: "cash_receipt", label: "入金(単体入金)", defaultPrefix: "RV" },
  // 追加要望M-1: 商談管理
  { key: "deal", label: "商談", defaultPrefix: "DL" },
];
