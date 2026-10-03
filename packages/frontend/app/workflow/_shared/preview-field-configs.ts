// targetTypeごとの承認プレビュー表示フィールド定義。
// backendのworkflow-engine/target-adapters/registry.ts(targetType→TargetAdapter)と
// 対称の設計で、承認タスク画面・申請履歴画面どちらのプレビューもこのレジストリを参照する。
// 新しいマスタへ承認機能を展開する際は、ここへ1エントリ追加するだけで両画面のプレビューに反映される。

export interface PreviewFieldConfig {
  key: string;
  label: string;
  format?: "currency" | "date";
}

const PARTNER_FIELDS: PreviewFieldConfig[] = [
  { key: "name", label: "取引先名" },
  { key: "type", label: "区分" },
  { key: "creditLimit", label: "与信限度額", format: "currency" },
  { key: "closingDay", label: "締め日" },
  { key: "paymentMonthOffset", label: "支払サイト(ヶ月後)" },
  { key: "paymentDay", label: "支払日" },
  { key: "postalCode", label: "郵便番号" },
  { key: "address", label: "住所" },
  { key: "phone", label: "電話番号" },
  { key: "fax", label: "FAX" },
  { key: "paymentMethod", label: "支払方法" },
  { key: "qualifiedInvoiceNumber", label: "適格事業者番号" },
  { key: "corporateNumber", label: "法人番号" },
  { key: "contractDate", label: "契約開始日", format: "date" },
  { key: "memo", label: "備考" },
];

const UNIT_FIELDS: PreviewFieldConfig[] = [
  { key: "code", label: "単位コード" },
  { key: "name", label: "単位名" },
  { key: "status", label: "ステータス" },
];

const LOCATION_FIELDS: PreviewFieldConfig[] = [
  { key: "id", label: "ロケーションコード" },
  { key: "warehouseId", label: "倉庫ID" },
  { key: "name", label: "ロケーション名" },
  { key: "memo", label: "備考" },
  { key: "status", label: "ステータス" },
];

const STRUCTURE_FIELDS: PreviewFieldConfig[] = [
  { key: "parentItemId", label: "親品目コード" },
  { key: "childItemId", label: "構成部品(子品目)コード" },
  { key: "revision", label: "リビジョン" },
  { key: "quantityRequired", label: "必要数量(員数)" },
  { key: "validFrom", label: "適用開始日", format: "date" },
  { key: "validTo", label: "適用終了日", format: "date" },
  { key: "memo", label: "設計変更メモ" },
  { key: "status", label: "ステータス" },
];

const CONTACT_FIELDS: PreviewFieldConfig[] = [
  { key: "name", label: "担当者名" },
  { key: "contactType", label: "区分" },
  { key: "departmentName", label: "部署名" },
  { key: "email", label: "メールアドレス" },
  { key: "phone", label: "電話番号" },
  { key: "fax", label: "FAX" },
  { key: "memo", label: "備考" },
];

export const QUOTE_HEADER_FIELDS: PreviewFieldConfig[] = [
  { key: "title", label: "件名" },
  { key: "partnerId", label: "取引先ID" },
  { key: "quoteDate", label: "見積日", format: "date" },
  { key: "validUntil", label: "有効期限", format: "date" },
  { key: "totalAmount", label: "合計金額(税込)", format: "currency" },
  { key: "taxAmount", label: "消費税額", format: "currency" },
  { key: "memo", label: "備考" },
];

// Item7: 受注(targetType="sales_orders")。sourceQuoteIdは対象見積の参照用トレーサビリティ
export const SALES_ORDER_HEADER_FIELDS: PreviewFieldConfig[] = [
  { key: "title", label: "件名" },
  { key: "partnerId", label: "取引先ID" },
  { key: "sourceQuoteId", label: "対象見積ID" },
  { key: "orderDate", label: "受注日", format: "date" },
  { key: "deliveryDate", label: "納品予定日", format: "date" },
  { key: "deliveryPlace", label: "納品場所" },
  { key: "paymentTerms", label: "支払条件" },
  { key: "totalAmount", label: "合計金額(税込)", format: "currency" },
  { key: "taxAmount", label: "消費税額", format: "currency" },
  { key: "memo", label: "備考" },
];

// Item6: 在庫マスタ(入庫/出庫、targetType="inventory_stock"共通)。
// 入庫はreceivedDate、出庫はshippedDateを持つため両方を定義しておき、
// 該当しない方はformatValue()側で値なし("-")として扱われる
export const INVENTORY_RECEIPT_HEADER_FIELDS: PreviewFieldConfig[] = [
  { key: "receivedDate", label: "入庫日", format: "date" },
  { key: "supplierInvoiceNumber", label: "仕入先請求書番号" },
  { key: "memo", label: "備考" },
];

export const INVENTORY_SHIPMENT_HEADER_FIELDS: PreviewFieldConfig[] = [
  { key: "shippedDate", label: "出庫日", format: "date" },
  { key: "memo", label: "備考" },
];

