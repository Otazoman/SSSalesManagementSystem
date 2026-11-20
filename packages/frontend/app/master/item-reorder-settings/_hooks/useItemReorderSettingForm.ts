import { useState, useEffect } from "react";
import { ItemReorderSettingRecord } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

// BUG-098: 会社設定の発注点/安全在庫の承認が ON の時は、単位マスタと同じ「仮登録 → 申請 → 承認で有効」
export interface ReorderApprovalOptions {
  isWfEnabled?: boolean;
  applicantDepartmentSurrogateId?: string | null;
}

export function useItemReorderSettingForm(
  initialData: ItemReorderSettingRecord | null,
  canCreate: boolean,
  canUpdate: boolean,
  onSuccess: (msg: string) => void,
  onError: (msg: string) => void,
  { isWfEnabled = false, applicantDepartmentSurrogateId = null }: ReorderApprovalOptions = {},
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

  // BUG-098: 編集中の設定の最新の申請の状態。承認待ち(PENDING)の間は編集できない(単位マスタと同じロック)
  // 取得した状態は設定の番号と一緒に持ち、編集中の設定のものだけを使う
  const [fetchedWfStatus, setFetchedWfStatus] = useState<{ id: string; status: string } | null>(null);
  const editingId = initialData?.id ?? null;
  useEffect(() => {
    if (!editingId || !isWfEnabled) return;
    void apiFetch<{ status: string }>(
      `/api/workflow-tasks/request-status/${encodeURIComponent(editingId)}?targetType=master_item_reorder_settings`,
    )
      .then((data) => setFetchedWfStatus({ id: editingId, status: data.status }))
      .catch((err) => console.error("最新の申請状態の取得に失敗しました", err));
  }, [editingId, isWfEnabled]);
  const wfStatus = isWfEnabled && initialData && fetchedWfStatus?.id === initialData.id ? fetchedWfStatus.status : null;
  const isLocked = !!initialData && isWfEnabled && initialData.status === "temporary" && wfStatus === "PENDING";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((initialData && !canUpdate) || (!initialData && !canCreate)) {
      onError("この操作をする権限がありません");
      return;
    }
    if (isLocked) {
      onError("承認待ちのため変更できません");
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
      if (isWfEnabled) {
        // BUG-098: 新規は仮登録(状態はサーバーが決める)。変更は、変更後の値を本体に書かず、今の内容のまま状態だけ temporary にしてロックする
        let targetId: string;
        if (initialData) {
          await apiFetch(`/api/item-reorder-settings/${initialData.id}`, {
            method: "PUT",
            json: {
              itemId: initialData.itemId,
              warehouseId: initialData.warehouseId,
              reorderPoint: initialData.reorderPoint,
              safetyStock: initialData.safetyStock,
              memo: initialData.memo,
              status: "temporary",
            },
            defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
          });
          targetId = initialData.id;
        } else {
          const created = await apiFetch<{ id: string }>("/api/item-reorder-settings/register", {
            method: "POST",
            json: payload,
            defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
          });
          targetId = created.id;
        }
        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_item_reorder_settings",
            targetId,
            requestType: initialData ? "UPDATE" : "REGISTER",
            payload: { ...payload, status: "active" },
            applicantDepartmentSurrogateId,
            comment: initialData ? "発注点/安全在庫設定 変更申請" : "発注点/安全在庫設定 新規登録申請",
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });
        onSuccess(
          initialData
            ? "発注点/安全在庫設定の変更をワークフローへ申請しました(承認待ちロック)"
            : "発注点/安全在庫設定を仮登録し、承認を申請しました(承認待ち)",
        );
        return;
      }
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
    isLocked,
  };
}
