"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { matchProductByScanCode } from "../../../_shared/product-scan-code";
import {
  LocationRecord,
  PartnerRecord,
  ProductRecord,
  ReceiptItemRecord,
  ReceiptLineDraft,
  WarehouseRecord,
} from "../_types";
import type { ApplicantDepartmentOption } from "../../../types";
import { todayJst } from "../../../_shared/jst-date";

export interface ReceiptEditTarget {
  headerId: string;
  items: ReceiptItemRecord[];
  // Item9: 発注紐付けの復元用(任意、未指定時は既存挙動どおりnull扱い)
  orderId?: string | null;
  // 新規要望(2026-09-23): 倉庫間移動。仕入先の代わりに移動元倉庫が設定されている場合がある
  sourceWarehouseId?: string | null;
}

interface ReceiptInstructionOption {
  id: string;
  warehouseId: string;
  status: string;
}

interface ReceiptInstructionItemOption {
  id: string;
  itemId: string;
  lotNumber: string;
  instructedQuantity: number;
  accountCode: string;
}

interface PurchaseOrderOption {
  id: string;
  status: string;
  // BUG-062: 選択肢に件名・仕入先名を添えるため
  title?: string | null;
  partnerId?: string | null;
}

interface PurchaseOrderItemOption {
  orderItemId: string;
  itemId: string | null;
  itemName: string | null;
  remainingQuantity: number;
}

