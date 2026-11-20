"use client";

import React from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { DocumentLinePickerModal, type PickerDocument } from "../../../_shared/ui/DocumentLinePickerModal";

// REQ-029: 一時保管の受入・払出で、発注・受注の直接入力(品目マスタに無い)の明細を1件選ぶ。
// 画面と操作は仕入・売上の「発注から選択」「受注から選択」と同じ共通の部品(DocumentLinePickerModal)。
// 一時保管は仕入・売上の残数量ではなく、伝票の明細の数量を上限にする(サーバーも直接入力の明細だけを受け付ける)
export interface PickedDirectLine {
  orderId: string;
  itemId: string;
  itemName: string;
  quantity: number;
  partnerId: string | null;
}

interface DirectLine {
  id: string;
  itemName: string | null;
  quantity: number;
  inputType?: string | null;
}

const CONFIG = {
  purchase: { label: "発注", api: "/api/purchase-orders", otherScreen: "入荷" },
  sales: { label: "受注", api: "/api/sales-orders", otherScreen: "出荷" },
} as const;

interface Props {
  kind: keyof typeof CONFIG;
  onClose: () => void;
  onPick: (line: PickedDirectLine) => void;
}

export function HoldingLinePickerModal({ kind, onClose, onPick }: Props) {
  const config = CONFIG[kind];
  return (
    <DocumentLinePickerModal<PickerDocument, DirectLine>
      docLabel={config.label}
      listUrl={`${config.api}?status=APPROVED`}
      loadLines={async (doc) => {
        const detail = await apiFetch<{ items: DirectLine[] }>(`${config.api}/${encodeURIComponent(doc.id)}`);
        return (detail.items ?? []).filter((i) => i.inputType === "DIRECT");
      }}
      lineKey={(l) => l.id}
      lineName={(l) => l.itemName || "(品名なし)"}
      remaining={(l) => l.quantity}
      columns={[{ header: `${config.label}数量`, cell: (l) => l.quantity }]}
      quantityHeader={kind === "purchase" ? "受け入れる数量" : "払い出す数量"}
      emptyLinesMessage={`この${config.label}には直接入力(品目マスタに無い)の明細がありません(品目マスタにある明細は${config.otherScreen}で扱います)`}
      single
      confirmLabel="この明細を使う"
      onClose={onClose}
      onApply={(doc, [selection]) => {
        onPick({
          orderId: doc.id,
          itemId: selection.line.id,
          itemName: selection.line.itemName ?? "",
          quantity: selection.quantity,
          partnerId: doc.partnerId ?? null,
        });
      }}
    />
  );
}
