"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  PartnerRecord,
  ProductRecord,
  WarehouseRecord,
  ShipmentInstructionItemRecord,
} from "../_types";
import type { ApplicantDepartmentOption } from "../../../types";
import { todayJst } from "../../../_shared/jst-date";

export interface ShipmentInstructionLineDraft {
  key: string;
  itemId: string;
  itemName: string;
  lotNumber: string;
  instructedQuantity: number;
  memo: string;
  // Item7残課題6: この明細がどの受注明細の消込対象かを示す(任意、単独作成ではnull)
  salesOrderItemId?: string | null;
}

export interface ShipmentInstructionEditTarget {
  headerId: string;
  partnerId: string;
  warehouseId: string;
  instructedShipDate: string;
  memo: string | null;
  items: ShipmentInstructionItemRecord[];
}

// Item7残課題6: 受注画面から「出荷指示を作成する」で遷移してきた場合の新規作成prefill。
// editTargetと違いheaderIdを持たない(既存の差戻し再提出とは別の、新規作成の入力補助)
export interface ShipmentInstructionCreatePrefill {
  partnerId: string;
  warehouseId: string;
  lines: Array<{
    itemId: string;
    itemName: string;
    lotNumber: string;
    instructedQuantity: number;
    salesOrderItemId: string;
  }>;
}

// Item7残課題6 Phase B: 出荷指示画面側から「受注から選ぶ」で遷移してきた場合の候補
// (クリックすると商品・数量を入力欄へ反映する)。出荷指示は在庫を動かさない指示書のため、
// useStockShipmentForm.tsのorderSuggestionsと異なり倉庫別引当(reservations)による絞り込みは
// 行わず、残数量が残っている明細を全て候補とする(実際の可否は実績反映時にチェックされる)
export interface InstructionOrderSuggestion {
  salesOrderItemId: string;
  itemId: string;
  itemName: string;
  remainingQuantity: number;
}

interface ShipmentProgressItemForSuggestion {
  salesOrderItemId: string;
  itemId: string | null;
  itemName: string | null;
  remainingQuantity: number;
}

