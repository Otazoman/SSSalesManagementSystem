"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { StatusBadge } from "../../../_shared/ui/StatusBadge";
import { getApprovalResultStatus } from "../../../_shared/status";
import { MessageBanner } from "../../../_shared/ui/MessageBanner";

// REQ-016: 承認のプレビューなど他画面から`?openId=xxx(&openKind=yyy)`で開かれた、棚卸・品質区分変更・廃棄・返品の
// 「参照用カード」(表示のみ・編集操作なし。状態を問わず開く)。既存の`editId`(差戻しの修正フォームを開く)とは別の入口。
// 品質区分変更・廃棄・返品は入出庫と同じ申請の種類(inventory_stock)を共有し、リンクだけでは種別が分からないため、
// openKind が無い時は editId と同じく 棚卸→品質区分変更→廃棄→返品 の順に詳細取得を試みて特定する
export type OpenedAuditDocumentKind = "audit" | "reclassification" | "disposal" | "return";

interface KindConfig {
  title: string;
  url: (id: string) => string;
  fields: { key: string; label: string; format?: (value: unknown) => string }[];
}

const DIRECTION_LABEL: Record<string, string> = {
  OUTBOUND: "仕入先へ返品",
  INBOUND: "得意先から返品",
};

const STOCK_FIELDS = [
  { key: "itemId", label: "品目" },
  { key: "warehouseId", label: "倉庫" },
  { key: "locationId", label: "ロケーション" },
  { key: "lotNumber", label: "ロット" },
  { key: "accountCode", label: "勘定科目" },
];
const TRAILING_FIELDS = [
  { key: "memo", label: "備考" },
  { key: "createdBy", label: "作成者" },
  { key: "createdAt", label: "作成日" },
];

const KIND_CONFIG: Record<OpenedAuditDocumentKind, KindConfig> = {
  audit: {
    title: "棚卸",
    url: (id) => `/api/stock-audits/${encodeURIComponent(id)}`,
    fields: [
      ...STOCK_FIELDS,
      { key: "qualityStatus", label: "品質区分" },
      { key: "theoreticalQuantity", label: "理論在庫" },
      { key: "countedQuantity", label: "実棚数量" },
      { key: "differenceQuantity", label: "差異" },
      ...TRAILING_FIELDS,
    ],
  },
  reclassification: {
    title: "品質区分変更",
    url: (id) => `/api/stock-reclassifications/${encodeURIComponent(id)}`,
    fields: [
      ...STOCK_FIELDS,
      { key: "fromQualityStatus", label: "変更前の品質区分" },
      { key: "toQualityStatus", label: "変更後の品質区分" },
      { key: "quantity", label: "数量" },
      ...TRAILING_FIELDS,
    ],
  },
  disposal: {
    title: "廃棄",
    url: (id) => `/api/stock-disposals/${encodeURIComponent(id)}`,
    fields: [
      ...STOCK_FIELDS,
      { key: "qualityStatus", label: "品質区分" },
      { key: "quantity", label: "廃棄数量" },
      ...TRAILING_FIELDS,
    ],
  },
  return: {
    title: "返品",
    url: (id) => `/api/stock-returns/${encodeURIComponent(id)}`,
    fields: [
      { key: "direction", label: "返品の種類", format: (v) => DIRECTION_LABEL[String(v)] ?? String(v ?? "") },
      { key: "returnDate", label: "返品日" },
      ...STOCK_FIELDS,
      { key: "qualityStatus", label: "品質区分" },
      { key: "quantity", label: "数量" },
      { key: "returnReason", label: "返品理由" },
      ...TRAILING_FIELDS,
    ],
  },
};

const SEARCH_ORDER: OpenedAuditDocumentKind[] = ["audit", "reclassification", "disposal", "return"];

export function parseOpenedAuditDocumentKind(value: string | null): OpenedAuditDocumentKind | null {
  return value && (SEARCH_ORDER as string[]).includes(value) ? (value as OpenedAuditDocumentKind) : null;
}

type DocRecord = Record<string, unknown> & { status: string };

function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // ISO日時の場合は日付部分のみ
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 10) : text;
}

interface OpenedAuditDocumentCardProps {
  kind: OpenedAuditDocumentKind | null;
  id: string;
  onClose: () => void;
}

export function OpenedAuditDocumentCard({ kind, id, onClose }: OpenedAuditDocumentCardProps) {
  const [found, setFound] = useState<{ kind: OpenedAuditDocumentKind; record: DocRecord } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    void (async () => {
      setFound(null);
      setError("");
      for (const k of kind ? [kind] : SEARCH_ORDER) {
        const record = await apiFetch<DocRecord>(KIND_CONFIG[k].url(id)).catch(() => null);
        if (canceled) return;
        if (record) {
          setFound({ kind: k, record });
          return;
        }
      }
      setError(kind ? `${KIND_CONFIG[kind].title}が見つかりませんでした` : "対象の棚卸/品質区分変更/廃棄/返品データが見つかりませんでした");
    })();
    return () => {
      canceled = true;
    };
  }, [kind, id]);

  const config = found ? KIND_CONFIG[found.kind] : null;

  return (
    <div className="border-2 border-indigo-500 rounded-lg bg-white text-slate-900 p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">
          📄 {config ? config.title : kind ? KIND_CONFIG[kind].title : "在庫の伝票"}: <span className="font-mono">{id}</span>
          {found && (
            <span className="ml-3 align-middle">
              <StatusBadge {...getApprovalResultStatus(found.record.status)} />
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
      {!found && !error && <p className="text-slate-700">読み込み中...</p>}

      {found && config && (
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 text-xs">
          {config.fields.map((f) => (
            <div key={f.key} className="flex gap-2">
              <dt className="w-28 shrink-0 font-semibold text-slate-800">{f.label}</dt>
              <dd className="text-slate-900 break-all">
                {f.format ? f.format(found.record[f.key]) : display(found.record[f.key])}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
