"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { matchProductByScanCode } from "../../../_shared/product-scan-code";
import {
  LocationRecord,
  ProductRecord,
  StockRecord,
  WarehouseRecord,
} from "../../stock/_types";
import { AuditRecord } from "../_types";
import type { ApplicantDepartmentOption } from "../../../types";

export interface AuditEditTarget {
  auditId: string;
  audit: AuditRecord;
}

/**
 * 棚卸実施: 入出庫(useStockReceiptForm/useStockShipmentForm)と異なり、
 * 1回の実施=1レコード(1ロケーション×1品目)のためlines配列による明細バッチは持たず、
 * 選択→実棚数量入力→即送信の単発フローにする(「軽量方式」の仕様)。
 */
export function useStockAuditForm(
  onSuccess: (message: string) => void,
  editTarget?: AuditEditTarget | null,
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
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [stocks, setStocks] = useState<StockRecord[]>([]);

  const [selectedLocationState, setSelectedLocationState] = useState<LocationRecord | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductRecord | null>(null);
  const [countedQuantity, setCountedQuantity] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reloadStocks = useCallback(async () => {
    const result = await apiFetch<StockRecord[]>("/api/stocks");
    setStocks(result);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [locs, whs, prods] = await Promise.all([
          apiFetch<LocationRecord[]>("/api/locations?status=active"),
          apiFetch<WarehouseRecord[]>("/api/warehouses?status=active"),
          apiFetch<ProductRecord[]>("/api/products?status=active"),
        ]);
        setLocations(locs);
        setWarehouses(whs);
        setProducts(prods);
        await reloadStocks();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "マスタ情報の取得に失敗しました");
      }
    })();
  }, [reloadStocks]);

  // 修正して再提出: editTargetが指定された場合、マスタ読込完了後に元の内容を復元する
  useEffect(() => {
    if (!editTarget) return;
    if (locations.length === 0 || products.length === 0) return;
    void (async () => {
      const location = locations.find((l) => l.id === editTarget.audit.locationId) || null;
      const product = products.find((p) => p.id === editTarget.audit.itemId) || null;
      setSelectedLocationState(location);
      setSelectedProduct(product);
      setCountedQuantity(String(editTarget.audit.countedQuantity));
      setMemo(editTarget.audit.memo || "");
    })();
  }, [editTarget, locations, products]);

  const findLocationById = useCallback(
    (code: string) => locations.find((l) => l.id === code) || null,
    [locations],
  );

  const findProductByBarcode = useCallback(
    (code: string) => matchProductByScanCode(products, code),
    [products],
  );

  const stocksAtLocation = useCallback(
    (locationId: string) => stocks.filter((s) => s.locationId === locationId),
    [stocks],
  );

  const matchedStock = useCallback(
    (locationId: string, itemId: string) =>
      stocksAtLocation(locationId).find((s) => s.itemId === itemId) || null,
    [stocksAtLocation],
  );

  // ロケーション確定時、そこに紐づく在庫が1件だけであれば品目を自動選択する(1ロケーション=1品目運用)。
  // 該当在庫がない(まだ一度も計上されていない)場合は品目未選択のままとし、手動選択を促す
  const selectLocation = useCallback(
    (location: LocationRecord | null) => {
      setSelectedLocationState(location);
      setError("");
      if (!location) {
        setSelectedProduct(null);
        return;
      }
      const candidates = stocksAtLocation(location.id);
      if (candidates.length === 1) {
        const product = products.find((p) => p.id === candidates[0].itemId) || null;
        setSelectedProduct(product);
      } else {
        setSelectedProduct(null);
      }
    },
    [stocksAtLocation, products],
  );

  const theoreticalQuantity =
    selectedLocationState && selectedProduct
      ? (matchedStock(selectedLocationState.id, selectedProduct.id)?.quantity ?? 0)
      : null;

  const differenceQuantity =
    theoreticalQuantity !== null && countedQuantity !== "" && !Number.isNaN(Number(countedQuantity))
      ? Number(countedQuantity) - theoreticalQuantity
      : null;

  const submit = useCallback(async () => {
    setError("");
    if (!selectedLocationState) {
      setError("ロケーションを選択してください");
      return;
    }
    if (!selectedProduct) {
      setError("品目を選択してください");
      return;
    }
    const qty = Number(countedQuantity);
    if (countedQuantity === "" || Number.isNaN(qty) || qty < 0) {
      setError("実棚数量は0以上の数値で入力してください");
      return;
    }

    setSubmitting(true);
    try {
      const stock = matchedStock(selectedLocationState.id, selectedProduct.id);
      const url = editTarget ? `/api/stock-audits/${editTarget.auditId}` : "/api/stock-audits/register";
      const defaultErrorMessage = editTarget
        ? "棚卸の修正・再申請に失敗しました"
        : "棚卸確定に失敗しました";
      const result = await apiFetch<{ message: string }>(url, {
        method: editTarget ? "PUT" : "POST",
        json: {
          itemId: selectedProduct.id,
          warehouseId: stock?.warehouseId ?? selectedLocationState.warehouseId,
          locationId: selectedLocationState.id,
          ...(stock?.lotNumber ? { lotNumber: stock.lotNumber } : {}),
          ...(stock?.qualityStatus ? { qualityStatus: stock.qualityStatus } : {}),
          countedQuantity: qty,
          ...(memo.trim() ? { memo: memo.trim() } : {}),
          applicantDepartmentSurrogateId,
        },
        defaultErrorMessage,
      });
      setSelectedLocationState(null);
      setSelectedProduct(null);
      setCountedQuantity("");
      setMemo("");
      await reloadStocks();
      onSuccess(result.message);
    } catch (err: unknown) {
      const fallback = editTarget ? "棚卸の修正・再申請に失敗しました" : "棚卸確定に失敗しました";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  }, [selectedLocationState, selectedProduct, countedQuantity, memo, matchedStock, onSuccess, reloadStocks, editTarget, applicantDepartmentSurrogateId]);

  return {
    locations,
    warehouses,
    products,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    selectedLocation: selectedLocationState,
    setSelectedLocation: selectLocation,
    selectedProduct,
    setSelectedProduct,
    countedQuantity,
    setCountedQuantity,
    memo,
    setMemo,
    theoreticalQuantity,
    differenceQuantity,
    submit,
    submitting,
    error,
    setError,
    findLocationById,
    findProductByBarcode,
    stocksAtLocation,
    matchedStock,
  };
}