// Item6 Phase6-4: 自社倉庫の入庫(/inventory/stock)と外部倉庫の実績入力(/inventory/instructions)の
// 両方でこのフォームを共有する。warehouseTypeで倉庫選択肢を絞り込み、EXTERNALの場合のみ
// 仕入先・入荷指示の紐付け(消込)入力を追加で有効にする
export function useStockReceiptForm(
  onSuccess: (message: string) => void,
  editTarget?: ReceiptEditTarget | null,
  warehouseType: "INTERNAL" | "EXTERNAL" = "INTERNAL",
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

  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  // 新規要望(2026-09-23): 倉庫間移動の移動元倉庫選択肢(自社/外部を問わず全倉庫が対象)
  const [allWarehouses, setAllWarehouses] = useState<WarehouseRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [instructions, setInstructions] = useState<ReceiptInstructionOption[]>([]);

  const [selectedLocation, setSelectedLocation] = useState<LocationRecord | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductRecord | null>(null);
  const [lotNumber, setLotNumber] = useState("");
  const [quantity, setQuantity] = useState("");
  const [inspectionStatus, setInspectionStatus] = useState("PASSED");
  const [inspectionMemo, setInspectionMemo] = useState("");
  const [lines, setLines] = useState<ReceiptLineDraft[]>([]);
  // Item6 Phase6-4: 仕入先(任意)。外部倉庫実績入力でのみ使う
  const [partnerId, setPartnerIdState] = useState("");
  // 新規要望(2026-09-23): 倉庫間移動の移動元倉庫(任意、仕入先と排他)
  const [sourceWarehouseId, setSourceWarehouseIdState] = useState("");
  // 仕入先/移動元倉庫は排他選択(一方を選ぶと他方は自動でクリアする)
  const setPartnerId = useCallback((value: string) => {
    setPartnerIdState(value);
    if (value) setSourceWarehouseIdState("");
  }, []);
  const setSourceWarehouseId = useCallback((value: string) => {
    setSourceWarehouseIdState(value);
    if (value) setPartnerIdState("");
  }, []);
  // Item6 Phase6-4: 消込対象の入荷指示(任意)。指定すると指示側の充足状況が更新される。
  // 自社倉庫の入庫でも選択可能(ユーザー要望により指示の発行元(外部倉庫)を問わず選べる)
  const [receiptInstructionId, setReceiptInstructionId] = useState("");
  const [instructionItems, setInstructionItems] = useState<ReceiptInstructionItemOption[]>([]);
  // Item9: 「発注から選ぶ」(発注→入荷の消込連携)。倉庫種別を問わず選べる(receiptInstructionIdと同じ方針)
  const [orders, setOrders] = useState<PurchaseOrderOption[]>([]);
  // BUG-062: 「発注から選ぶ」の選択肢に仕入先名を添えるための取引先名(倉庫種別を問わず取得する)
  const [partnerNames, setPartnerNames] = useState<Record<string, string>>({});
  const [orderId, setOrderId] = useState("");
  const [orderItems, setOrderItems] = useState<PurchaseOrderItemOption[]>([]);
  const [selectedOrderItemId, setSelectedOrderItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [locs, whs, prods] = await Promise.all([
          apiFetch<LocationRecord[]>("/api/locations?status=active"),
          apiFetch<WarehouseRecord[]>("/api/warehouses?status=active"),
          apiFetch<ProductRecord[]>("/api/products?status=active"),
        ]);
        // Item6 Phase6-4: 自社倉庫スキャンUIには外部倉庫を選択肢に出さない(逆にEXTERNAL指定時は
        // 外部倉庫のみ選択肢にする)。ロケーションはwarehouseId経由でしか倉庫区分を判定できないため、
        // warehousesと同様に絞り込む
        const typedWarehouses = whs.filter((w) => w.warehouseType === warehouseType);
        const typedWarehouseIds = new Set(typedWarehouses.map((w) => w.id));
        setLocations(locs.filter((l) => typedWarehouseIds.has(l.warehouseId)));
        setWarehouses(typedWarehouses);
        // 新規要望(2026-09-23): 倉庫間移動の移動元は自社/外部を問わず選べるようにする
        setAllWarehouses(whs);
        setProducts(prods);

        // Item6 消込データ引渡し: 入荷指示の一覧は倉庫種別を問わず取得する(自社倉庫の入庫でも、
        // 外部倉庫向けに発行済みの指示を消込対象として選べるようにするため)
        const instructionList = await apiFetch<{ data: ReceiptInstructionOption[] }>(
          "/api/receipt-instructions?limit=200",
        );
        setInstructions(
          instructionList.data.filter(
            (i) => i.status === "APPROVED" || i.status === "PARTIALLY_FULFILLED",
          ),
        );

        // Item9: 発注→入荷の消込連携。倉庫種別を問わず選べる(消込対象の入荷指示と同じ理由)
        const orderList = await apiFetch<{ data: PurchaseOrderOption[] }>(
          "/api/purchase-orders?status=APPROVED&limit=200",
        );
        setOrders(orderList.data);
        // 選択肢の表示用のため、取得に失敗しても入庫の操作は続けられるようにする
        apiFetch<PartnerRecord[]>("/api/partners")
          .then((list) => setPartnerNames(Object.fromEntries(list.map((p) => [p.id, p.name]))))
          .catch((err) => console.error("取引先名の取得に失敗しました", err));

        if (warehouseType === "EXTERNAL") {
          const partnerList = await apiFetch<PartnerRecord[]>("/api/partners?status=active");
          setPartners(partnerList.filter((p) => p.type === "SUPPLIER" || p.type === "BOTH"));
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "マスタ情報の取得に失敗しました");
      }
    })();
  }, [warehouseType]);

  // 修正して再提出: editTargetが指定された場合、マスタ読込完了後に元の明細をlinesへ復元する
  useEffect(() => {
    if (!editTarget) return;
    if (locations.length === 0 || products.length === 0 || warehouses.length === 0) return;
    void (async () => {
      setOrderId(editTarget.orderId || "");
      // 新規要望(2026-09-23): 倉庫間移動の移動元倉庫を復元する
      setSourceWarehouseIdState(editTarget.sourceWarehouseId || "");
      setLines(
        editTarget.items.map((item) => {
          const location = locations.find((l) => l.id === item.locationId);
          const product = products.find((p) => p.id === item.itemId);
          const warehouse = warehouses.find((w) => w.id === item.warehouseId);
          return {
            key: crypto.randomUUID(),
            itemId: item.itemId,
            itemName: product?.name || item.itemId,
            warehouseId: item.warehouseId,
            warehouseName: warehouse?.name || item.warehouseId,
            locationId: item.locationId,
            locationName: location?.name || item.locationId,
            lotNumber: item.lotNumber,
            quantity: item.receivedQuantity,
            inspectionStatus: item.inspectionStatus || "PASSED",
            inspectionMemo: "",
            orderItemId: item.orderItemId || null,
          };
        }),
      );
    })();
  }, [editTarget, locations, products, warehouses]);

  // Item6 消込データ引渡し: 消込対象の入荷指示を選ぶと、その明細(品目・ロット・数量・勘定科目)を
  // 取得しておき、applyInstructionItemでワンクリック入力欄へ反映できるようにする
  useEffect(() => {
    void (async () => {
      if (!receiptInstructionId) {
        setInstructionItems([]);
        return;
      }
      try {
        const detail = await apiFetch<{ items: ReceiptInstructionItemOption[] }>(
          `/api/receipt-instructions/${receiptInstructionId}`,
        );
        setInstructionItems(detail.items);
      } catch {
        setInstructionItems([]);
      }
    })();
  }, [receiptInstructionId]);

  const applyInstructionItem = useCallback(
    (item: ReceiptInstructionItemOption) => {
      const product = products.find((p) => p.id === item.itemId);
      if (product) setSelectedProduct(product);
      setLotNumber(item.lotNumber === "NONE" ? "" : item.lotNumber);
      setQuantity(String(item.instructedQuantity));
    },
    [products],
  );

  // Item9: 消込対象の発注を選ぶと、その明細(品目・残数量)を取得しておき、applyOrderItemで
  // ワンクリック入力欄へ反映できるようにする(消込対象の入荷指示と同じパターン)
  useEffect(() => {
    void (async () => {
      if (!orderId) {
        setOrderItems([]);
        return;
      }
      try {
        const progress = await apiFetch<PurchaseOrderItemOption[]>(
          `/api/purchase-orders/${orderId}/receipt-progress`,
        );
        setOrderItems(progress.filter((i) => i.remainingQuantity > 0));
      } catch {
        setOrderItems([]);
      }
    })();
  }, [orderId]);

  const applyOrderItem = useCallback(
    (item: PurchaseOrderItemOption) => {
      const product = products.find((p) => p.id === item.itemId);
      if (product) setSelectedProduct(product);
      setQuantity(String(item.remainingQuantity));
      setSelectedOrderItemId(item.orderItemId);
    },
    [products],
  );

  const findProductByBarcode = useCallback(
    (code: string) => matchProductByScanCode(products, code),
    [products],
  );

  const findLocationById = useCallback(
    (code: string) => locations.find((l) => l.id === code) || null,
    [locations],
  );

  const addLine = useCallback(() => {
    setError("");
    if (!selectedLocation) {
      setError("ロケーションを選択してください");
      return;
    }
    if (!selectedProduct) {
      setError("品目を選択してください");
      return;
    }
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setError("数量は0より大きい値を入力してください");
      return;
    }
    const warehouse = warehouses.find((w) => w.id === selectedLocation.warehouseId);
    setLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        itemId: selectedProduct.id,
        itemName: selectedProduct.name,
        warehouseId: selectedLocation.warehouseId,
        warehouseName: warehouse?.name || selectedLocation.warehouseId,
        locationId: selectedLocation.id,
        locationName: selectedLocation.name,
        lotNumber: lotNumber || "NONE",
        quantity: qty,
        inspectionStatus,
        inspectionMemo,
        orderItemId: selectedOrderItemId,
      },
    ]);
    setSelectedProduct(null);
    setQuantity("");
    setLotNumber("");
    setInspectionStatus("PASSED");
    setInspectionMemo("");
    setSelectedOrderItemId(null);
  }, [
    selectedLocation,
    selectedProduct,
    quantity,
    lotNumber,
    inspectionStatus,
    inspectionMemo,
    warehouses,
    selectedOrderItemId,
  ]);

  const removeLine = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  // 修正して再提出時、事前に復元された明細行の数量をその場で修正できるようにする
  // (削除して数量入力欄から再度追加し直さないと編集できないのは分かりにくいため)
  const updateLineQuantity = useCallback((key: string, quantity: number) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity } : l)));
  }, []);

  const submit = useCallback(async () => {
    setError("");
    if (lines.length === 0) {
      setError("明細を1件以上追加してください");
      return;
    }
    setSubmitting(true);
    try {
      const url = editTarget ? `/api/stock-receipts/${editTarget.headerId}` : "/api/stock-receipts/register";
      const defaultErrorMessage = editTarget ? "入庫の修正・再申請に失敗しました" : "入庫確定に失敗しました";
      const result = await apiFetch<{ message: string }>(url, {
        method: editTarget ? "PUT" : "POST",
        json: {
          receivedDate: todayJst(),
          items: lines.map((l) => ({
            itemId: l.itemId,
            warehouseId: l.warehouseId,
            locationId: l.locationId,
            lotNumber: l.lotNumber,
            quantity: l.quantity,
            inspectionStatus: l.inspectionStatus,
            ...(l.inspectionMemo ? { inspectionMemo: l.inspectionMemo } : {}),
            orderItemId: l.orderItemId || null,
          })),
          // Item6 消込データ引渡し: 指示との紐付け(消込)は倉庫種別を問わず送る。
          // 仕入先は引き続き外部倉庫実績入力でのみ入力させる
          receiptInstructionId: receiptInstructionId || null,
          // Item9: 発注→入荷の消込連携(倉庫種別を問わず送る、消込対象の入荷指示と同じ方針)
          orderId: orderId || null,
          applicantDepartmentSurrogateId,
          ...(warehouseType === "EXTERNAL" ? { partnerId: partnerId || null } : {}),
          // 新規要望(2026-09-23): 倉庫間移動の移動元倉庫(仕入先と排他、倉庫種別を問わず送る)
          sourceWarehouseId: sourceWarehouseId || null,
        },
        defaultErrorMessage,
      });
      setLines([]);
      setPartnerId("");
      setSourceWarehouseId("");
      setReceiptInstructionId("");
      setOrderId("");
      onSuccess(result.message);
    } catch (err: unknown) {
      const fallback = editTarget ? "入庫の修正・再申請に失敗しました" : "入庫確定に失敗しました";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  }, [
    lines,
    onSuccess,
    editTarget,
    warehouseType,
    partnerId,
    sourceWarehouseId,
    receiptInstructionId,
    orderId,
    applicantDepartmentSurrogateId,
    setPartnerId,
    setSourceWarehouseId,
  ]);

  return {
    locations,
    warehouses,
    allWarehouses,
    products,
    partners,
    instructions,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    partnerId,
    setPartnerId,
    sourceWarehouseId,
    setSourceWarehouseId,
    receiptInstructionId,
    setReceiptInstructionId,
    instructionItems,
    applyInstructionItem,
    orders,
    // BUG-062: 「発注番号 件名(仕入先名)」の形の選択肢(件名・仕入先名が無ければ省く)
    orderOptions: orders.map((o) => {
      const partnerName = o.partnerId ? partnerNames[o.partnerId] : undefined;
      return {
        id: o.id,
        label: `${o.id}${o.title ? ` ${o.title}` : ""}${partnerName ? `(${partnerName})` : ""}`,
      };
    }),
    orderId,
    setOrderId,
    orderItems,
    applyOrderItem,
    selectedLocation,
    setSelectedLocation,
    selectedProduct,
    setSelectedProduct,
    lotNumber,
    setLotNumber,
    quantity,
    setQuantity,
    inspectionStatus,
    setInspectionStatus,
    inspectionMemo,
    setInspectionMemo,
    lines,
    addLine,
    removeLine,
    updateLineQuantity,
    submit,
    submitting,
    error,
    setError,
    findProductByBarcode,
    findLocationById,
  };
}
