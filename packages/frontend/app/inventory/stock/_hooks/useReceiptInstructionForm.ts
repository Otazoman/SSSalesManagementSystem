"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  PartnerRecord,
  ProductRecord,
  WarehouseRecord,
  ReceiptInstructionItemRecord,
} from "../_types";
import type { ApplicantDepartmentOption } from "../../../types";
import { todayJst } from "../../../_shared/jst-date";

export interface ReceiptInstructionLineDraft {
  key: string;
  itemId: string;
  itemName: string;
  lotNumber: string;
  instructedQuantity: number;
  memo: string;
}

export interface ReceiptInstructionEditTarget {
  headerId: string;
  partnerId: string;
  warehouseId: string;
  instructedReceiveDate: string;
  memo: string | null;
  items: ReceiptInstructionItemRecord[];
}

// Item9: 発注画面の「入荷指示を作成する」・入荷指示画面の「発注から選ぶ」からの新規作成prefill
// (sales/orders側のShipmentInstructionCreatePrefillと同じ方針)。発注には受注のような
// 倉庫引当(reservation)が無いため、warehouseIdは含めずユーザーに選択させる
export interface ReceiptInstructionCreatePrefill {
  partnerId: string;
  lines: Array<{
    itemId: string;
    itemName: string;
    instructedQuantity: number;
  }>;
}

export function useReceiptInstructionForm(
  onSuccess: (message: string) => void,
  editTarget?: ReceiptInstructionEditTarget | null,
  departments: ApplicantDepartmentOption[] = [],
  createPrefill?: ReceiptInstructionCreatePrefill | null,
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
  const [instructedReceiveDate, setInstructedReceiveDate] = useState(
    todayJst(),
  );
  const [memo, setMemo] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductRecord | null>(null);
  const [lotNumber, setLotNumber] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lineMemo, setLineMemo] = useState("");
  const [lines, setLines] = useState<ReceiptInstructionLineDraft[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [whs, partnerList, prods] = await Promise.all([
          apiFetch<WarehouseRecord[]>("/api/warehouses?status=active"),
          apiFetch<PartnerRecord[]>("/api/partners?status=active"),
          apiFetch<ProductRecord[]>("/api/products?status=active"),
        ]);
        // 入荷指示は外部倉庫のみ、仕入先(SUPPLIER/BOTH)のみを選択肢にする
        setWarehouses(whs.filter((w) => w.warehouseType === "EXTERNAL"));
        setPartners(partnerList.filter((p) => p.type === "SUPPLIER" || p.type === "BOTH"));
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
      setInstructedReceiveDate(editTarget.instructedReceiveDate.slice(0, 10));
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

  // Item9: 発注からの新規作成prefill。editTargetと違いheaderIdを持たないため
  // submit()は通常のPOSTルートを通る(既存の差戻し再提出フローとは独立)
  useEffect(() => {
    if (editTarget || !createPrefill) return;
    void (async () => {
      setPartnerId(createPrefill.partnerId);
      setLines(
        createPrefill.lines.map((line) => ({
          key: crypto.randomUUID(),
          itemId: line.itemId,
          itemName: line.itemName,
          lotNumber: "NONE",
          instructedQuantity: line.instructedQuantity,
          memo: "",
        })),
      );
    })();
  }, [editTarget, createPrefill]);

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
    setInstructedReceiveDate(todayJst());
    setMemo("");
    setLines([]);
  };

  const submit = async () => {
    setError("");
    if (!partnerId) {
      setError("仕入先を選択してください");
      return;
    }
    if (!warehouseId) {
      setError("外部倉庫を選択してください");
      return;
    }
    if (lines.length === 0) {
      setError("明細を1件以上追加してください");
      return;
    }
    setSubmitting(true);
    try {
      const url = editTarget
        ? `/api/receipt-instructions/${editTarget.headerId}`
        : "/api/receipt-instructions/register";
      const defaultErrorMessage = editTarget
        ? "入荷指示の修正・再申請に失敗しました"
        : "入荷指示の作成に失敗しました";
      const result = await apiFetch<{ message: string }>(url, {
        method: editTarget ? "PUT" : "POST",
        json: {
          ...(!editTarget && customId ? { id: customId } : {}),
          partnerId,
          warehouseId,
          instructedReceiveDate,
          memo: memo || undefined,
          items: lines.map((l) => ({
            itemId: l.itemId,
            lotNumber: l.lotNumber,
            instructedQuantity: l.instructedQuantity,
            memo: l.memo || undefined,
          })),
          applicantDepartmentSurrogateId,
        },
        defaultErrorMessage,
      });
      resetForm();
      onSuccess(result.message);
    } catch (err: unknown) {
      const fallback = editTarget
        ? "入荷指示の修正・再申請に失敗しました"
        : "入荷指示の作成に失敗しました";
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
    instructedReceiveDate,
    setInstructedReceiveDate,
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
    submit,
    submitting,
    error,
    setError,
  };
}
