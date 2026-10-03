"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { ReceiptInstructionPanel } from "../stock/_components/ReceiptInstructionPanel";
import { ReceiptScanPanel } from "../stock/_components/ReceiptScanPanel";
import { InventoryHistoryPanel } from "../stock/_components/InventoryHistoryPanel";
import { StockInquiryTab } from "../stock/_components/StockInquiryTab";
import { AcceptanceInspectionPanel } from "../stock/_components/AcceptanceInspectionPanel";
import { PurchaseOrderPickerModal } from "../stock/_components/PurchaseOrderPickerModal";
import { useDeepLinkId } from "../../_shared/hooks/use-deep-link-id";
import {
  OpenedStockDocumentCard,
  OpenedStockDocumentKind,
} from "../stock/_components/OpenedStockDocumentCard";
import { ReceiptEditTarget } from "../stock/_hooks/useStockReceiptForm";
import {
  ReceiptInstructionEditTarget,
  ReceiptInstructionCreatePrefill,
} from "../stock/_hooks/useReceiptInstructionForm";
import {
  ReceiptItemRecord,
  ReceiptHeaderRecord,
  ReceiptInstructionHeaderRecord,
  ReceiptInstructionItemRecord,
} from "../stock/_types";

type Tab =
  "instruction" | "receipt" | "actual" | "history" | "stocks" | "acceptance";

interface PurchaseOrderReceiptProgressItem {
  orderItemId: string;
  itemId: string | null;
  itemName: string | null;
  quantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "instruction", label: "📋 入荷指示" },
  { key: "receipt", label: "📥 入庫" },
  { key: "actual", label: "📝 入荷実績入力" },
  { key: "history", label: "📜 入庫入荷実績履歴" },
  { key: "stocks", label: "🗂️ 在庫照会" },
  { key: "acceptance", label: "📄 検収書発行" },
];

const CREATE_REQUIRED_TABS: Tab[] = ["instruction", "receipt", "actual"];

