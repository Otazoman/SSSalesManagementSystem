"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { ShipmentInstructionPanel } from "../stock/_components/ShipmentInstructionPanel";
import {
  ShipmentInstructionCreatePrefill,
  ShipmentInstructionEditTarget,
} from "../stock/_hooks/useShipmentInstructionForm";
import { SalesOrderPickerModal } from "../stock/_components/SalesOrderPickerModal";
import { ShipmentScanPanel } from "../stock/_components/ShipmentScanPanel";
import { InventoryHistoryPanel } from "../stock/_components/InventoryHistoryPanel";
import { StockInquiryTab } from "../stock/_components/StockInquiryTab";
import { DeliveryNotePanel } from "../stock/_components/DeliveryNotePanel";
import { useDeepLinkId } from "../../_shared/hooks/use-deep-link-id";
import {
  OpenedStockDocumentCard,
  OpenedStockDocumentKind,
} from "../stock/_components/OpenedStockDocumentCard";
import { ShipmentEditTarget } from "../stock/_hooks/useStockShipmentForm";
import {
  ShipmentItemRecord,
  ShipmentHeaderRecord,
  ShipmentInstructionHeaderRecord,
  ShipmentInstructionItemRecord,
  WarehouseRecord,
} from "../stock/_types";
import { ShipmentProgressItem } from "../../sales/orders/_types";

type Tab =
  "instruction" | "shipment" | "actual" | "history" | "stocks" | "deliveryNote";

const TABS: { key: Tab; label: string }[] = [
  { key: "instruction", label: "📋 出荷指示" },
  { key: "shipment", label: "📤 出庫" },
  { key: "actual", label: "📝 出荷実績入力" },
  { key: "history", label: "📜 出庫出荷実績履歴" },
  { key: "stocks", label: "🗂️ 在庫照会" },
  { key: "deliveryNote", label: "📄 納品書発行" },
];

const CREATE_REQUIRED_TABS: Tab[] = ["instruction", "shipment", "actual"];

