"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../../_shared/ui/PageHeader";
import { useSearchParams } from "next/navigation";
import { usePagePermissions } from "../../hooks/use-page-permission";
import { apiFetch } from "../../_shared/hooks/use-api-fetch";
import { LoadingGate } from "../../_shared/ui/LoadingGate";
import { AccessDeniedInline } from "../../_shared/ui/AccessDeniedInline";
import { MessageBanner } from "../../_shared/ui/MessageBanner";
import { AuditScanPanel } from "./_components/AuditScanPanel";
import { AuditHistoryPanel } from "./_components/AuditHistoryPanel";
import { AuditEditTarget } from "./_hooks/useStockAuditForm";
import { AuditRecord } from "./_types";
// 在庫照会・返品履歴・廃棄履歴タブは、入荷/出荷ページ(/inventory/receiving・/inventory/shipping)
// と同じ共有コンポーネントをそのまま再利用する(instructions/page.tsxと同じ使い方)
import { StockInquiryTab } from "../stock/_components/StockInquiryTab";
import { ReturnHistoryPanel } from "../stock/_components/ReturnHistoryPanel";
import { DisposalHistoryPanel } from "../stock/_components/DisposalHistoryPanel";
import { ReclassificationEditTarget } from "../stock/_components/ReclassifyModal";
import { DisposalEditTarget } from "../stock/_components/DisposalModal";
import { ReturnEditTarget } from "../stock/_components/ReturnModal";
import {
  ReclassificationRecord,
  DisposalRecord,
  ReturnRecord,
} from "../stock/_types";

type Tab = "stocks" | "returns" | "disposals" | "count" | "history";

