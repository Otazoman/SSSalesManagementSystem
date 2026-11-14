// BUG-089: 承認のプレビュー(承認タスク・申請履歴)で、申請の内容を全ての項目で出すための設定。
// 申請の種類(targetType)ごとに、ヘッダーと明細の「表示する項目」と「表示しない項目(理由つき)」を持つ。
//
// 漏れを防ぐため、backend のテスト(src/workflow-engine/target-adapters/preview-specs-coverage.test.ts)が、
// table・items.table に書いた DB の表の全ての列が「表示する項目」か「表示しない項目」に入っていることを確かめる。
// フォームに項目を足して DB の列を足した時に、ここへの追加を忘れるとそのテストが失敗する。
// このファイルは backend のテストからも読み込むため、他のファイルを import しない。
//
// 設定に無い項目がデータにあれば、プレビューの末尾に「その他」として項目名のまま出す(隠さない)。

export type PreviewRef =
  | "partner"
  | "warehouse"
  | "location"
  | "item"
  | "unit"
  | "account"
  | "taxCategory"
  | "project"
  | "employee"
  | "user"
  | "department"
  | "businessLocation";

export interface PreviewFieldSpec {
  label: string;
  format?: "text" | "currency" | "number" | "date" | "boolean" | "multiline" | "list";
  /** 番号の項目。backend が引いた名前(displayNames)を「名前(番号)」で出す */
  ref?: PreviewRef;
  /** コードの値を日本語にする(例: 入力の種類) */
  options?: Record<string, string>;
}

export interface PreviewSpec {
  /** backend の schema のエクスポート名(漏れを確かめるテストで使う) */
  table: string;
  header: Record<string, PreviewFieldSpec>;
  /** 表示しない項目 → 理由 */
  hidden: Record<string, string>;
  items?: {
    table: string;
    columns: Record<string, PreviewFieldSpec>;
    hidden: Record<string, string>;
  };
}

// ---- 共通の「表示しない項目」 ----
const AUDIT_HIDDEN: Record<string, string> = {
  createdAt: "記録の日時(監査用)",
  createdBy: "記録した人(監査用)",
  updatedAt: "記録の日時(監査用)",
  updatedBy: "記録した人(監査用)",
};
const APPROVAL_HIDDEN: Record<string, string> = {
  status: "伝票の状態(申請の状態として別に出す)",
  currentApprovalLayer: "承認の段(承認の進み具合として別に出す)",
  approvalFlowId: "承認フロー(承認の進み具合として別に出す)",
};
// 申請の時に退避した保存データにだけある項目(画面の保存処理の都合で送っている別名など)
const SAVE_ONLY_HIDDEN: Record<string, string> = {
  customerId: "取引先の別名(取引先として出す)",
  customerName: "取引先名の別名(取引先として出す)",
  company_department: "担当者所属部署の別名(担当者所属部署として出す)",
  isRevisionUp: "改定するかの指示(保存の時だけ使う)",
  attachments: "添付ファイル(添付として別に出す)",
  items: "明細(明細として別に出す)",
};
const ITEM_HIDDEN: Record<string, string> = {
  id: "明細の内部番号",
  sortOrder: "明細の並び順(表の並びで出す)",
};

const INPUT_TYPE_OPTIONS = { MASTER: "品目マスタ", DIRECT: "直接入力" };

// ---- 伝票の共通の項目 ----
const COMPANY_FIELDS: Record<string, PreviewFieldSpec> = {
  companyName: { label: "自社 会社名" },
  companyDepartment: { label: "担当者所属部署", ref: "department" },
  companyAddress: { label: "自社 住所" },
  companyTel: { label: "自社 TEL" },
  companyFax: { label: "自社 FAX" },
};

const SALES_ITEM_COLUMNS: Record<string, PreviewFieldSpec> = {
  itemId: { label: "品目", ref: "item" },
  itemName: { label: "品目名" },
  inputType: { label: "入力の種類", options: INPUT_TYPE_OPTIONS },
  quantity: { label: "数量", format: "number" },
  unitCode: { label: "単位", ref: "unit" },
  unitPrice: { label: "単価(税抜)", format: "currency" },
  costPrice: { label: "原価", format: "currency" },
  amount: { label: "金額", format: "currency" },
  taxCategoryCode: { label: "税区分", ref: "taxCategory" },
  memo: { label: "明細備考" },
};

