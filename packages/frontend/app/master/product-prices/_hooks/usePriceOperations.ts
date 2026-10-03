import { useState, useEffect, useCallback } from "react";
import { PriceRecord, MasterItem, MasterPartner, UnitLookup } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { usePaginatedList } from "../../../_shared/hooks/use-paginated-list";
import { usePaginationSetting } from "../../../_shared/hooks/use-pagination-setting";
import { useCsvDownload } from "../../../_shared/hooks/use-csv-download";
import type { ApplicantDepartmentOption } from "../../../types";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

export const initialPriceFormState = {
  id: "",
  itemId: "",
  priceType: "SALES" as "SALES" | "PURCHASE",
  partnerId: "",
  minQuantity: 0,
  unitPrice: 0,
  unitCode: "PCS",
  status: "temporary" as "temporary" | "active" | "suspended",
};

interface UsePriceOperationsProps {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isProductPriceWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
  onClose?: () => void;
}

export function usePriceOperations({
  canCreate,
  canUpdate,
  canDelete,
  isProductPriceWfEnabled = false,
  departments = [],
  onSuccess,
  onError,
  onClose,
}: UsePriceOperationsProps) {
  const confirm = useConfirm();
  const { paginationEnabled } = usePaginationSetting();
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

  const [items, setItems] = useState<MasterItem[]>([]);
  const [partners, setPartners] = useState<MasterPartner[]>([]);
  const [units, setUnits] = useState<UnitLookup[]>([]);

  // フォーム用統合State
  const [formData, setFormData] = useState(initialPriceFormState);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<PriceRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [wfStatus, setWfStatus] = useState<string | null>(null);

  // 検索用State
  const [searchItemId, setSearchItemId] = useState("");
  const [searchPriceType, setSearchPriceType] = useState("");
  const [searchPartnerId, setSearchPartnerId] = useState("");
  const [searchStatus, setSearchStatus] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 💡 取引先マスタ等と同じロック機構: 編集中の単価設定が承認ワークフロー審査中(PENDING)なら、
  // フォームを完全ロックする(上書き・再編集防止)
  const isPriceCurrentlyLocked =
    !!editingId &&
    isProductPriceWfEnabled &&
    formData.status === "temporary" &&
    wfStatus === "PENDING";

  useEffect(() => {
    if (!editingId || !isProductPriceWfEnabled) {
      setWfStatus(null);
      return;
    }
    const fetchWfStatus = async () => {
      try {
        const data = await apiFetch<{ status: string }>(
          `/api/workflow-tasks/request-status/${editingId}?targetType=master_prices`,
        );
        setWfStatus(data.status);
      } catch (err) {
        console.error("最新の申請状態の取得に失敗しました", err);
      }
    };
    void fetchWfStatus();
  }, [editingId, isProductPriceWfEnabled, formData.status]);

  // フィールド更新ハンドラー
  // 💡 itemId変更時は、選択された商品の基本単位(baseUnitCode)へunitCodeを自動追従させる
  // (商品単価マスタの単位を商品マスタの単位と連動させるため)
  const handleInputChange = (
    field: keyof typeof initialPriceFormState,
    value: any,
  ) => {
    setFormData((prev) => {
      if (field === "itemId") {
        const matchedItem = items.find((i) => i.id === value);
        return {
          ...prev,
          itemId: value,
          unitCode: matchedItem?.baseUnitCode || prev.unitCode,
        };
      }
      return { ...prev, [field]: value };
    });
  };

  // フォーム閉じる＆初期化
  // 💡 単位(unitCode)は商品マスタの基本単位(baseUnitCode)と連動させる。単価設定側で独自に
  // 単位を選ばせると商品マスタの単位と食い違うデータが登録できてしまっていたため、
  // 対象品目から自動的に導出する。
  const handleCloseForm = useCallback(() => {
    const defaultItem = items.length > 0 ? items[0] : null;
    setFormData({
      ...initialPriceFormState,
      status: isProductPriceWfEnabled ? "temporary" : "active",
      itemId: defaultItem ? defaultItem.id : "",
      unitCode:
        defaultItem?.baseUnitCode || (units.length > 0 ? units[0].code : "PCS"),
    });
    setEditingId(null);
    setEditingRecord(null);
    setWfStatus(null);
    if (onClose) onClose();
  }, [items, units, isProductPriceWfEnabled, onClose]);

  // マスタデータロード
  useEffect(() => {
    async function loadLookups() {
      try {
        const [itemData, custData, unitData] = await Promise.all([
          apiFetch<MasterItem[]>("/api/products?status=active"),
          apiFetch<MasterPartner[]>("/api/partners?status=all"),
          apiFetch<UnitLookup[]>("/api/units"),
        ]);

        setItems(itemData);
        setPartners(custData);
        setUnits(unitData);

        if (itemData.length > 0) {
          const defaultItem = itemData[0];
          setFormData((prev) => ({
            ...prev,
            itemId: defaultItem.id,
            unitCode: defaultItem.baseUnitCode || prev.unitCode,
          }));
        } else if (unitData.length > 0) {
          setFormData((prev) => ({ ...prev, unitCode: unitData[0].code }));
        }
      } catch (e) {
        console.error("マスタ取得エラー", e);
      }
    }
    void loadLookups();
  }, []);

  // 検索条件を反映した一覧取得
  const searchParams = new URLSearchParams();
  if (searchItemId) searchParams.append("itemId", searchItemId);
  if (searchPriceType) searchParams.append("priceType", searchPriceType);
  if (searchPartnerId) searchParams.append("partnerId", searchPartnerId);
  if (searchStatus) searchParams.append("status", searchStatus);

  const {
    items: prices,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    refetch: syncPrices,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  } = usePaginatedList<PriceRecord>(
    `/api/product-prices?${searchParams.toString()}`,
    { paginationEnabled },
  );

  const handleEditSelect = useCallback((p: PriceRecord) => {
    setEditingId(p.id);
    setEditingRecord(p);
    setFormData({
      id: p.id,
      itemId: p.itemId,
      priceType: p.priceType,
      partnerId: p.partnerId || "",
      minQuantity: p.minQuantity,
      unitPrice: p.unitPrice,
      unitCode: p.unitCode,
      status: p.status || "active",
    });
  }, []);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (editingId && !canUpdate) return;
    if (!editingId && !canCreate) return;
    if (isSubmitting) return;

    setError("");
    setMessage("");
    if (onError) onError("");
    if (onSuccess) onSuccess("");

    if (!formData.itemId) {
      const errMsg = "対象品目を選択してください";
      setError(errMsg);
      if (onError) onError(errMsg);
      return false;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        itemId: formData.itemId,
        priceType: formData.priceType,
        partnerId: formData.partnerId || null,
        minQuantity: Number(formData.minQuantity),
        unitPrice: Number(formData.unitPrice),
        unitCode: formData.unitCode,
      };

      if (isProductPriceWfEnabled) {
        // 💡 承認機能有効時は、まずマスタ本体へ「仮登録(temporary)」状態として
        // 先行して直接書き込み・更新を行う(取引先・単位等と同じ二段階方式)。
        // 変更申請時は変更後の値を本体に書き込んではいけないため、既存レコードの値を
        // そのまま使い、statusだけをtemporary(ロック)にして送信する。
        const preSavePayload = editingId
          ? {
              id: editingId,
              itemId: editingRecord?.itemId ?? payload.itemId,
              priceType: editingRecord?.priceType ?? payload.priceType,
              partnerId: editingRecord?.partnerId ?? null,
              minQuantity: editingRecord?.minQuantity ?? payload.minQuantity,
              unitPrice: editingRecord?.unitPrice ?? payload.unitPrice,
              unitCode: editingRecord?.unitCode ?? payload.unitCode,
              status: "temporary" as const,
            }
          : { ...payload, status: "temporary" as const };

        // 💡 商品単価のIDはサーバー側で自動採番されるため(他マスタのようにユーザー入力の
        // codeを事前に確定できない)、仮登録レスポンスのidを承認申請のtargetIdとして使う。
        const preSaveResult = await apiFetch<{ id: string }>(
          "/api/product-prices/register",
          {
            method: "POST",
            json: preSavePayload,
            defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
          },
        );
        const targetId = editingId || preSaveResult.id;

        const workflowPayload = {
          ...payload,
          id: targetId,
          status: editingId ? formData.status : "active",
        };

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_prices",
            targetId,
            requestType: editingId ? "UPDATE" : "REGISTER",
            payload: workflowPayload,
            applicantDepartmentSurrogateId,
            comment: editingId
              ? `品目単価[${editingId}] 情報変更申請`
              : `品目単価 新規登録申請`,
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });

        setMessage(
          editingId
            ? "単価設定の変更承認をワークフローへ申請しました(承認待ちロック)"
            : "単価設定を仮登録し、承認を申請しました(承認待ち)",
        );
      } else {
        const finalPayload: Record<string, any> = {
          ...payload,
          status: formData.status,
        };
        if (editingId) finalPayload.id = editingId;

        await apiFetch("/api/product-prices/register", {
          method: "POST",
          json: finalPayload,
          defaultErrorMessage: "登録に失敗しました",
        });

        setMessage(
          editingId
            ? "契約単価および適用最小数量を正常に上書き修正しました"
            : "新しい契約個別単価を設定しました",
        );
      }

      handleCloseForm();
      await syncPrices();
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "処理エラー";
      setError(errMsg);
      if (onError) onError(errMsg);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const { download: downloadCsv } = useCsvDownload({
    fileNamePrefix: "product_prices_master",
    onError: () => setError("CSVダウンロード失敗"),
  });
  const handleDownloadCsv = async () => {
    if (!canCreate && !canUpdate) return;
    await downloadCsv(`/api/product-prices/csv-download?${searchParams.toString()}`);
  };

  const handleImportCsvFile = async (file: File) => {
    if (!canCreate || !canUpdate || isProductPriceWfEnabled) return;
    const formDataObj = new FormData();
    formDataObj.append("file", file);
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ message: string }>(
        "/api/product-prices/bulk-register",
        { method: "POST", body: formDataObj },
      );
      setMessage(data.message);
      if (onSuccess) onSuccess(data.message);
      await syncPrices();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "インポートに失敗しました";
      setError(errMsg);
      if (onError) onError(errMsg);
    }
  };

  const handleDeletePrice = async (id: string) => {
    if (!canDelete) return;
    if (!(await confirm("単価設定を削除しますか？"))) return;

    try {
      await apiFetch(`/api/product-prices/${id}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });

      setMessage("単価設定を削除しました");
      if (editingId === id) handleCloseForm();
      await syncPrices();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "削除に失敗しました";
      setError(errMsg);
      if (onError) onError(errMsg);
    }
  };

  // 無効化。取引先・単位等と同じく、承認機能有効時は直接無効化せず承認申請を経由する。
  const handleSuspendPrice = async (p: PriceRecord) => {
    if (!canDelete || isSubmitting) return;
    if (!(await confirm(`単価設定 [${p.id}] を無効化しますか？`))) return;

    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      if (isProductPriceWfEnabled) {
        await apiFetch("/api/product-prices/register", {
          method: "POST",
          json: {
            id: p.id,
            itemId: p.itemId,
            priceType: p.priceType,
            partnerId: p.partnerId,
            minQuantity: p.minQuantity,
            unitPrice: p.unitPrice,
            unitCode: p.unitCode,
            status: "temporary",
          },
          defaultErrorMessage: "マスタ本体への一時保存(仮登録)に失敗しました",
        });

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_prices",
            targetId: p.id,
            requestType: "UPDATE",
            payload: {
              itemId: p.itemId,
              priceType: p.priceType,
              partnerId: p.partnerId,
              minQuantity: p.minQuantity,
              unitPrice: p.unitPrice,
              unitCode: p.unitCode,
              status: "suspended",
            },
            applicantDepartmentSurrogateId,
            comment: `単価設定[${p.id}] 無効化申請`,
          },
          defaultErrorMessage: "無効化の申請に失敗しました",
        });

        setMessage("単価設定の無効化をワークフローへ申請しました(承認待ちロック)");
      } else {
        await apiFetch("/api/product-prices/register", {
          method: "POST",
          json: {
            id: p.id,
            itemId: p.itemId,
            priceType: p.priceType,
            partnerId: p.partnerId,
            minQuantity: p.minQuantity,
            unitPrice: p.unitPrice,
            unitCode: p.unitCode,
            status: "suspended",
          },
          defaultErrorMessage: "無効化に失敗しました",
        });
        setMessage("単価設定を無効化しました");
      }

      if (editingId === p.id) handleCloseForm();
      await syncPrices();
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearFilters = useCallback(() => {
    setSearchItemId("");
    setSearchPriceType("");
    setSearchPartnerId("");
    setSearchStatus("");
  }, []);

  return {
    prices,
    items,
    partners,
    units,
    formData,
    editingId,
    isPriceCurrentlyLocked,
    isSubmitting,
    searchItemId,
    setSearchItemId,
    searchPriceType,
    setSearchPriceType,
    searchPartnerId,
    setSearchPartnerId,
    searchStatus,
    setSearchStatus,
    message,
    error,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
    handleInputChange,
    handleCloseForm,
    handleEditSelect,
    handleSubmit,
    handleDownloadCsv,
    handleImportCsvFile,
    handleDeletePrice,
    handleSuspendPrice,
    handleClearFilters,
    paginationEnabled,
    page,
    setPage,
    limit,
    setLimit,
    total,
    totalPages,
    sortBy,
    sortDirection,
    sortKeys,
    setSort,
  };
}