export default function InventoryAuditPage() {
  const {
    canCreate,
    canRead,
    isDamageWfEnabled,
    isDisposalWfEnabled,
    isReturnWfEnabled,
    departments,
    loading: permsLoading,
  } = usePagePermissions();
  const [tab, setTab] = useState<Tab>("count");
  const [message, setMessage] = useState("");
  const [editTarget, setEditTarget] = useState<AuditEditTarget | null>(null);
  const [reclassifyEditTarget, setReclassifyEditTarget] =
    useState<ReclassificationEditTarget | null>(null);
  const [disposalEditTarget, setDisposalEditTarget] =
    useState<DisposalEditTarget | null>(null);
  const [returnEditTarget, setReturnEditTarget] =
    useState<ReturnEditTarget | null>(null);

  // 承認履歴画面(/workflow/histories)の汎用「修正して再提出」ボタンは、targetTypeから
  // 画面パスを引いて `${editPath}?editId=xxx` へ遷移させるだけの汎用機構(倉庫・見積等の
  // マスタ画面と同じ規約)。棚卸はtargetTypeが"inventory_audit"専用だが、品質区分変更・
  // 廃棄・返品は入出庫と同じtargetType"inventory_stock"を共有し、かつ編集フォーム自体は
  // このページの「在庫照会」タブ(StockInquiryTab)に集約されているため、editIdだけでは
  // どの種別か判別できず、棚卸→品質区分変更→廃棄→返品の順に詳細取得を試みて特定する
  // (画面構成再編(a)、stock/page.tsxの旧urlEditIdパターンを踏襲)
  const urlSearchParams = useSearchParams();
  const urlEditId = urlSearchParams.get("editId");

  useEffect(() => {
    if (!urlEditId || !canCreate) return;
    void (async () => {
      try {
        const audit = await apiFetch<AuditRecord>(
          `/api/stock-audits/${urlEditId}`,
        ).catch(() => null);

        if (audit) {
          if (audit.status === "REMANDED") {
            setEditTarget({ auditId: urlEditId, audit });
            setTab("count");
          } else {
            setMessage(
              "この棚卸は現在差戻し状態ではないため、修正して再申請できません",
            );
          }
          return;
        }

        const reclassification = await apiFetch<ReclassificationRecord>(
          `/api/stock-reclassifications/${urlEditId}`,
        ).catch(() => null);

        if (reclassification) {
          if (reclassification.status === "REMANDED") {
            setReclassifyEditTarget({
              reclassificationId: urlEditId,
              record: reclassification,
            });
            setTab("stocks");
          } else {
            setMessage(
              "この品質区分変更は現在差戻し状態ではないため、修正して再申請できません",
            );
          }
          return;
        }

        const disposal = await apiFetch<DisposalRecord>(
          `/api/stock-disposals/${urlEditId}`,
        ).catch(() => null);

        if (disposal) {
          if (disposal.status === "REMANDED") {
            setDisposalEditTarget({ disposalId: urlEditId, record: disposal });
            setTab("stocks");
          } else {
            setMessage(
              "この廃棄は現在差戻し状態ではないため、修正して再申請できません",
            );
          }
          return;
        }

        const returnRecord = await apiFetch<ReturnRecord>(
          `/api/stock-returns/${urlEditId}`,
        ).catch(() => null);

        if (returnRecord) {
          if (returnRecord.status === "REMANDED") {
            setReturnEditTarget({ returnId: urlEditId, record: returnRecord });
            setTab("stocks");
          } else {
            setMessage(
              "この返品は現在差戻し状態ではないため、修正して再申請できません",
            );
          }
          return;
        }

        setMessage(
          "対象の棚卸/品質区分変更/廃棄/返品データが見つかりませんでした",
        );
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("editId");
        window.history.replaceState({}, "", url.pathname);
      }
    })();
  }, [urlEditId, canCreate]);

  if (permsLoading) {
    return <LoadingGate />;
  }

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
        title="📋 在庫・棚卸管理"
        description="在庫照会・返品履歴・廃棄履歴の確認と、実棚数量の記録による理論在庫との差異反映をまとめて行います。ロケーションはQR撮影、またはPC入力で特定します。"
      />

      <MessageBanner message={message} />

      <div className="flex gap-2 border-b border-slate-200">
        {(
          [
            { key: "stocks", label: "🗂️ 在庫照会" },
            { key: "returns", label: "↩️ 返品履歴" },
            { key: "disposals", label: "🗑️ 廃棄履歴" },
            { key: "count", label: "📋 棚卸" },
            { key: "history", label: "📜 棚卸履歴" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setEditTarget(null);
              setReclassifyEditTarget(null);
              setDisposalEditTarget(null);
              setReturnEditTarget(null);
            }}
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

      {!canCreate &&
        tab !== "stocks" &&
        tab !== "returns" &&
        tab !== "disposals" &&
        tab !== "history" && (
          <AccessDeniedInline
            title="🔒 登録する権限がありません"
            description="在庫照会・返品履歴・廃棄履歴・棚卸履歴の閲覧のみ利用できます。"
          />
        )}

      {canCreate && tab === "count" && (
        <AuditScanPanel
          onSuccess={(msg) => {
            setMessage(msg);
            setEditTarget(null);
          }}
          editTarget={editTarget}
          onCancelEdit={() => setEditTarget(null)}
        />
      )}
      {tab === "stocks" && (
        <StockInquiryTab
          enabled={tab === "stocks"}
          canCreate={canCreate}
          isDamageWfEnabled={isDamageWfEnabled}
          isReturnWfEnabled={isReturnWfEnabled}
          isDisposalWfEnabled={isDisposalWfEnabled}
          departments={departments}
          initialReclassifyEditTarget={reclassifyEditTarget}
          initialDisposalEditTarget={disposalEditTarget}
          initialReturnEditTarget={returnEditTarget}
          onEditConsumed={() => {
            setReclassifyEditTarget(null);
            setDisposalEditTarget(null);
            setReturnEditTarget(null);
          }}
        />
      )}
      {tab === "returns" && <ReturnHistoryPanel />}
      {tab === "disposals" && <DisposalHistoryPanel />}
      {tab === "history" && (
        <AuditHistoryPanel
          onEdit={
            canCreate
              ? (auditId, audit) => {
                  setEditTarget({ auditId, audit });
                  setTab("count");
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