export const PREVIEW_SPECS: Record<string, PreviewSpec> = {
  // 見積(sales/quotes)
  sales_quotes: {
    table: "quotes",
    header: {
      id: { label: "見積番号" },
      title: { label: "件名" },
      partnerId: { label: "得意先", ref: "partner" },
      quoteDate: { label: "見積作成日", format: "date" },
      validUntil: { label: "有効期限", format: "date" },
      projectId: { label: "プロジェクト", ref: "project" },
      salesPersonEmployeeNumber: { label: "自社担当者", ref: "employee" },
      inputPersonEmployeeNumber: { label: "入力者", ref: "employee" },
      ...COMPANY_FIELDS,
      deliveryDate: { label: "納期" },
      deliveryPlace: { label: "納品場所" },
      paymentTerms: { label: "支払条件" },
      terms: { label: "取引条件", format: "multiline" },
      totalAmount: { label: "合計金額(税込)", format: "currency" },
      taxAmount: { label: "消費税額", format: "currency" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: { ...AUDIT_HIDDEN, ...APPROVAL_HIDDEN, ...SAVE_ONLY_HIDDEN },
    items: {
      table: "quoteItems",
      columns: SALES_ITEM_COLUMNS,
      hidden: { ...ITEM_HIDDEN, quoteId: "見積番号(ヘッダーに出す)" },
    },
  },

  // 受注(sales/orders)
  sales_orders: {
    table: "salesOrders",
    header: {
      id: { label: "受注番号" },
      title: { label: "件名" },
      partnerId: { label: "得意先", ref: "partner" },
      sourceQuoteId: { label: "元の見積番号" },
      orderDate: { label: "受注日", format: "date" },
      projectId: { label: "プロジェクト", ref: "project" },
      salesPersonEmployeeNumber: { label: "自社担当者", ref: "employee" },
      inputPersonEmployeeNumber: { label: "入力者", ref: "employee" },
      ...COMPANY_FIELDS,
      deliveryDate: { label: "納期" },
      deliveryPlace: { label: "納品場所" },
      deliveryDestinationId: { label: "納品先(登録済みの納品先)" },
      paymentTerms: { label: "支払条件" },
      isPrepaid: { label: "前受(入金済みで受注)", format: "boolean" },
      terms: { label: "取引条件", format: "multiline" },
      totalAmount: { label: "合計金額(税込)", format: "currency" },
      taxAmount: { label: "消費税額", format: "currency" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: {
      ...AUDIT_HIDDEN,
      ...APPROVAL_HIDDEN,
      ...SAVE_ONLY_HIDDEN,
      orderAcknowledgmentR2Path: "注文請書のファイルの場所(内部用)",
      shipmentStatus: "出荷の状況(後の処理で決まる)",
      prepaidAt: "前受の入金日時(入金の処理で決まる)",
    },
    items: {
      table: "salesOrderItems",
      columns: {
        ...SALES_ITEM_COLUMNS,
        accountCode: { label: "勘定科目", ref: "account" },
        deliveryDate: { label: "明細の納期", format: "date" },
        warehouseAllocationRequest: { label: "引当の指定" },
      },
      hidden: {
        ...ITEM_HIDDEN,
        salesOrderId: "受注番号(ヘッダーに出す)",
        sourceQuoteItemId: "元の見積明細とのつながり(内部番号)",
        backorderedQuantity: "欠品の数量(引当の処理で決まる)",
      },
    },
  },

  // 売上(sales/invoices)
  sales_invoices: {
    table: "salesInvoices",
    header: {
      id: { label: "売上番号" },
      title: { label: "件名" },
      documentType: {
        label: "伝票の種類",
        options: { SALES: "売上", RETURN: "返品", DISCOUNT: "値引", REVERSAL: "赤伝" },
      },
      originalInvoiceId: { label: "元の売上番号" },
      partnerId: { label: "得意先", ref: "partner" },
      salesOrderId: { label: "受注番号" },
      invoiceDate: { label: "売上日", format: "date" },
      projectId: { label: "プロジェクト", ref: "project" },
      salesPersonEmployeeNumber: { label: "自社担当者", ref: "employee" },
      inputPersonEmployeeNumber: { label: "入力者", ref: "employee" },
      ...COMPANY_FIELDS,
      paymentTerms: { label: "支払条件" },
      totalAmount: { label: "合計金額(税込)", format: "currency" },
      taxAmount: { label: "消費税額", format: "currency" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: {
      ...AUDIT_HIDDEN,
      ...APPROVAL_HIDDEN,
      ...SAVE_ONLY_HIDDEN,
      billingStatus: "請求の状況(請求の処理で決まる)",
    },
    items: {
      table: "salesInvoiceItems",
      columns: { ...SALES_ITEM_COLUMNS, accountCode: { label: "勘定科目", ref: "account" } },
      hidden: {
        ...ITEM_HIDDEN,
        salesInvoiceId: "売上番号(ヘッダーに出す)",
        sourceOrderItemId: "元の受注明細とのつながり(内部番号)",
      },
    },
  },

  // 購買申請(purchase/requisitions)
  purchase_requisitions: {
    table: "purchaseRequests",
    header: {
      id: { label: "購買申請番号" },
      title: { label: "件名" },
      requestType: { label: "申請の種類" },
      applicantId: { label: "申請者", ref: "user" },
      departmentSurrogateId: { label: "申請部署", ref: "department" },
      partnerId: { label: "仕入先", ref: "partner" },
      partnerName: { label: "仕入先名" },
      partnerInputType: { label: "仕入先の入力の種類", options: INPUT_TYPE_OPTIONS },
      projectId: { label: "プロジェクト", ref: "project" },
      inputPersonEmployeeNumber: { label: "入力者", ref: "employee" },
      isDirectShipment: { label: "直送", format: "boolean" },
      directSalesOrderId: { label: "直送する受注番号" },
      totalAmount: { label: "合計金額", format: "currency" },
      taxAmount: { label: "消費税額", format: "currency" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: { ...AUDIT_HIDDEN, ...APPROVAL_HIDDEN, ...SAVE_ONLY_HIDDEN },
    items: {
      table: "purchaseRequestItems",
      columns: {
        itemId: { label: "品目", ref: "item" },
        itemName: { label: "品目名" },
        inputType: { label: "入力の種類", options: INPUT_TYPE_OPTIONS },
        quantity: { label: "数量", format: "number" },
        unitCode: { label: "単位", ref: "unit" },
        estimatedUnitPrice: { label: "見込み単価", format: "currency" },
        taxCategoryCode: { label: "税区分", ref: "taxCategory" },
        accountCode: { label: "勘定科目", ref: "account" },
        memo: { label: "明細備考" },
      },
      hidden: {
        ...ITEM_HIDDEN,
        requestId: "購買申請番号(ヘッダーに出す)",
        salesOrderItemId: "受注明細とのつながり(内部番号)",
      },
    },
  },

  // 発注(purchase/orders)
  purchase_orders: {
    table: "orders",
    header: {
      id: { label: "発注番号" },
      title: { label: "件名" },
      requestId: { label: "購買申請番号" },
      partnerId: { label: "仕入先", ref: "partner" },
      orderDate: { label: "発注日", format: "date" },
      orderType: { label: "発注の種類" },
      projectId: { label: "プロジェクト", ref: "project" },
      purchasePersonEmployeeNumber: { label: "自社担当者", ref: "employee" },
      inputPersonEmployeeNumber: { label: "入力者", ref: "employee" },
      ...COMPANY_FIELDS,
      deliveryDate: { label: "納期" },
      deliveryPlace: { label: "納品場所" },
      deliveryLocationId: { label: "納品先の拠点", ref: "businessLocation" },
      deliveryWarehouseId: { label: "納品先の倉庫", ref: "warehouse" },
      isDirectShipment: { label: "直送", format: "boolean" },
      directSalesOrderId: { label: "直送する受注番号" },
      paymentTerms: { label: "支払条件" },
      totalAmount: { label: "合計金額(税込)", format: "currency" },
      taxAmount: { label: "消費税額", format: "currency" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: {
      ...AUDIT_HIDDEN,
      ...APPROVAL_HIDDEN,
      ...SAVE_ONLY_HIDDEN,
      paidAt: "支払の日時(支払の処理で決まる)",
      isPaid: "支払済み(支払の処理で決まる)",
      orderDocumentR2Path: "発注書のファイルの場所(内部用)",
    },
    items: {
      table: "orderItems",
      columns: {
        itemId: { label: "品目", ref: "item" },
        itemName: { label: "品目名" },
        inputType: { label: "入力の種類", options: INPUT_TYPE_OPTIONS },
        quantity: { label: "数量", format: "number" },
        unitCode: { label: "単位", ref: "unit" },
        unitPrice: { label: "単価(税抜)", format: "currency" },
        taxCategoryCode: { label: "税区分", ref: "taxCategory" },
        accountCode: { label: "勘定科目", ref: "account" },
        requestedDeliveryDate: { label: "希望納期", format: "date" },
        answeredDeliveryDate: { label: "回答納期", format: "date" },
        memo: { label: "明細備考" },
      },
      hidden: {
        ...ITEM_HIDDEN,
        orderId: "発注番号(ヘッダーに出す)",
        purchaseRequestItemId: "購買申請の明細とのつながり(内部番号)",
        salesOrderItemId: "受注明細とのつながり(内部番号)",
      },
    },
  },

  // 仕入(purchase/receipts)
  purchase_recognitions: {
    table: "purchaseRecognitions",
    header: {
      id: { label: "仕入番号" },
      title: { label: "件名" },
      documentType: {
        label: "伝票の種類",
        options: { PURCHASE: "仕入", RETURN: "返品", DISCOUNT: "値引", REVERSAL: "赤伝" },
      },
      originalRecognitionId: { label: "元の仕入番号" },
      partnerId: { label: "仕入先", ref: "partner" },
      orderId: { label: "発注番号" },
      recognitionDate: { label: "仕入日", format: "date" },
      projectId: { label: "プロジェクト", ref: "project" },
      purchasePersonEmployeeNumber: { label: "自社担当者", ref: "employee" },
      inputPersonEmployeeNumber: { label: "入力者", ref: "employee" },
      ...COMPANY_FIELDS,
      paymentTerms: { label: "支払条件" },
      totalAmount: { label: "合計金額(税込)", format: "currency" },
      taxAmount: { label: "消費税額", format: "currency" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: {
      ...AUDIT_HIDDEN,
      ...APPROVAL_HIDDEN,
      ...SAVE_ONLY_HIDDEN,
      paymentStatus: "支払の状況(支払の処理で決まる)",
      receiptIds: "対象の入庫(内部番号)",
    },
    items: {
      table: "purchaseRecognitionItems",
      columns: { ...SALES_ITEM_COLUMNS, accountCode: { label: "勘定科目", ref: "account" } },
      hidden: {
        ...ITEM_HIDDEN,
        purchaseRecognitionId: "仕入番号(ヘッダーに出す)",
        sourceOrderItemId: "元の発注明細とのつながり(内部番号)",
      },
    },
  },
};

// ---- 在庫(入庫・出庫・品質区分変更・廃棄・返品・入荷指示・出荷指示・棚卸) ----
const QUALITY_OPTIONS = { NORMAL: "良品", DAMAGED: "破損品", QUARANTINE: "検品待ち" };
const INSPECTION_OPTIONS = { PASSED: "良品", DAMAGED: "破損", QUARANTINE: "検品待ち" };
const STOCK_HIDDEN = { ...AUDIT_HIDDEN, ...APPROVAL_HIDDEN, qrCodeKey: "QR コードの読み取り用の番号(内部用)" };
// 1件の在庫の記録(品質区分変更・廃棄・返品・棚卸)の共通の項目
const STOCK_ROW_FIELDS: Record<string, PreviewFieldSpec> = {
  id: { label: "番号" },
  itemId: { label: "品目", ref: "item" },
  warehouseId: { label: "倉庫", ref: "warehouse" },
  locationId: { label: "ロケーション", ref: "location" },
  lotNumber: { label: "ロット番号" },
  accountCode: { label: "勘定科目", ref: "account" },
};

const INVENTORY_SPECS: Record<string, PreviewSpec> = {
  "inventory_stock:receipt": {
    table: "itemReceiptHeaders",
    header: {
      id: { label: "入庫番号" },
      receivedDate: { label: "入庫日", format: "date" },
      partnerId: { label: "仕入先", ref: "partner" },
      orderId: { label: "発注番号" },
      receiptInstructionId: { label: "入荷指示番号" },
      sourceWarehouseId: { label: "移動元倉庫", ref: "warehouse" },
      supplierInvoiceNumber: { label: "仕入先の納品書番号" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: { ...STOCK_HIDDEN, attachmentR2Path: "添付ファイルの場所(内部用)" },
    items: {
      table: "itemReceiptItems",
      columns: {
        itemId: { label: "品目", ref: "item" },
        warehouseId: { label: "倉庫", ref: "warehouse" },
        locationId: { label: "ロケーション", ref: "location" },
        lotNumber: { label: "ロット番号" },
        receivedQuantity: { label: "数量", format: "number" },
        inspectionStatus: { label: "検品", options: INSPECTION_OPTIONS },
        inspectionMemo: { label: "検品メモ" },
        accountCode: { label: "勘定科目", ref: "account" },
        memo: { label: "明細備考" },
      },
      hidden: {
        ...ITEM_HIDDEN,
        receiptHeaderId: "入庫番号(ヘッダーに出す)",
        orderItemId: "発注明細とのつながり(内部番号)",
        actualProductPhotoR2Path: "現物の写真の場所(内部用)",
        itemAttachmentR2Path: "明細の添付の場所(内部用)",
        qrCodeKey: "QR コードの読み取り用の番号(内部用)",
      },
    },
  },
  "inventory_stock:shipment": {
    table: "itemShipmentHeaders",
    header: {
      id: { label: "出庫番号" },
      shippedDate: { label: "出庫日", format: "date" },
      partnerId: { label: "得意先", ref: "partner" },
      salesOrderId: { label: "受注番号" },
      shipmentInstructionId: { label: "出荷指示番号" },
      destinationWarehouseId: { label: "移動先倉庫", ref: "warehouse" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: {
      ...STOCK_HIDDEN,
      deliveryNoteR2Path: "納品書のファイルの場所(内部用)",
      directReceiptHeaderId: "直送完了の対になる入庫(内部番号)",
    },
    items: {
      table: "itemShipmentItems",
      columns: {
        itemId: { label: "品目", ref: "item" },
        warehouseId: { label: "倉庫", ref: "warehouse" },
        locationId: { label: "ロケーション", ref: "location" },
        lotNumber: { label: "ロット番号" },
        qualityStatus: { label: "品質区分", options: QUALITY_OPTIONS },
        shippedQuantity: { label: "数量", format: "number" },
        accountCode: { label: "勘定科目", ref: "account" },
        memo: { label: "明細備考" },
      },
      hidden: {
        ...ITEM_HIDDEN,
        shipmentHeaderId: "出庫番号(ヘッダーに出す)",
        salesOrderItemId: "受注明細とのつながり(内部番号)",
        qrCodeKey: "QR コードの読み取り用の番号(内部用)",
      },
    },
  },
  "inventory_stock:reclassification": {
    table: "stockReclassifications",
    header: {
      ...STOCK_ROW_FIELDS,
      fromQualityStatus: { label: "変更前の品質区分", options: QUALITY_OPTIONS },
      toQualityStatus: { label: "変更後の品質区分", options: QUALITY_OPTIONS },
      quantity: { label: "数量", format: "number" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: STOCK_HIDDEN,
  },
  "inventory_stock:disposal": {
    table: "stockDisposals",
    header: {
      ...STOCK_ROW_FIELDS,
      qualityStatus: { label: "品質区分", options: QUALITY_OPTIONS },
      quantity: { label: "数量", format: "number" },
      memo: { label: "廃棄理由", format: "multiline" },
    },
    hidden: STOCK_HIDDEN,
  },
  "inventory_stock:return": {
    table: "stockReturns",
    header: {
      ...STOCK_ROW_FIELDS,
      qualityStatus: { label: "品質区分", options: QUALITY_OPTIONS },
      direction: { label: "返品の方向", options: { OUTBOUND: "仕入先へ返品", INBOUND: "得意先から返品" } },
      quantity: { label: "数量", format: "number" },
      returnReason: { label: "返品理由" },
      returnDate: { label: "返品日", format: "date" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: STOCK_HIDDEN,
  },
  "inventory_instructions:shipment": {
    table: "itemShipmentInstructions",
    header: {
      id: { label: "出荷指示番号" },
      instructedShipDate: { label: "出荷予定日", format: "date" },
      partnerId: { label: "得意先", ref: "partner" },
      warehouseId: { label: "出荷元の倉庫", ref: "warehouse" },
      salesOrderId: { label: "受注番号" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: { ...STOCK_HIDDEN, instructionDocumentR2Path: "指示書のファイルの場所(内部用)" },
    items: {
      table: "itemShipmentInstructionItems",
      columns: {
        itemId: { label: "品目", ref: "item" },
        lotNumber: { label: "ロット番号" },
        instructedQuantity: { label: "指示数量", format: "number" },
        accountCode: { label: "勘定科目", ref: "account" },
        memo: { label: "明細備考" },
      },
      hidden: {
        ...ITEM_HIDDEN,
        instructionHeaderId: "出荷指示番号(ヘッダーに出す)",
        salesOrderItemId: "受注明細とのつながり(内部番号)",
      },
    },
  },
  "inventory_instructions:receipt": {
    table: "itemReceiptInstructions",
    header: {
      id: { label: "入荷指示番号" },
      instructedReceiveDate: { label: "入荷予定日", format: "date" },
      partnerId: { label: "仕入先", ref: "partner" },
      warehouseId: { label: "入荷先の倉庫", ref: "warehouse" },
      orderId: { label: "発注番号" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: { ...STOCK_HIDDEN, instructionDocumentR2Path: "指示書のファイルの場所(内部用)" },
    items: {
      table: "itemReceiptInstructionItems",
      columns: {
        itemId: { label: "品目", ref: "item" },
        lotNumber: { label: "ロット番号" },
        instructedQuantity: { label: "指示数量", format: "number" },
        accountCode: { label: "勘定科目", ref: "account" },
        memo: { label: "明細備考" },
      },
      hidden: {
        ...ITEM_HIDDEN,
        instructionHeaderId: "入荷指示番号(ヘッダーに出す)",
        orderItemId: "発注明細とのつながり(内部番号)",
      },
    },
  },
  inventory_audit: {
    table: "stockAudits",
    header: {
      ...STOCK_ROW_FIELDS,
      qualityStatus: { label: "品質区分", options: QUALITY_OPTIONS },
      theoreticalQuantity: { label: "理論数量", format: "number" },
      countedQuantity: { label: "実棚数量", format: "number" },
      differenceQuantity: { label: "差異数量", format: "number" },
      memo: { label: "備考", format: "multiline" },
    },
    hidden: STOCK_HIDDEN,
  },
};
Object.assign(PREVIEW_SPECS, INVENTORY_SPECS);

// ---- マスタ ----
const MASTER_STATUS_OPTIONS = { temporary: "仮登録(承認待ち)", active: "有効", suspended: "無効" };
const MASTER_HIDDEN: Record<string, string> = { ...AUDIT_HIDDEN };
const MASTER_STATUS: PreviewFieldSpec = { label: "状態(承認後)", options: MASTER_STATUS_OPTIONS };

const MASTER_SPECS: Record<string, PreviewSpec> = {
  master_partners: {
    table: "partners",
    header: {
      id: { label: "取引先コード" },
      name: { label: "取引先名" },
      type: { label: "区分", options: { CUSTOMER: "得意先", SUPPLIER: "仕入先", BOTH: "両方", PROSPECT: "見込み客" } },
      postalCode: { label: "郵便番号" },
      address: { label: "住所" },
      phone: { label: "電話番号" },
      fax: { label: "FAX" },
      creditLimit: { label: "与信限度額", format: "currency" },
      closingDay: { label: "締め日" },
      paymentMonthOffset: { label: "支払サイト(ヶ月後)" },
      paymentDay: { label: "支払日" },
      paymentMethod: { label: "支払方法" },
      qualifiedInvoiceNumber: { label: "適格請求書発行事業者の登録番号" },
      corporateNumber: { label: "法人番号" },
      antiSocialCheckStatus: {
        label: "反社チェックの結果",
        options: { UNCHECKED: "未確認", PASSED: "問題なし", WARNING: "要注意/審査保留" },
      },
      antiSocialCheckMemo: { label: "反社チェックのメモ", format: "multiline" },
      contractDate: { label: "契約開始日", format: "date" },
      contractValidTo: { label: "契約終了日", format: "date" },
      bankAccounts: { label: "振込先口座", format: "list" },
      status: MASTER_STATUS,
      memo: { label: "備考", format: "multiline" },
    },
    hidden: { ...MASTER_HIDDEN, attachments: "添付ファイル(添付として別に出す)" },
  },
  master_contacts: {
    table: "partnerContacts",
    header: {
      id: { label: "担当者コード" },
      partnerId: { label: "取引先", ref: "partner" },
      name: { label: "担当者名" },
      contactType: { label: "区分" },
      departmentName: { label: "部署名" },
      email: { label: "メールアドレス" },
      isEmailTarget: { label: "帳票のメールの宛先にする", format: "boolean" },
      phone: { label: "電話番号" },
      fax: { label: "FAX" },
      internalUserId: { label: "社内ユーザー", ref: "user" },
      status: MASTER_STATUS,
      memo: { label: "備考", format: "multiline" },
    },
    hidden: MASTER_HIDDEN,
  },
  master_units: {
    table: "units",
    header: {
      code: { label: "単位コード" },
      name: { label: "単位名" },
      status: MASTER_STATUS,
    },
    hidden: MASTER_HIDDEN,
  },
  master_locations: {
    table: "locations",
    header: {
      id: { label: "ロケーションコード" },
      warehouseId: { label: "倉庫", ref: "warehouse" },
      name: { label: "ロケーション名" },
      status: MASTER_STATUS,
      memo: { label: "備考", format: "multiline" },
    },
    hidden: MASTER_HIDDEN,
  },
  master_prices: {
    table: "itemPrices",
    header: {
      id: { label: "単価コード" },
      itemId: { label: "品目", ref: "item" },
      priceType: { label: "単価の種類", options: { SALES: "販売特値", PURCHASE: "仕入特値" } },
      partnerId: { label: "取引先(個別の単価)", ref: "partner" },
      minQuantity: { label: "適用する最低数量", format: "number" },
      unitPrice: { label: "単価", format: "currency" },
      unitCode: { label: "単位", ref: "unit" },
      validFrom: { label: "適用開始日", format: "date" },
      validTo: { label: "適用終了日", format: "date" },
      status: MASTER_STATUS,
    },
    hidden: MASTER_HIDDEN,
  },
  master_products: {
    table: "items",
    header: {
      id: { label: "品目コード" },
      name: { label: "品目名" },
      isSales: { label: "販売する", format: "boolean" },
      isPurchased: { label: "仕入れる", format: "boolean" },
      isService: { label: "サービス品(在庫を持たない)", format: "boolean" },
      baseUnitCode: { label: "基本の単位", ref: "unit" },
      taxCategoryCode: { label: "税区分", ref: "taxCategory" },
      accountCode: { label: "勘定科目", ref: "account" },
      productBarcode: { label: "バーコード" },
      supplierId: { label: "主な仕入先", ref: "partner" },
      supplierPartNumber: { label: "仕入先の品番" },
      originalPurchasedItemId: { label: "元の仕入品目", ref: "item" },
      status: MASTER_STATUS,
      memo: { label: "備考", format: "multiline" },
    },
    hidden: MASTER_HIDDEN,
  },
  master_accounts: {
    table: "accounts",
    header: {
      code: { label: "勘定科目コード" },
      name: { label: "勘定科目名" },
      externalMappingCode: { label: "会計ソフトの科目コード" },
      status: MASTER_STATUS,
      memo: { label: "備考", format: "multiline" },
    },
    hidden: MASTER_HIDDEN,
  },
  master_warehouses: {
    table: "warehouses",
    header: {
      id: { label: "倉庫コード" },
      name: { label: "倉庫名" },
      warehouseType: { label: "倉庫区分", options: { INTERNAL: "自社倉庫", EXTERNAL: "外部倉庫", DIRECT: "直送" } },
      postalCode: { label: "郵便番号" },
      address: { label: "住所" },
      phoneNumber: { label: "電話番号" },
      faxNumber: { label: "FAX" },
      email: { label: "メールアドレス" },
      businessStartTime: { label: "営業開始時刻" },
      businessEndTime: { label: "営業終了時刻" },
      storageRestrictions: { label: "保管の制限", format: "multiline" },
      status: MASTER_STATUS,
      memo: { label: "備考", format: "multiline" },
    },
    hidden: MASTER_HIDDEN,
  },
  master_business_locations: {
    table: "businessLocations",
    header: {
      id: { label: "営業拠点コード" },
      name: { label: "営業拠点名" },
      postalCode: { label: "郵便番号" },
      address: { label: "住所" },
      phoneNumber: { label: "電話番号" },
      faxNumber: { label: "FAX" },
      status: MASTER_STATUS,
      memo: { label: "備考", format: "multiline" },
    },
    hidden: MASTER_HIDDEN,
  },
  master_structures: {
    table: "itemStructures",
    header: {
      id: { label: "品目構成コード" },
      parentItemId: { label: "親品目", ref: "item" },
      childItemId: { label: "構成部品(子品目)", ref: "item" },
      quantityRequired: { label: "必要数量(員数)", format: "number" },
      revision: { label: "リビジョン" },
      validFrom: { label: "適用開始日", format: "date" },
      validTo: { label: "適用終了日", format: "date" },
      status: MASTER_STATUS,
      memo: { label: "設計変更メモ", format: "multiline" },
    },
    hidden: MASTER_HIDDEN,
  },
};
Object.assign(PREVIEW_SPECS, MASTER_SPECS);

const asRow = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * 在庫(inventory_stock・inventory_instructions)は、1つの申請の種類に複数の伝票が同居しているため、
 * データの項目から伝票を見分けて設定を選ぶ(以前の PreviewRenderer と同じ見分け方)
 */
export function resolvePreviewSpecKey(targetType: string, data: unknown): string {
  if (targetType !== "inventory_stock" && targetType !== "inventory_instructions") return targetType;
  const root = asRow(data);
  const header = asRow(root?.header) ?? root ?? {};
  if ("instructedShipDate" in header) return "inventory_instructions:shipment";
  if ("instructedReceiveDate" in header) return "inventory_instructions:receipt";
  if ("fromQualityStatus" in header) return "inventory_stock:reclassification";
  if ("direction" in header) return "inventory_stock:return";
  if ("shippedDate" in header) return "inventory_stock:shipment";
  if ("receivedDate" in header) return "inventory_stock:receipt";
  if ("quantity" in header) return "inventory_stock:disposal";
  return targetType;
}

/** 申請の種類とデータから、プレビューの設定を選ぶ(在庫はデータから伝票を見分ける) */
export function getPreviewSpec(targetType: string, data?: unknown): PreviewSpec | null {
  return PREVIEW_SPECS[resolvePreviewSpecKey(targetType, data)] ?? null;
}