export default function InventoryReceivingPage() {
  const {
    canCreate,
    canRead,
    isDamageWfEnabled,
    isReturnWfEnabled,
    isDisposalWfEnabled,
    loading: permsLoading,
  } = usePagePermissions();
  const [tab, setTab] = useState<Tab>("instruction");
  const [message, setMessage] = useState("");
  const [receiptEditTarget, setReceiptEditTarget] =
    useState<ReceiptEditTarget | null>(null);
  const [receiptActualEditTarget, setReceiptActualEditTarget] =
    useState<ReceiptEditTarget | null>(null);
  const [receiptInstructionEditTarget, setReceiptInstructionEditTarget] =
    useState<ReceiptInstructionEditTarget | null>(null);
  const [showOrderPicker, setShowOrderPicker] = useState(false);
  const [receiptInstructionCreatePrefill, setReceiptInstructionCreatePrefill] =
    useState<ReceiptInstructionCreatePrefill | null>(null);

  // 承認履歴画面(/workflow/histories)の「修正して再提出」ボタンは、フェーズ5のresolveEditPathに
  // より入荷指示・入庫のREMANDEDレコードをこの画面へ`?editId=xxx`付きで遷移させる。
  // どちらの種別かはURLだけでは判別できないため、入荷指示→入庫の順に試す
  // (stock/page.tsx・instructions/page.tsxの既存urlEditIdパターンを踏襲)
  const urlSearchParams = useSearchParams();
  const urlEditId = urlSearchParams.get("editId");
  const urlFromPurchaseOrderId = urlSearchParams.get("fromPurchaseOrderId");

  // Item9: 発注の残数量から入荷指示フォームへ自動prefillする(shipping/page.tsxの
  // fromSalesOrderIdと同じロジック。発注には受注のような倉庫引当が無いため、warehouseIdは
  // prefillせずユーザーに選択させる)。発注画面の「入荷指示を作成する」からの
  // ?fromPurchaseOrderId=遷移と、この画面内「発注から選ぶ」モーダルの両方から呼ばれる
  const applyPurchaseOrderPrefill = async (orderId: string) => {
    try {
      const [order, progress] = await Promise.all([
        apiFetch<{ partnerId: string | null }>(
          `/api/purchase-orders/${encodeURIComponent(orderId)}`,
        ),
        apiFetch<PurchaseOrderReceiptProgressItem[]>(
          `/api/purchase-orders/${encodeURIComponent(orderId)}/receipt-progress`,
        ),
      ]);

      const remaining = progress.filter(
        (item) => item.remainingQuantity > 0 && !!item.itemId,
      );
      if (remaining.length > 0 && order.partnerId) {
        setReceiptInstructionCreatePrefill({
          partnerId: order.partnerId,
          lines: remaining.map((item) => ({
            itemId: item.itemId as string,
            itemName: item.itemName || (item.itemId as string),
            instructedQuantity: item.remainingQuantity,
          })),
        });
      }
      setTab("instruction");
    } catch (err: unknown) {
      setMessage(
        err instanceof Error ? err.message : "発注情報の取得に失敗しました",
      );
    }
  };

  useEffect(() => {
    if (!urlFromPurchaseOrderId || !canCreate) return;
    void (async () => {
      try {
        await applyPurchaseOrderPrefill(urlFromPurchaseOrderId);
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("fromPurchaseOrderId");
        window.history.replaceState({}, "", url.pathname);
      }
    })();
  }, [urlFromPurchaseOrderId, canCreate]);

  useEffect(() => {
    if (!urlEditId || !canCreate) return;
    void (async () => {
      try {
        const receiptInstructionDetail = await apiFetch<{
          header: ReceiptInstructionHeaderRecord;
          items: ReceiptInstructionItemRecord[];
        }>(`/api/receipt-instructions/${urlEditId}`).catch(() => null);

        if (receiptInstructionDetail) {
          if (receiptInstructionDetail.header.status === "REMANDED") {
            setReceiptInstructionEditTarget({
              headerId: urlEditId,
              partnerId: receiptInstructionDetail.header.partnerId,
              warehouseId: receiptInstructionDetail.header.warehouseId,
              instructedReceiveDate:
                receiptInstructionDetail.header.instructedReceiveDate,
              memo: receiptInstructionDetail.header.memo,
              items: receiptInstructionDetail.items,
            });
            setTab("instruction");
          } else {
            setMessage(
              "この入荷指示は現在差戻し状態ではないため、修正して再申請できません",
            );
          }
          return;
        }

        const receiptDetail = await apiFetch<{
          header: ReceiptHeaderRecord;
          items: ReceiptItemRecord[];
        }>(`/api/stock-receipts/${urlEditId}`).catch(() => null);

        if (receiptDetail) {
          if (receiptDetail.header.status === "REMANDED") {
            setReceiptEditTarget({
              headerId: urlEditId,
              items: receiptDetail.items,
              orderId: receiptDetail.header.orderId,
              sourceWarehouseId: receiptDetail.header.sourceWarehouseId,
            });
            setTab("receipt");
          } else {
            setMessage(
              "この入庫は現在差戻し状態ではないため、修正して再申請できません",
            );
          }
          return;
        }

        setMessage("対象の入荷指示・入庫が見つかりませんでした");
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    })();
  }, [urlEditId, canCreate]);

  // 進捗確認など他画面からの`?openId=xxx&openKind=instruction|receipt`で、該当タブに参照カードを開く。
  // 既存の`editId`(差戻しの修正フォームを開く)とは別の入口で、ステータスを問わず内容を表示するだけ。
  // 指示・登録系タブは従来どおり登録権限(canCreate)が必要、履歴タブは閲覧権限のみで表示できる
  const [openedDocument, setOpenedDocument] = useState<{
    kind: OpenedStockDocumentKind;
    id: string;
  } | null>(null);
  useDeepLinkId(
    "openId",
    (id, params) => {
      if (params.get("openKind") === "instruction") {
        setOpenedDocument({ kind: "receipt_instruction", id });
        setTab("instruction");
      } else {
        setOpenedDocument({ kind: "receipt", id });
        setTab("history");
      }
    },
    !permsLoading && canRead,
    ["openKind"],
  );

  if (permsLoading) return <LoadingGate />;
  if (!canRead) {
    return (
      <AccessDeniedInline
        title="🔒 この画面を閲覧する権限がありません"
        description="管理者にお問い合わせください。"
      />
    );
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="📥 入荷"
        description="入荷指示・入庫・実績入力・在庫照会・検収書発行をまとめて行います。"
      />

      <MessageBanner message={message} />

      <div className="flex gap-2 border-b border-slate-200 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`text-base px-4 py-2 font-bold cursor-pointer border-b-2 -mb-px ${
              tab === t.key
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-600 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!canCreate && CREATE_REQUIRED_TABS.includes(tab) && (
        <AccessDeniedInline
          title="🔒 登録する権限がありません"
          description="入庫入荷実績履歴・在庫照会の閲覧のみ利用できます。"
        />
      )}

      {openedDocument &&
        ((openedDocument.kind === "receipt_instruction" &&
          canCreate &&
          tab === "instruction") ||
          (openedDocument.kind === "receipt" && tab === "history")) && (
          <OpenedStockDocumentCard
            kind={openedDocument.kind}
            id={openedDocument.id}
            onClose={() => setOpenedDocument(null)}
          />
        )}

      {canCreate && tab === "instruction" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowOrderPicker(true)}
              className="text-xs border border-indigo-300 bg-white hover:bg-indigo-50 text-indigo-700 px-2.5 py-1.5 rounded font-bold cursor-pointer"
            >
              📦 発注から選ぶ
            </button>
          </div>
          <ReceiptInstructionPanel
            initialEditTarget={receiptInstructionEditTarget}
            onEditConsumed={() => setReceiptInstructionEditTarget(null)}
            createPrefill={receiptInstructionCreatePrefill}
          />
        </div>
      )}
      {showOrderPicker && (
        <PurchaseOrderPickerModal
          onClose={() => setShowOrderPicker(false)}
          onSelect={(orderId) => {
            setShowOrderPicker(false);
            void applyPurchaseOrderPrefill(orderId);
          }}
        />
      )}

      {canCreate && tab === "receipt" && (
        <ReceiptScanPanel
          onSuccess={(msg) => {
            setMessage(msg);
            setReceiptEditTarget(null);
          }}
          editTarget={receiptEditTarget}
          onCancelEdit={() => setReceiptEditTarget(null)}
          warehouseType="INTERNAL"
        />
      )}

      {canCreate && tab === "actual" && (
        <ReceiptScanPanel
          onSuccess={(msg) => {
            setMessage(msg);
            setReceiptActualEditTarget(null);
          }}
          editTarget={receiptActualEditTarget}
          onCancelEdit={() => setReceiptActualEditTarget(null)}
          warehouseType="EXTERNAL"
        />
      )}

      {tab === "history" && (
        <InventoryHistoryPanel
          lockedType="receipt"
          onEdit={(_type, headerId, items, partnerId, transferWarehouseId) => {
            // lockedType="receipt"のため、items は常に ReceiptItemRecord[] で渡ってくる
            const receiptItems = items as ReceiptItemRecord[];
            // 新規要望(2026-09-23): 倉庫間移動の移動元倉庫も修正フォームへ引き継ぐ
            const sourceWarehouseId = transferWarehouseId;
            if (partnerId) {
              setReceiptActualEditTarget({ headerId, items: receiptItems, sourceWarehouseId });
              setTab("actual");
            } else {
              setReceiptEditTarget({ headerId, items: receiptItems, sourceWarehouseId });
              setTab("receipt");
            }
          }}
        />
      )}

      {tab === "stocks" && (
        <StockInquiryTab
          enabled={tab === "stocks"}
          canCreate={canCreate}
          isDamageWfEnabled={isDamageWfEnabled}
          isReturnWfEnabled={isReturnWfEnabled}
          isDisposalWfEnabled={isDisposalWfEnabled}
        />
      )}

      {tab === "acceptance" && <AcceptanceInspectionPanel />}
    </div>
  );
}