export function useShipmentInstructionForm(
  onSuccess: (message: string) => void,
  editTarget?: ShipmentInstructionEditTarget | null,
  createPrefill?: ShipmentInstructionCreatePrefill | null,
  fromSalesOrderId?: string | null,
  departments: ApplicantDepartmentOption[] = [],
) {
  // 追加要望F: 複数部門所属時の申請部門選択(初期値は所属部門の先頭=従来の暗黙動作と同じ)。
  // departmentsはusePagePermissions()から非同期に取得されるため、useState初期値だけでは
  // 反映されない場合がある。ロード完了後にuseEffectで未選択(null)の場合のみ先頭部門を
  // 補完する(ユーザーが既に選択した値は上書きしない)。
  const [applicantDepartmentSurrogateId, setApplicantDepartmentSurrogateId] =
    useState<string | null>(null);
  useEffect(() => {
    if (applicantDepartmentSurrogateId === null && departments.length > 0) {
      setApplicantDepartmentSurrogateId(departments[0].surrogateId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments]);

  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);

  // Item6 Phase6-4: 見積書と同様、管理番号を任意入力できるようにする(空欄なら自動採番)
  const [customId, setCustomId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [instructedShipDate, setInstructedShipDate] = useState(
    todayJst(),
  );
  const [memo, setMemo] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductRecord | null>(null);
  const [lotNumber, setLotNumber] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lineMemo, setLineMemo] = useState("");
  const [lines, setLines] = useState<ShipmentInstructionLineDraft[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderSuggestions, setOrderSuggestions] = useState<InstructionOrderSuggestion[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [whs, partnerList, prods] = await Promise.all([
          apiFetch<WarehouseRecord[]>("/api/warehouses?status=active"),
          apiFetch<PartnerRecord[]>("/api/partners?status=active"),
          apiFetch<ProductRecord[]>("/api/products?status=active"),
        ]);
        // Item7残課題8: 業務フロー統一により倉庫種別を問わず選択肢にする(得意先はCUSTOMER/BOTHのみ)
        setWarehouses(whs);
        setPartners(partnerList.filter((p) => p.type === "CUSTOMER" || p.type === "BOTH"));
        setProducts(prods);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "マスタ情報の取得に失敗しました");
      }
    })();
  }, []);

  useEffect(() => {
    if (!editTarget) return;
    if (products.length === 0) return;
    void (async () => {
      setPartnerId(editTarget.partnerId);
      setWarehouseId(editTarget.warehouseId);
      setInstructedShipDate(editTarget.instructedShipDate.slice(0, 10));
      setMemo(editTarget.memo || "");
      setLines(
        editTarget.items.map((item) => {
          const product = products.find((p) => p.id === item.itemId);
          return {
            key: crypto.randomUUID(),
            itemId: item.itemId,
            itemName: product?.name || item.itemId,
            lotNumber: item.lotNumber,
            instructedQuantity: item.instructedQuantity,
            memo: item.memo || "",
          };
        }),
      );
    })();
  }, [editTarget, products]);

  // Item7残課題6: 受注画面からの新規作成prefill。editTargetと違いheaderIdを持たないため
  // submit()は通常のPOSTルートを通る(既存の差戻し再提出フローとは独立)
  useEffect(() => {
    if (editTarget || !createPrefill) return;
    void (async () => {
      setPartnerId(createPrefill.partnerId);
      setWarehouseId(createPrefill.warehouseId);
      setLines(
        createPrefill.lines.map((line) => ({
          key: crypto.randomUUID(),
          itemId: line.itemId,
          itemName: line.itemName,
          lotNumber: line.lotNumber,
          instructedQuantity: line.instructedQuantity,
          memo: "",
          salesOrderItemId: line.salesOrderItemId,
        })),
      );
    })();
  }, [editTarget, createPrefill]);

  // Item7残課題6 Phase B: 出荷指示画面の「受注から選ぶ」で?fromSalesOrderId=<受注ID>付きで
  // 遷移してきた場合、その受注の出荷進捗を取得し、残数量がある明細を候補として表示する
  useEffect(() => {
    if (!fromSalesOrderId) return;
    void (async () => {
      try {
        const progress = await apiFetch<ShipmentProgressItemForSuggestion[]>(
          `/api/sales-orders/${encodeURIComponent(fromSalesOrderId)}/shipment-progress`,
        );
        const suggestions = progress
          .filter((item) => item.remainingQuantity > 0 && !!item.itemId)
          .map((item) => ({
            salesOrderItemId: item.salesOrderItemId,
            itemId: item.itemId as string,
            itemName: item.itemName || (item.itemId as string),
            remainingQuantity: item.remainingQuantity,
          }));
        setOrderSuggestions(suggestions);
      } catch {
        // 候補の取得に失敗しても通常の新規作成操作は継続できるため、致命的エラーにはしない
      }
    })();
  }, [fromSalesOrderId]);

  const applyOrderSuggestion = (suggestion: InstructionOrderSuggestion) => {
    setLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        itemId: suggestion.itemId,
        itemName: suggestion.itemName,
        lotNumber: "NONE",
        instructedQuantity: suggestion.remainingQuantity,
        memo: "",
        salesOrderItemId: suggestion.salesOrderItemId,
      },
    ]);
  };

  const addLine = () => {
    setError("");
    if (!selectedProduct) {
      setError("品目を選択してください");
      return;
    }
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setError("数量は0より大きい値を入力してください");
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        itemId: selectedProduct.id,
        itemName: selectedProduct.name,
        lotNumber: lotNumber || "NONE",
        instructedQuantity: qty,
        memo: lineMemo,
      },
    ]);
    setSelectedProduct(null);
    setLotNumber("");
    setQuantity("");
    setLineMemo("");
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const updateLineQuantity = (key: string, value: number) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, instructedQuantity: value } : l)));
  };

  const updateLineMemo = (key: string, value: string) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, memo: value } : l)));
  };

  const resetForm = () => {
    setCustomId("");
    setPartnerId("");
    setWarehouseId("");
    setInstructedShipDate(todayJst());
    setMemo("");
    setLines([]);
  };

  const submit = async () => {
    setError("");
    if (!partnerId) {
      setError("得意先を選択してください");
      return;
    }
    if (!warehouseId) {
      setError("倉庫を選択してください");
      return;
    }
    if (lines.length === 0) {
      setError("明細を1件以上追加してください");
      return;
    }
    setSubmitting(true);
    try {
      const url = editTarget
        ? `/api/shipment-instructions/${editTarget.headerId}`
        : "/api/shipment-instructions/register";
      const defaultErrorMessage = editTarget
        ? "出荷指示の修正・再申請に失敗しました"
        : "出荷指示の作成に失敗しました";
      const result = await apiFetch<{ message: string }>(url, {
        method: editTarget ? "PUT" : "POST",
        json: {
          ...(!editTarget && customId ? { id: customId } : {}),
          partnerId,
          warehouseId,
          instructedShipDate,
          memo: memo || undefined,
          items: lines.map((l) => ({
            itemId: l.itemId,
            lotNumber: l.lotNumber,
            instructedQuantity: l.instructedQuantity,
            memo: l.memo || undefined,
            salesOrderItemId: l.salesOrderItemId || undefined,
          })),
          applicantDepartmentSurrogateId,
        },
        defaultErrorMessage,
      });
      resetForm();
      onSuccess(result.message);
    } catch (err: unknown) {
      const fallback = editTarget
        ? "出荷指示の修正・再申請に失敗しました"
        : "出荷指示の作成に失敗しました";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  };

  return {
    warehouses,
    partners,
    products,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    customId,
    setCustomId,
    partnerId,
    setPartnerId,
    warehouseId,
    setWarehouseId,
    instructedShipDate,
    setInstructedShipDate,
    memo,
    setMemo,
    selectedProduct,
    setSelectedProduct,
    lotNumber,
    setLotNumber,
    quantity,
    setQuantity,
    lineMemo,
    setLineMemo,
    lines,
    addLine,
    removeLine,
    updateLineQuantity,
    updateLineMemo,
    orderSuggestions,
    applyOrderSuggestion,
    submit,
    submitting,
    error,
    setError,
  };
}