// Item6 Phase6-4: 出荷指示/入荷指示(外部倉庫向け、targetType="inventory_stock"を入出庫と共有)。
// item_shipment_instructions/item_receipt_instructionsのヘッダー(明細はInventoryStockItemsTable)
export const INVENTORY_SHIPMENT_INSTRUCTION_HEADER_FIELDS: PreviewFieldConfig[] = [
  { key: "partnerId", label: "得意先ID" },
  { key: "warehouseId", label: "倉庫ID" },
  { key: "instructedShipDate", label: "出荷予定日", format: "date" },
  { key: "memo", label: "備考" },
];

export const INVENTORY_RECEIPT_INSTRUCTION_HEADER_FIELDS: PreviewFieldConfig[] = [
  { key: "partnerId", label: "仕入先ID" },
  { key: "warehouseId", label: "倉庫ID" },
  { key: "instructedReceiveDate", label: "入荷予定日", format: "date" },
  { key: "memo", label: "備考" },
];

// Item6 Phase6-3-2: 品質区分変更(破損・不良品管理、targetType="inventory_stock"を入出庫と共有)。
// stock_auditsと同じ単一行のため明細フィールドは持たない
export const INVENTORY_RECLASSIFICATION_HEADER_FIELDS: PreviewFieldConfig[] = [
  { key: "itemId", label: "品目ID" },
  { key: "warehouseId", label: "倉庫ID" },
  { key: "locationId", label: "ロケーションID" },
  { key: "lotNumber", label: "ロット番号" },
  { key: "fromQualityStatus", label: "変更元の品質区分" },
  { key: "toQualityStatus", label: "変更先の品質区分" },
  { key: "quantity", label: "数量" },
  { key: "memo", label: "備考" },
];

// Item6 Phase6-3-3: 廃棄決定(targetType="inventory_stock"を入出庫と共有)。
// stock_reclassificationsと同じ単一行のため明細フィールドは持たない
export const INVENTORY_DISPOSAL_HEADER_FIELDS: PreviewFieldConfig[] = [
  { key: "itemId", label: "品目ID" },
  { key: "warehouseId", label: "倉庫ID" },
  { key: "locationId", label: "ロケーションID" },
  { key: "lotNumber", label: "ロット番号" },
  { key: "qualityStatus", label: "品質区分" },
  { key: "quantity", label: "数量" },
  { key: "memo", label: "廃棄理由" },
];

// Item6 Phase6-3-3: 返品(仕入先へ返品/得意先から返品、targetType="inventory_stock"を入出庫と共有)。
// stock_reclassificationsと同じ単一行のため明細フィールドは持たない
export const INVENTORY_RETURN_HEADER_FIELDS: PreviewFieldConfig[] = [
  { key: "itemId", label: "品目ID" },
  { key: "warehouseId", label: "倉庫ID" },
  { key: "locationId", label: "ロケーションID" },
  { key: "lotNumber", label: "ロット番号" },
  { key: "qualityStatus", label: "品質区分" },
  { key: "direction", label: "返品方向" },
  { key: "quantity", label: "数量" },
  { key: "returnReason", label: "返品理由" },
  { key: "returnDate", label: "返品日", format: "date" },
  { key: "memo", label: "備考" },
];

// Item6 Phase6-3: 棚卸(在庫調整、targetType="inventory_audit")。
// 入出庫と異なりヘッダー+明細ではなく単一行のため、フィールドは対象自体の情報に加えて
// 理論数量/実棚数量/差異を含める(明細テーブルは持たず、この1リストで全て表示する)
export const INVENTORY_AUDIT_FIELDS: PreviewFieldConfig[] = [
  { key: "itemId", label: "品目ID" },
  { key: "warehouseId", label: "倉庫ID" },
  { key: "locationId", label: "ロケーションID" },
  { key: "lotNumber", label: "ロット番号" },
  { key: "qualityStatus", label: "品質区分" },
  { key: "theoreticalQuantity", label: "理論数量" },
  { key: "countedQuantity", label: "実棚数量" },
  { key: "differenceQuantity", label: "差異数量" },
  { key: "memo", label: "備考" },
];

const PREVIEW_FIELD_REGISTRY: Record<string, PreviewFieldConfig[]> = {
  master_partners: PARTNER_FIELDS,
  master_units: UNIT_FIELDS,
  master_locations: LOCATION_FIELDS,
  master_contacts: CONTACT_FIELDS,
  master_structures: STRUCTURE_FIELDS,
};

export function getPreviewFields(targetType: string): PreviewFieldConfig[] | null {
  return PREVIEW_FIELD_REGISTRY[targetType] || null;
}

// 💡 フォールバック: レジストリに未登録のtargetType(今後追加されるマスタ等)が来た場合に、
// 中身が一切表示されなくなることを避けるための安全網。トップレベルのプリミティブな
// キー/値だけを汎用的に列挙する(配列・オブジェクトのネストは対象外)。
export function buildGenericFields(
  data: Record<string, unknown> | null | undefined,
): PreviewFieldConfig[] {
  if (!data || typeof data !== "object") return [];
  return Object.keys(data)
    .filter((key) => {
      const value = (data as Record<string, unknown>)[key];
      return (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      );
    })
    .map((key) => ({ key, label: key }));
}
