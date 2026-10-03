"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { StatusBadge, StatusBadgeSpec } from "../../../_shared/ui/StatusBadge";
import { getApprovalResultStatus, getInstructionStatus } from "../../../_shared/status";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";
import { DocumentCompletionControl } from "../../../_shared/ui/DocumentCompletionControl";
import type { ProgressStageKey } from "../../../progress/_types";

// 進捗確認など他画面から`?openId=xxx&openKind=yyy`で開かれた、入荷指示/入庫/出荷指示/出庫の
// 「参照用カード」。該当タブの一覧はページングされていて対象行が現在のページに無いことがあるため、
// 各伝票の詳細取得API(GET-by-id、一覧と同じ既存API)で取得して、ヘッダと明細を表示する(表示のみ・編集操作なし)
export type OpenedStockDocumentKind = "receipt_instruction" | "shipment_instruction" | "receipt" | "shipment";

interface KindConfig {
  title: string;
  url: (id: string) => string;
  statusOf: (status: string) => StatusBadgeSpec;
  headerFields: { key: string; label: string }[];
  itemColumns: { key: string; label: string; align?: "right" }[];
}

const KIND_CONFIG: Record<OpenedStockDocumentKind, KindConfig> = {
  receipt_instruction: {
    title: "入荷指示",
    url: (id) => `/api/receipt-instructions/${encodeURIComponent(id)}`,
    statusOf: getInstructionStatus,
    headerFields: [
      { key: "partnerId", label: "仕入先" },
      { key: "warehouseId", label: "倉庫" },
      { key: "instructedReceiveDate", label: "入荷予定日" },
      { key: "memo", label: "備考" },
      { key: "createdBy", label: "作成者" },
    ],
    itemColumns: [
      { key: "itemId", label: "品目" },
      { key: "lotNumber", label: "ロット" },
      { key: "instructedQuantity", label: "指示数量", align: "right" },
      { key: "fulfilledQuantity", label: "消込済み", align: "right" },
      { key: "remainingQuantity", label: "残数量", align: "right" },
    ],
  },
  shipment_instruction: {
    title: "出荷指示",
    url: (id) => `/api/shipment-instructions/${encodeURIComponent(id)}`,
    statusOf: getInstructionStatus,
    headerFields: [
      { key: "partnerId", label: "得意先" },
      { key: "warehouseId", label: "倉庫" },
      { key: "instructedShipDate", label: "出荷予定日" },
      { key: "salesOrderId", label: "受注番号" },
      { key: "memo", label: "備考" },
      { key: "createdBy", label: "作成者" },
    ],
    itemColumns: [
      { key: "itemId", label: "品目" },
      { key: "lotNumber", label: "ロット" },
      { key: "instructedQuantity", label: "指示数量", align: "right" },
      { key: "fulfilledQuantity", label: "消込済み", align: "right" },
      { key: "remainingQuantity", label: "残数量", align: "right" },
    ],
  },
  receipt: {
    title: "入庫",
    url: (id) => `/api/stock-receipts/${encodeURIComponent(id)}`,
    statusOf: getApprovalResultStatus,
    headerFields: [
      { key: "receivedDate", label: "入庫日" },
      { key: "partnerId", label: "仕入先" },
      // 新規要望(2026-09-23): 倉庫間移動の移動元倉庫(仕入先と排他)
      { key: "sourceWarehouseId", label: "移動元倉庫" },
      { key: "orderId", label: "発注番号" },
      { key: "supplierInvoiceNumber", label: "仕入先請求書番号" },
      { key: "memo", label: "備考" },
      { key: "createdBy", label: "作成者" },
    ],
    itemColumns: [
      { key: "itemId", label: "品目" },
      { key: "warehouseId", label: "倉庫" },
      { key: "locationId", label: "ロケーション" },
      { key: "lotNumber", label: "ロット" },
      { key: "receivedQuantity", label: "入庫数量", align: "right" },
      { key: "inspectionStatus", label: "検品" },
    ],
  },
  shipment: {
    title: "出庫",
    url: (id) => `/api/stock-shipments/${encodeURIComponent(id)}`,
    statusOf: getApprovalResultStatus,
    headerFields: [
      { key: "shippedDate", label: "出庫日" },
      { key: "partnerId", label: "得意先" },
      // 新規要望(2026-09-23): 倉庫間移動の移動先倉庫(得意先と排他)
      { key: "destinationWarehouseId", label: "移動先倉庫" },
      { key: "salesOrderId", label: "受注番号" },
      { key: "memo", label: "備考" },
      { key: "createdBy", label: "作成者" },
    ],
    itemColumns: [
      { key: "itemId", label: "品目" },
      { key: "warehouseId", label: "倉庫" },
      { key: "locationId", label: "ロケーション" },
      { key: "lotNumber", label: "ロット" },
      { key: "qualityStatus", label: "品質区分" },
      { key: "shippedQuantity", label: "出庫数量", align: "right" },
    ],
  },
};