export default function InventoryShippingPage() {
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
  const [shipmentEditTarget, setShipmentEditTarget] =
    useState<ShipmentEditTarget | null>(null);
  const [shipmentActualEditTarget, setShipmentActualEditTarget] =
    useState<ShipmentEditTarget | null>(null);
  const [showOrderPicker, setShowOrderPicker] = useState(false);
  const [fromSalesOrderId, setFromSalesOrderId] = useState<string | null>(null);
  const [
    shipmentInstructionCreatePrefill,
    setShipmentInstructionCreatePrefill,
  ] = useState<ShipmentInstructionCreatePrefill | null>(null);
  const [shipmentInstructionEditTarget, setShipmentInstructionEditTarget] =
    useState<ShipmentInstructionEditTarget | null>(null);

  const urlSearchParams = useSearchParams();
  const urlTab = urlSearchParams.get("tab");
  const urlFromSalesOrderId = urlSearchParams.get("fromSalesOrderId");
  const urlEditId = urlSearchParams.get("editId");

  // BulkShipmentPlanModal.tsx等からの?tab=shipment指定を受け付ける(stock/page.tsxと同じ挙動)
  useEffect(() => {
    if (!urlTab) return;
    void (async () => {
      if (urlTab === "shipment") setTab("shipment");
      const url = new URL(window.location.href);
      url.searchParams.delete("tab");
      window.history.replaceState({}, "", url.pathname + url.search);
    })();
  }, [urlTab]);

  // 入庫/出庫はINTERNAL/EXTERNAL両方の倉庫で共有されるため、「編集」時は対象倉庫の種別を判定する
  const warehousesCacheRef = useRef<WarehouseRecord[] | null>(null);
  const resolveWarehouseType = async (
    warehouseId: string,
  ): Promise<"INTERNAL" | "EXTERNAL"> => {
    if (!warehousesCacheRef.current) {
      warehousesCacheRef.current = await apiFetch<WarehouseRecord[]>(
        "/api/warehouses?status=active",
      ).catch(() => []);
    }
    const found = warehousesCacheRef.current.find((w) => w.id === warehouseId);
    return found?.warehouseType === "EXTERNAL" ? "EXTERNAL" : "INTERNAL";
  };

  // 受注画面の「🚚 出荷指示を作成する」から?fromSalesOrderId=<受注ID>付きで遷移してきた場合と、
  // この画面内「受注から選ぶ」モーダル(SalesOrderPickerModal)の両方から呼ばれる。
  // 得意先・倉庫・明細を出荷指示フォームへ自動prefillする(receiving/page.tsxの
  // applyPurchaseOrderPrefillと同じ構成)
  const applySalesOrderPrefill = async (orderId: string) => {
    try {
      const [order, progress] = await Promise.all([
        apiFetch<{ partnerId: string }>(
          `/api/sales-orders/${encodeURIComponent(orderId)}`,
        ),
        apiFetch<ShipmentProgressItem[]>(
          `/api/sales-orders/${encodeURIComponent(orderId)}/shipment-progress`,
        ),
      ]);

      const remaining = progress.filter(
        (item) => item.remainingQuantity > 0 && !!item.itemId,
      );
      if (remaining.length > 0) {
        const candidates = remaining.flatMap((item) =>
          item.reservations
            .filter((r) => r.reservedQuantity > 0)
            .map((r) => ({
              item,
              warehouseId: r.warehouseId,
              reservedQuantity: r.reservedQuantity,
            })),
        );

        let warehouseId = "";
        let lines: ShipmentInstructionCreatePrefill["lines"] = [];

        if (candidates.length > 0) {
          const targetWarehouseId = candidates[0].warehouseId;
          const candidateLines = candidates
            .filter((cd) => cd.warehouseId === targetWarehouseId)
            .map((cd) => ({
              itemId: cd.item.itemId as string,
              itemName: cd.item.itemName || (cd.item.itemId as string),
              lotNumber: "NONE",
              instructedQuantity: Math.min(
                cd.item.remainingQuantity,
                cd.reservedQuantity,
              ),
              salesOrderItemId: cd.item.salesOrderItemId,
            }))
            .filter((l) => l.instructedQuantity > 0);
          if (candidateLines.length > 0) {
            warehouseId = targetWarehouseId;
            lines = candidateLines;
          }
        }

        // 不具合修正(2026-09-23): 倉庫引当(予約)がまだ無い受注では明細候補が
        // 得られず、得意先(partnerId)自体もprefillされていなかった(発注→入荷指示
        // では発注に倉庫引当の概念が無いため常に仕入先が引き継がれるのに対し、
        // 受注側だけ引き継がれない非対称な状態だった)。倉庫引当が無い場合でも、
        // 得意先と残数量の明細だけは必ず引き継ぎ、倉庫はユーザーに選んでもらう
        if (lines.length === 0) {
          lines = remaining.map((item) => ({
            itemId: item.itemId as string,
            itemName: item.itemName || (item.itemId as string),
            lotNumber: "NONE",
            instructedQuantity: item.remainingQuantity,
            salesOrderItemId: item.salesOrderItemId,
          }));
        }

        setShipmentInstructionCreatePrefill({
          partnerId: order.partnerId,
          warehouseId,
          lines,
        });
      }
      setFromSalesOrderId(orderId);
      setTab("instruction");
    } catch (err: unknown) {
      setMessage(
        err instanceof Error ? err.message : "受注情報の取得に失敗しました",
      );
    }
  };

  useEffect(() => {
    if (!urlFromSalesOrderId || !canCreate) return;
    void applySalesOrderPrefill(urlFromSalesOrderId).finally(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("fromSalesOrderId");
      window.history.replaceState({}, "", url.pathname);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFromSalesOrderId, canCreate]);

  // 承認履歴画面(/workflow/histories)の「修正して再提出」ボタンは、フェーズ5のresolveEditPathに
  // より出荷指示・出庫のREMANDEDレコードをこの画面へ`?editId=xxx`付きで遷移させる。
  // どちらの種別かはURLだけでは判別できないため、出荷指示→出庫の順に試す
  // (stock/page.tsx・instructions/page.tsxの既存urlEditIdパターンを踏襲)
  useEffect(() => {
    if (!urlEditId || !canCreate) return;
    void (async () => {
      try {
        const shipmentInstructionDetail = await apiFetch<{
          header: ShipmentInstructionHeaderRecord;
          items: ShipmentInstructionItemRecord[];
        }>(`/api/shipment-instructions/${urlEditId}`).catch(() => null);

        if (shipmentInstructionDetail) {
          if (shipmentInstructionDetail.header.status === "REMANDED") {
            setShipmentInstructionEditTarget({
              headerId: urlEditId,
              partnerId: shipmentInstructionDetail.header.partnerId,
              warehouseId: shipmentInstructionDetail.header.warehouseId,
              instructedShipDate:
                shipmentInstructionDetail.header.instructedShipDate,
              memo: shipmentInstructionDetail.header.memo,
              items: shipmentInstructionDetail.items,
            });
            setTab("instruction");
          } else {
            setMessage(
              "この出荷指示は現在差戻し状態ではないため、修正して再申請できません",
            );
          }
          return;
        }

        const shipmentDetail = await apiFetch<{
          header: ShipmentHeaderRecord;
          items: ShipmentItemRecord[];
        }>(`/api/stock-shipments/${urlEditId}`).catch(() => null);

        if (shipmentDetail) {
          if (shipmentDetail.header.status === "REMANDED") {
            setShipmentEditTarget({
              headerId: urlEditId,
              items: shipmentDetail.items,
              partnerId: shipmentDetail.header.partnerId,
              destinationWarehouseId: shipmentDetail.header.destinationWarehouseId,
            });
            setTab("shipment");
          } else {
            setMessage(
              "この出庫は現在差戻し状態ではないため、修正して再申請できません",
            );
          }
          return;
        }

        setMessage("対象の出荷指示・出庫が見つかりませんでした");
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    })();
  }, [urlEditId, canCreate]);

  // 進捗確認など他画面からの`?openId=xxx&openKind=instruction|shipment`で、該当タブに参照カードを開く。
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
        setOpenedDocument({ kind: "shipment_instruction", id });
        setTab("instruction");
      } else {
        setOpenedDocument({ kind: "shipment", id });
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
        title="📤 出荷"
        description="出荷指示・出庫・実績入力・在庫照会・納品書発行をまとめて行います。"
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
          description="出庫出荷実績履歴・在庫照会の閲覧のみ利用できます。"
        />
      )}

      {openedDocument &&
        ((openedDocument.kind === "shipment_instruction" &&
          canCreate &&
          tab === "instruction") ||
          (openedDocument.kind === "shipment" && tab === "history")) && (
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
              📋 受注から選ぶ
            </button>
          </div>
          <ShipmentInstructionPanel
            initialEditTarget={shipmentInstructionEditTarget}
            onEditConsumed={() => setShipmentInstructionEditTarget(null)}
            fromSalesOrderId={fromSalesOrderId}
            createPrefill={shipmentInstructionCreatePrefill}
          />
        </div>
      )}
      {showOrderPicker && (
        <SalesOrderPickerModal
          onClose={() => setShowOrderPicker(false)}
          onSelect={(orderId) => {
            setShowOrderPicker(false);
            setShipmentInstructionCreatePrefill(null);
            void applySalesOrderPrefill(orderId);
          }}
        />
      )}

      {canCreate && tab === "shipment" && (
        <ShipmentScanPanel
          onSuccess={(msg) => {
            setMessage(msg);
            setShipmentEditTarget(null);
          }}
          editTarget={shipmentEditTarget}
          onCancelEdit={() => setShipmentEditTarget(null)}
          warehouseType="INTERNAL"
        />
      )}

      {canCreate && tab === "actual" && (
        <ShipmentScanPanel
          onSuccess={(msg) => {
            setMessage(msg);
            setShipmentActualEditTarget(null);
          }}
          editTarget={shipmentActualEditTarget}
          onCancelEdit={() => setShipmentActualEditTarget(null)}
          warehouseType="EXTERNAL"
        />
      )}

      {tab === "history" && (
        <InventoryHistoryPanel
          lockedType="shipment"
          onEdit={(_type, headerId, items, partnerId, transferWarehouseId) => {
            void (async () => {
              // lockedType="shipment"のため、items は常に ShipmentItemRecord[] で渡ってくる
              const shipmentItems = items as ShipmentItemRecord[];
              const warehouseType = shipmentItems[0]
                ? await resolveWarehouseType(shipmentItems[0].warehouseId)
                : "INTERNAL";
              const editTarget: ShipmentEditTarget = {
                headerId,
                items: shipmentItems,
                partnerId,
                // 新規要望(2026-09-23): 倉庫間移動の移動先倉庫も修正フォームへ引き継ぐ
                destinationWarehouseId: transferWarehouseId,
              };
              if (warehouseType === "EXTERNAL") {
                setShipmentActualEditTarget(editTarget);
                setTab("actual");
              } else {
                setShipmentEditTarget(editTarget);
                setTab("shipment");
              }
            })();
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

      {tab === "deliveryNote" && <DeliveryNotePanel />}
    </div>
  );
}
