import React from "react";
import { DetailItem } from "../histories/_components/DetailItem";
import {
  getPreviewFields,
  buildGenericFields,
  QUOTE_HEADER_FIELDS,
  SALES_ORDER_HEADER_FIELDS,
  INVENTORY_RECEIPT_HEADER_FIELDS,
  INVENTORY_SHIPMENT_HEADER_FIELDS,
  INVENTORY_RECLASSIFICATION_HEADER_FIELDS,
  INVENTORY_DISPOSAL_HEADER_FIELDS,
  INVENTORY_RETURN_HEADER_FIELDS,
  INVENTORY_SHIPMENT_INSTRUCTION_HEADER_FIELDS,
  INVENTORY_RECEIPT_INSTRUCTION_HEADER_FIELDS,
  INVENTORY_AUDIT_FIELDS,
  PreviewFieldConfig,
} from "./preview-field-configs";

interface PreviewRendererProps {
  targetType: string;
  /** "task": 承認タスク画面(単一値表示) / "history": 申請履歴画面(新旧比較表示) */
  mode: "task" | "history";
  newData: unknown;
  oldData?: unknown;
  isUpdate?: boolean;
}

function formatValue(value: unknown, format?: PreviewFieldConfig["format"]): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (format === "currency") {
    const num = Number(value);
    return Number.isNaN(num) ? String(value) : `${num.toLocaleString()} 円`;
  }
  if (format === "date") {
    const date = new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("ja-JP");
  }
  return String(value);
}