// 参照カードの伝票種別 → 進捗確認の工程キー
const STAGE_BY_KIND: Record<OpenedStockDocumentKind, ProgressStageKey> = {
  receipt_instruction: "receipt_instruction",
  receipt: "item_receipt",
  shipment_instruction: "shipment_instruction",
  shipment: "item_shipment",
};

interface Detail {
  header: Record<string, unknown> & { status: string };
  items: Record<string, unknown>[];
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // ISO日時の場合は日付部分のみ
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 10) : text;
}

interface OpenedStockDocumentCardProps {
  kind: OpenedStockDocumentKind;
  id: string;
  onClose: () => void;
}

export function OpenedStockDocumentCard({ kind, id, onClose }: OpenedStockDocumentCardProps) {
  const config = KIND_CONFIG[kind];
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      setDetail(null);
      setError("");
      try {
        setDetail(await apiFetch<Detail>(config.url(id), { defaultErrorMessage: `${config.title}の取得に失敗しました` }));
      } catch (err) {
        setError(err instanceof Error ? err.message : `${config.title}の取得に失敗しました`);
      }
    })();
  }, [config, id]);

  return (
    <div className="border-2 border-indigo-500 rounded-lg bg-white text-slate-900 p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">
          📄 {config.title}: <span className="font-mono">{id}</span>
          {detail && (
            <span className="ml-3 align-middle">
              <StatusBadge {...config.statusOf(detail.header.status)} />
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-1 border border-slate-400 rounded bg-white text-slate-800 hover:bg-slate-100 font-semibold"
        >
          閉じる
        </button>
      </div>

      <MessageBanner error={error} />
      {!detail && !error && <p className="text-slate-700">読み込み中...</p>}

      {detail && (
        <>
          {/* 進捗確認(閲覧専用)に表示される完了/進行中の手動設定。この画面の更新権限がある場合のみ変更できる */}
          <DocumentCompletionControl stageKey={STAGE_BY_KIND[kind]} documentId={id} />
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 text-xs">
            {config.headerFields.map((f) => (
              <div key={f.key} className="flex gap-2">
                <dt className="w-28 shrink-0 font-semibold text-slate-800">{f.label}</dt>
                <dd className="text-slate-900 break-all">{display(detail.header[f.key])}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-auto max-h-72 border border-slate-200 rounded">
            <table className="min-w-full text-xs text-slate-900">
              <thead className="bg-slate-100 text-slate-900">
                <tr>
                  {config.itemColumns.map((c) => (
                    <th
                      key={c.key}
                      className={`px-3 py-1.5 sticky top-0 bg-slate-100 ${c.align === "right" ? "text-right" : "text-left"}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.items.length === 0 && (
                  <tr>
                    <td colSpan={config.itemColumns.length} className="px-3 py-4 text-center text-slate-700">
                      明細がありません
                    </td>
                  </tr>
                )}
                {detail.items.map((item, i) => (
                  <tr key={String(item.id ?? i)}>
                    {config.itemColumns.map((c) => (
                      <td key={c.key} className={`px-3 py-1 ${c.align === "right" ? "text-right" : ""}`}>
                        {display(item[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
