import { useState, useEffect } from "react";
import { ItemRecord, ItemAttachment } from "../_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import type { ApplicantDepartmentOption } from "../../../types";

interface UseProductFormProps {
  editingId: string | null;
  initialData: ItemRecord | null;
  defaultUnitCode: string;
  canCreate: boolean;
  canUpdate: boolean;
  isProductWfEnabled?: boolean;
  departments?: ApplicantDepartmentOption[];
  onSuccess: (message: string) => void;
  onError: (error: string) => void;
}

export function useProductForm({
  editingId,
  initialData,
  defaultUnitCode,
  canCreate,
  canUpdate,
  isProductWfEnabled = false,
  departments = [],
  onSuccess,
  onError,
}: UseProductFormProps) {
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
  const [itemId, setItemId] = useState("");
  const [itemName, setItemName] = useState("");
  const [isPurchased, setIsPurchased] = useState(false);
  const [isSales, setIsSales] = useState(false);
  const [isService, setIsService] = useState(false);
  const [baseUnitCode, setBaseUnitCode] = useState(defaultUnitCode || "PCS");
  const [taxCategoryCode, setTaxCategoryCode] = useState("TAX_10"); // ▼ 追加
  const [barcode, setBarcode] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [memo, setMemo] = useState("");
  const [itemStatus, setItemStatus] = useState<
    "temporary" | "active" | "suspended"
  >("active");
  const [supplierId, setSupplierId] = useState("");
  const [supplierPartNumber, setSupplierPartNumber] = useState("");
  const [attachments, setAttachments] = useState<ItemAttachment[]>([]);
  const [stdSalesPrice, setStdSalesPrice] = useState<number>(0);
  const [stdPurchasePrice, setStdPurchasePrice] = useState<number>(0);
  const [newLink, setNewLink] = useState({ title: "", externalUrl: "" });
  const [wfStatus, setWfStatus] = useState<string | null>(null);

  // 💡 取引先マスタ等と同じロック機構: 編集中の商品が承認ワークフロー審査中(PENDING)なら、
  // フォームを完全ロックする(上書き・再編集防止)
  const isProductCurrentlyLocked =
    !!editingId &&
    isProductWfEnabled &&
    itemStatus === "temporary" &&
    wfStatus === "PENDING";

  useEffect(() => {
    if (!editingId || !isProductWfEnabled) {
      setWfStatus(null);
      return;
    }
    const fetchWfStatus = async () => {
      try {
        const data = await apiFetch<{ status: string }>(
          `/api/workflow-tasks/request-status/${editingId}?targetType=master_products`,
        );
        setWfStatus(data.status);
      } catch (err) {
        console.error("最新の申請状態の取得に失敗しました", err);
      }
    };
    void fetchWfStatus();
  }, [editingId, isProductWfEnabled, itemStatus]);

  useEffect(() => {
    if (initialData) {
      setItemId(initialData.id);
      setItemName(initialData.name);
      setIsPurchased(initialData.isPurchased);
      setIsSales(initialData.isSales);
      setIsService(initialData.isService);
      setBaseUnitCode(initialData.baseUnitCode);
      setTaxCategoryCode(initialData.taxCategoryCode || "TAX_10"); // ▼ 追加
      setBarcode(initialData.productBarcode || "");
      setAccountCode(initialData.accountCode || "");
      setMemo(initialData.memo || "");
      setItemStatus(initialData.status);
      setSupplierId(initialData.supplierId || "");
      setSupplierPartNumber(initialData.supplierPartNumber || "");
      setAttachments(initialData.attachments || []);
      setStdSalesPrice(initialData.standardSalesPrice || 0);
      setStdPurchasePrice(initialData.standardPurchasePrice || 0);
    } else {
      resetForm();
    }
  }, [initialData]);

  const resetForm = () => {
    setItemId("");
    setItemName("");
    setIsPurchased(false);
    setIsSales(false);
    setIsService(false);
    setBarcode("");
    setAccountCode("");
    setMemo("");
    setStdSalesPrice(0);
    setStdPurchasePrice(0);
    setItemStatus("temporary");
    setSupplierId("");
    setSupplierPartNumber("");
    setAttachments([]);
    setBaseUnitCode(defaultUnitCode || "PCS");
    setTaxCategoryCode("TAX_10"); // ▼ 追加
  };

  const handleFormSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if ((!editingId && !canCreate) || (editingId && !canUpdate)) {
      onError("この操作をする権限がありません");
      return;
    }

    const payload = {
      name: itemName,
      isPurchased,
      isSales,
      isService,
      baseUnitCode,
      taxCategoryCode,
      productBarcode: barcode || null,
      accountCode: accountCode || null,
      memo: memo || null,
      standardSalesPrice: Number(stdSalesPrice),
      standardPurchasePrice: Number(stdPurchasePrice),
      supplierId: supplierId || null,
      supplierPartNumber: supplierPartNumber || null,
      attachments,
    };

    try {
      if (isProductWfEnabled) {
        // 💡 承認機能有効時は、まずマスタ本体へ「仮登録(temporary)」状態として
        // 先行して直接書き込み・更新を行う(取引先・単位等と同じ二段階方式)。
        // 変更申請時は変更後の値を本体に書き込んではいけないため、既存レコードの値を
        // そのまま使い、statusだけをtemporary(ロック)にして送信する。
        let registerResult: { id?: string } | undefined;
        if (editingId) {
          const preSavePayload = {
            name: initialData?.name ?? payload.name,
            isPurchased: initialData?.isPurchased ?? payload.isPurchased,
            isSales: initialData?.isSales ?? payload.isSales,
            isService: initialData?.isService ?? payload.isService,
            baseUnitCode: initialData?.baseUnitCode ?? payload.baseUnitCode,
            taxCategoryCode:
              initialData?.taxCategoryCode ?? payload.taxCategoryCode,
            productBarcode: initialData?.productBarcode ?? null,
            accountCode: initialData?.accountCode ?? null,
            memo: initialData?.memo ?? null,
            standardSalesPrice:
              initialData?.standardSalesPrice ?? payload.standardSalesPrice,
            standardPurchasePrice:
              initialData?.standardPurchasePrice ??
              payload.standardPurchasePrice,
            supplierId: initialData?.supplierId ?? null,
            supplierPartNumber: initialData?.supplierPartNumber ?? null,
            attachments: initialData?.attachments ?? [],
            status: "temporary" as const,
          };
          await apiFetch(`/api/products/${editingId}`, {
            method: "PUT",
            json: preSavePayload,
            defaultErrorMessage:
              "マスタ本体への一時保存(仮登録)に失敗しました",
          });
        } else {
          registerResult = await apiFetch<{ id?: string }>("/api/products/register", {
            method: "POST",
            json: { id: itemId, ...payload, status: "temporary" as const },
            defaultErrorMessage:
              "マスタ本体への一時保存(仮登録)に失敗しました",
          });
        }

        // マスタコード自動採番: itemIdが空欄(自動採番依頼)の場合、pre-save応答でサーバーが
        // 確定させたIDを使う(空欄のままだとワークフロー申請のtargetIdが空になってしまう)
        const targetId = editingId || registerResult?.id || itemId;
        const workflowPayload = {
          ...payload,
          status: editingId ? itemStatus : "active",
        };

        await apiFetch("/api/approvals/request-update", {
          method: "POST",
          json: {
            targetType: "master_products",
            targetId,
            requestType: editingId ? "UPDATE" : "REGISTER",
            payload: workflowPayload,
            applicantDepartmentSurrogateId,
            comment: editingId
              ? `品目[${editingId}] 情報変更申請`
              : `品目 新規登録申請`,
          },
          defaultErrorMessage: "承認の申請に失敗しました",
        });

        onSuccess(
          editingId
            ? "品目の変更承認をワークフローへ申請しました(承認待ちロック)"
            : "品目を仮登録し、承認を申請しました(承認待ち)",
        );
      } else {
        const url = editingId
          ? `/api/products/${editingId}`
          : "/api/products/register";
        await apiFetch(url, {
          method: editingId ? "PUT" : "POST",
          json: {
            ...(editingId ? {} : { id: itemId }),
            ...payload,
            status: itemStatus,
          },
        });

        onSuccess(
          editingId ? "品目情報を更新しました" : "品目マスタを新規登録しました",
        );
      }

      resetForm();
    } catch (err) {
      if (err instanceof Error) onError(err.message);
    }
  };

  return {
    formState: {
      itemId,
      setItemId,
      itemName,
      setItemName,
      isPurchased,
      setIsPurchased,
      isSales,
      setIsSales,
      isService,
      setIsService,
      baseUnitCode,
      setBaseUnitCode,
      taxCategoryCode,
      setTaxCategoryCode, // ▼ 追加
      barcode,
      setBarcode,
      accountCode,
      setAccountCode,
      memo,
      setMemo,
      itemStatus,
      setItemStatus,
      supplierId,
      setSupplierId,
      supplierPartNumber,
      setSupplierPartNumber,
      attachments,
      setAttachments,
      stdSalesPrice,
      setStdSalesPrice,
      stdPurchasePrice,
      setStdPurchasePrice,
      newLink,
      setNewLink,
    },
    resetForm,
    handleFormSubmit,
    isProductCurrentlyLocked,
    applicantDepartmentSurrogateId,
    setApplicantDepartmentSurrogateId,
  };
}
