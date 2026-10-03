import { useState, useEffect } from "react";
import { ItemReorderSettingRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

export function useItemReorderSettingForm(
  initialData: ItemReorderSettingRecord | null,
  canCreate: boolean,
  canUpdate: boolean,
  onSuccess: (msg: string) => void,
  onError: (msg: string) => void,
) {
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [reorderPoint, setReorderPoint] = useState<number>(0);
  const [safetyStock, setSafetyStock] = useState<number>(0);
  const [memo, setMemo] = useState("");

  useEffect(() => {
    if (initialData) {
      setItemId(initialData.itemId);
      setWarehouseId(initialData.warehouseId);
      setReorderPoint(initialData.reorderPoint);
      setSafetyStock(initialData.safetyStock);
      setMemo(initialData.memo || "");
    } else {
      setItemId("");
      setWarehouseId("");
      setReorderPoint(0);
      setSafetyStock(0);
      setMemo("");
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((initialData && !canUpdate) || (!initialData && !canCreate)) {
      onError("この操作をする権限がありません");
      return;
    }
    try {
      const payload = {
        itemId,
        warehouseId,
        reorderPoint: Number(reorderPoint),
        safetyStock: Number(safetyStock),
        memo: memo.trim() === "" ? null : memo,
      };
      const url = initialData
        ? `/api/item-reorder-settings/${initialData.id}`
        : "/api/item-reorder-settings/register";
      await apiFetch(url, {
        method: initialData ? "PUT" : "POST",
        json: payload,
        defaultErrorMessage: "保存に失敗しました",
      });
      onSuccess(initialData ? "発注点/安全在庫設定を更新しました" : "発注点/安全在庫設定を登録しました");
    } catch (err: any) {
      onError(err.message);
    }
  };

  return {
    itemId,
    setItemId,
    warehouseId,
    setWarehouseId,
    reorderPoint,
    setReorderPoint,
    safetyStock,
    setSafetyStock,
    memo,
    setMemo,
    handleSubmit,
  };
}