function FieldGrid({
  data,
  fields,
  mode,
  oldData,
  isUpdate,
}: {
  data: Record<string, unknown>;
  fields: PreviewFieldConfig[];
  mode: "task" | "history";
  oldData?: Record<string, unknown> | null;
  isUpdate?: boolean;
}) {
  if (mode === "task") {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
        {fields.map((f) => (
          <div key={f.key}>
            <span className="text-slate-600 font-bold block text-[10px]">{f.label}:</span>
            <span className="font-semibold text-slate-900 text-xs">
              {formatValue(data[f.key], f.format) ?? "-"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
      {fields.map((f) => (
        <DetailItem
          key={f.key}
          label={f.label}
          newVal={formatValue(data[f.key], f.format)}
          oldVal={formatValue(oldData?.[f.key], f.format)}
          isUpdate={!!isUpdate}
        />
      ))}
    </div>
  );
}

interface QuoteItemLike {
  itemId?: string;
  itemName?: string;
  quantity?: number;
  unitPrice?: number;
}

function QuoteItemsTable({ items }: { items: unknown }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const typedItems = items as QuoteItemLike[];
  return (
    <div className="border-t pt-2 mt-2 space-y-1">
      <span className="text-slate-600 font-bold block text-[10px]">明細:</span>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-slate-600 text-left">
              <th className="pr-3 font-medium">品目</th>
              <th className="pr-3 font-medium">数量</th>
              <th className="pr-3 font-medium">単価</th>
            </tr>
          </thead>
          <tbody>
            {typedItems.map((item, idx) => (
              <tr key={idx} className="text-slate-800">
                <td className="pr-3 py-0.5">{item.itemName || item.itemId || "-"}</td>
                <td className="pr-3 py-0.5">{item.quantity ?? "-"}</td>
                <td className="pr-3 py-0.5">
                  {item.unitPrice !== undefined ? `${Number(item.unitPrice).toLocaleString()} 円` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface QuoteDataLike {
  header?: Record<string, unknown>;
  items?: unknown;
}

function QuotePreview({ newData, oldData, mode, isUpdate }: PreviewRendererProps) {
  const newQuote = newData as QuoteDataLike | null;
  const oldQuote = oldData as QuoteDataLike | null;
  const newHeader = newQuote?.header ?? (newData as Record<string, unknown>) ?? {};
  const oldHeader = oldQuote?.header ?? (oldData as Record<string, unknown>) ?? null;
  const items = newQuote?.items;

  return (
    <div className="space-y-2">
      <FieldGrid
        data={newHeader}
        fields={QUOTE_HEADER_FIELDS}
        mode={mode}
        oldData={oldHeader}
        isUpdate={isUpdate}
      />
      <QuoteItemsTable items={items} />
    </div>
  );
}

interface SalesOrderDataLike {
  header?: Record<string, unknown>;
  items?: unknown;
}

// Item7: 受注(targetType="sales_orders")。データ形はquotesと対称(header/items)のため
// QuotePreviewと同じ構成だが、フィールド定義(SALES_ORDER_HEADER_FIELDS)が異なる別コンポーネントとして
// 定義する(このファイルの既存の各targetType別関数の書き方に合わせる)
function SalesOrderPreview({ newData, oldData, mode, isUpdate }: PreviewRendererProps) {
  const newOrder = newData as SalesOrderDataLike | null;
  const oldOrder = oldData as SalesOrderDataLike | null;
  const newHeader = newOrder?.header ?? (newData as Record<string, unknown>) ?? {};
  const oldHeader = oldOrder?.header ?? (oldData as Record<string, unknown>) ?? null;
  const items = newOrder?.items;

  return (
    <div className="space-y-2">
      <FieldGrid
        data={newHeader}
        fields={SALES_ORDER_HEADER_FIELDS}
        mode={mode}
        oldData={oldHeader}
        isUpdate={isUpdate}
      />
      <QuoteItemsTable items={items} />
    </div>
  );
}

// K-2-a: ReceiptScanPanel.tsx/StockTable.tsxと同じラベル辞書(英語のまま表示されていたのを日本語表記に統一)
const INSPECTION_LABELS: Record<string, string> = {
  PASSED: "🟢 良品",
  DAMAGED: "🔴 破損",
  QUARANTINE: "🟡 検品待ち",
};

const QUALITY_LABELS: Record<string, string> = {
  NORMAL: "🟢 良品",
  DAMAGED: "🔴 破損品",
  QUARANTINE: "🟡 検品待ち",
};

interface InventoryStockItemLike {
  itemId?: string;
  locationId?: string;
  lotNumber?: string;
  qualityStatus?: string;
  receivedQuantity?: number;
  shippedQuantity?: number;
  instructedQuantity?: number;
  inspectionStatus?: string;
}

function InventoryStockItemsTable({ items }: { items: unknown }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const typedItems = items as InventoryStockItemLike[];
  const isShipment = typedItems.some((i) => i.shippedQuantity !== undefined);
  // Item6 Phase6-4: 出荷指示/入荷指示の明細はlocationIdを持たず、instructedQuantityのみ
  const isInstruction = typedItems.some((i) => i.instructedQuantity !== undefined);
  return (
    <div className="border-t pt-2 mt-2 space-y-1">
      <span className="text-slate-600 font-bold block text-[10px]">明細:</span>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-slate-500 text-left">
              <th className="pr-3 font-bold">品目</th>
              {!isInstruction && <th className="pr-3 font-bold">ロケーション</th>}
              <th className="pr-3 font-bold">ロット</th>
              {!isInstruction && !isShipment && <th className="pr-3 font-bold">検品</th>}
              {!isInstruction && isShipment && <th className="pr-3 font-bold">品質区分</th>}
              <th className="pr-3 font-bold">数量</th>
            </tr>
          </thead>
          <tbody>
            {typedItems.map((item, idx) => (
              <tr key={idx} className="text-slate-800">
                <td className="pr-3 py-0.5 font-semibold">{item.itemId || "-"}</td>
                {!isInstruction && <td className="pr-3 py-0.5">{item.locationId || "-"}</td>}
                <td className="pr-3 py-0.5">{item.lotNumber || "-"}</td>
                {!isInstruction && !isShipment && (
                  <td className="pr-3 py-0.5">
                    {(item.inspectionStatus && INSPECTION_LABELS[item.inspectionStatus]) ||
                      item.inspectionStatus ||
                      "-"}
                  </td>
                )}
                {!isInstruction && isShipment && (
                  <td className="pr-3 py-0.5">
                    {(item.qualityStatus && QUALITY_LABELS[item.qualityStatus]) ||
                      item.qualityStatus ||
                      "-"}
                  </td>
                )}
                <td className="pr-3 py-0.5 font-bold">
                  {item.receivedQuantity ?? item.shippedQuantity ?? item.instructedQuantity ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface InventoryStockDataLike {
  header?: Record<string, unknown>;
  items?: unknown;
}

function InventoryStockPreview({ newData, oldData, mode, isUpdate }: PreviewRendererProps) {
  const newStock = newData as InventoryStockDataLike | null;
  const oldStock = oldData as InventoryStockDataLike | null;
  const newHeader = newStock?.header ?? {};
  const oldHeader = oldStock?.header ?? null;
  const items = newStock?.items;
  const isShipment = newHeader && "shippedDate" in newHeader;
  const isReclassification = newHeader && "fromQualityStatus" in newHeader;
  // Item6 Phase6-3-3: 廃棄/返品(単一行のフラット構造で、ヘッダー+明細のitemsは持たない)。
  // 返品はdirectionフィールドで判別し、廃棄は残りの単一行系(quantityを直接持つ)として扱う
  const isReturn = !isReclassification && newHeader && "direction" in newHeader;
  const isDisposal = !isReclassification && !isReturn && newHeader && "quantity" in newHeader;
  // Item6 Phase6-4: 出荷指示/入荷指示(ヘッダー+明細を持つが、明細にlocationIdは無い)
  const isShipmentInstruction = newHeader && "instructedShipDate" in newHeader;
  const isReceiptInstruction = newHeader && "instructedReceiveDate" in newHeader;
  const headerFields = isReclassification
    ? INVENTORY_RECLASSIFICATION_HEADER_FIELDS
    : isReturn
      ? INVENTORY_RETURN_HEADER_FIELDS
      : isDisposal
        ? INVENTORY_DISPOSAL_HEADER_FIELDS
        : isShipmentInstruction
          ? INVENTORY_SHIPMENT_INSTRUCTION_HEADER_FIELDS
          : isReceiptInstruction
            ? INVENTORY_RECEIPT_INSTRUCTION_HEADER_FIELDS
            : isShipment
              ? INVENTORY_SHIPMENT_HEADER_FIELDS
              : INVENTORY_RECEIPT_HEADER_FIELDS;
  const isFlatRecord = isReclassification || isReturn || isDisposal;

  return (
    <div className="space-y-2">
      <FieldGrid
        data={newHeader}
        fields={headerFields}
        mode={mode}
        oldData={oldHeader}
        isUpdate={isUpdate}
      />
      {!isFlatRecord && <InventoryStockItemsTable items={items} />}
    </div>
  );
}

interface InventoryAuditDataLike {
  audit?: Record<string, unknown>;
}

// Item6 Phase6-3: 棚卸(在庫調整)。ヘッダー+明細ではなく単一行のレコードのため、
// InventoryStockPreviewと異なり明細テーブルは持たず、FieldGrid一つで全項目を表示する
function InventoryAuditPreview({ newData, oldData, mode, isUpdate }: PreviewRendererProps) {
  const newAudit = newData as InventoryAuditDataLike | null;
  const oldAudit = oldData as InventoryAuditDataLike | null;
  const newRecord = newAudit?.audit ?? (newData as Record<string, unknown>) ?? {};
  const oldRecord = oldAudit?.audit ?? (oldData as Record<string, unknown>) ?? null;

  return (
    <FieldGrid
      data={newRecord}
      fields={INVENTORY_AUDIT_FIELDS}
      mode={mode}
      oldData={oldRecord}
      isUpdate={isUpdate}
    />
  );
}

/**
 * targetTypeごとの承認プレビュー表示を切り替える共有コンポーネント。
 * 承認タスク画面(_components/TaskPreviewRow.tsx)・申請履歴画面(_components/WorkflowTable.tsx)
 * の両方から利用する(backendのgetTaskPreview/getHistoryPreviewが返すデータ形はtargetTypeごとに
 * 異なるため、表示側もtargetType非依存にするための共通化)。
 */
export function PreviewRenderer(props: PreviewRendererProps) {
  const { targetType, newData, mode } = props;

  if (!newData) {
    return (
      <span className="text-slate-600 italic">
        プレビュー情報がない、またはパースエラーです。
      </span>
    );
  }

  if (targetType === "sales_quotes") {
    return <QuotePreview {...props} />;
  }

  if (targetType === "sales_orders") {
    return <SalesOrderPreview {...props} />;
  }

  if (targetType === "inventory_stock") {
    return <InventoryStockPreview {...props} />;
  }

  if (targetType === "inventory_audit") {
    return <InventoryAuditPreview {...props} />;
  }

  const fields =
    getPreviewFields(targetType) ?? buildGenericFields(newData as Record<string, unknown>);

  if (fields.length === 0) {
    return (
      <span className="text-slate-600 italic">
        この対象マスタ({targetType})向けのプレビュー表示は未対応です。
      </span>
    );
  }

  return (
    <FieldGrid
      data={newData as Record<string, unknown>}
      fields={fields}
      mode={mode}
      oldData={props.oldData as Record<string, unknown> | null}
      isUpdate={props.isUpdate}
    />
  );
}
