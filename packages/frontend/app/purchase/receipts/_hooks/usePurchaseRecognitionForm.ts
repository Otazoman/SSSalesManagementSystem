import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  PurchaseRecognitionRecord,
  PartnerMaster,
  ProductMaster,
  UserOption,
  PurchaseRecognitionItem,
  PurchaseRecognitionAttachment,
  TaxCategoryLookup,
  OrderItemProgress,
} from "../_types";
import { roundTaxAmount } from "../../../_shared/tax-amounts";
import { useTaxRoundingMode } from "../../../_shared/hooks/use-tax-rounding-mode";
import { todayJst } from "../../../_shared/jst-date";

interface CompanySettingsResponse {
  company_name?: string;
  company_address?: string;
  company_tel?: string;
  company_fax?: string;
}

interface UsePurchaseRecognitionFormProps {
  editingId: string | null;
  recognitionId: string;
  partners: PartnerMaster[];
  products: ProductMaster[];
  userMaster: UserOption[];
  departments: { id: string; name: string }[];
  taxCategories?: TaxCategoryLookup[];
  onSubmit: (formData: any) => void;
  initialData?: any;
  // 追加要望L-2-a: 元の仕入から「赤伝を起票」する場合の元伝票(新規フォームへプレフィルする)
  redSlipSource?: any;
  currentUserEmployeeNumber?: string;
}

/**
 * sales/invoices/_hooks/useSalesInvoiceForm.tsと同じ構成の状態管理・副作用・イベントハンドラを
 * purchase_recognitions向けに移植したもの。メール送信・Ver.UP関連の状態は対象外
 * (承認済み実装計画により除外)。代わりに「発注から選択」ピッカー(applyOrderSelection)を持つ。
 * 発注側には特別単価API(fetchSpecialPrice相当)が存在しないため、マスタ選択時の単価自動補完は行わない
 * (purchase/orders/_hooks/usePurchaseOrderOperations.tsと同じ方針)。
 */
export function usePurchaseRecognitionForm({
  editingId,
  recognitionId,
  partners,
  products,
  userMaster,
  departments,
  taxCategories = [],
  onSubmit,
  initialData,
  redSlipSource,
  currentUserEmployeeNumber,
}: UsePurchaseRecognitionFormProps) {
  const [recognitionTitle, setRecognitionTitle] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [orderId, setOrderId] = useState<string>("");
  const [recognitionDate, setRecognitionDate] = useState("");
  const [status, setStatus] = useState<PurchaseRecognitionRecord["status"]>("DRAFT");
  const [documentType, setDocumentType] =
    useState<PurchaseRecognitionRecord["documentType"]>("PURCHASE");
  const [originalRecognitionId, setOriginalRecognitionId] = useState<string>("");
  const [purchasePersonEmployeeNumber, setPurchasePersonEmployeeNumber] = useState("");
  const [purchasePersonDepartment, setPurchasePersonDepartment] = useState("");
  const [inputPersonEmployeeNumber, setInputPersonEmployeeNumber] = useState("");
  const [memo, setMemo] = useState("");
  // 追加要望: プロジェクト。発注からそのまま引き継ぐ。発注に依存しない単独仕入は手動選択できる
  const [projectId, setProjectId] = useState("");
  // L-1-b: この仕入の対象となる検収記録(入庫)のid(任意。二重支払の警告用の紐づけ)
  const [receiptIds, setReceiptIds] = useState<string[]>([]);

  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyTel, setCompanyTel] = useState("");
  const [companyFax, setCompanyFax] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("貴社お支払基準に準拠");

  const [items, setItems] = useState<PurchaseRecognitionItem[]>([]);
  const [attachments, setAttachments] = useState<PurchaseRecognitionAttachment[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<{ [key: string]: File }>({});

  // Item10: 「発注から選択」ピッカーの状態
  const [showOrderPicker, setShowOrderPicker] = useState(false);

  const resolveDepartmentId = (rawVal: string, user?: any): string => {
    if (!departments || departments.length === 0) return rawVal || "";
    if (rawVal) {
      const matched = departments.find(
        (d) => d.id === rawVal || (d as any).code === rawVal || d.name === rawVal,
      );
      if (matched) return matched.id;
    }
    if (user) {
      const userDeptId =
        user.relations?.[0]?.departmentId ||
        user.relations?.[0]?.department_id ||
        user.departmentId ||
        user.department_id ||
        "";
      const userDeptName = user.departments?.[0] || user.department || "";
      const matchedByUser = departments.find(
        (d) => d.id === userDeptId || (d as any).code === userDeptId || d.name === userDeptName,
      );
      if (matchedByUser) return matchedByUser.id;
    }
    return rawVal || "";
  };

  useEffect(() => {
    async function loadCompanySettings() {
      try {
        const data = await apiFetch<CompanySettingsResponse>("/api/company-settings");
        setCompanyName(data.company_name || "");
        setCompanyAddress(data.company_address || "");
        setCompanyTel(data.company_tel || "");
        setCompanyFax(data.company_fax || "");
      } catch (err) {
        console.error("会社設定の取得に失敗しました", err);
      }
    }
    if (!editingId) {
      void loadCompanySettings();
    }
  }, [editingId]);

  useEffect(() => {
    if (editingId && initialData) {
      setRecognitionTitle(initialData.title || "");
      setPartnerId(initialData.partnerId || "");
      setOrderId(initialData.orderId || "");
      setRecognitionDate(
        initialData.recognitionDate ? initialData.recognitionDate.split("T")[0] : "",
      );
      setStatus(initialData.status);
      setDocumentType(initialData.documentType || "PURCHASE");
      setOriginalRecognitionId(initialData.originalRecognitionId || "");
      setMemo(initialData.memo || "");
      setProjectId(initialData.projectId || "");
      setReceiptIds(Array.isArray(initialData.receiptIds) ? initialData.receiptIds : []);

      const selectedEmployeeNumber = initialData.purchasePersonEmployeeNumber || "";
      setPurchasePersonEmployeeNumber(selectedEmployeeNumber);
      setInputPersonEmployeeNumber(initialData.inputPersonEmployeeNumber || "");

      const user = userMaster.find((u) => u.employeeNumber === selectedEmployeeNumber) as any;
      const savedDept = initialData.companyDepartment || initialData.company_department || "";
      setPurchasePersonDepartment(resolveDepartmentId(savedDept, user));

      const dbCompName = initialData.company_name || initialData.companyName || "";
      const dbCompAddr = initialData.company_address || initialData.companyAddress || "";
      const dbCompTel = initialData.company_tel || initialData.companyTel || "";
      const dbCompFax = initialData.company_fax || initialData.companyFax || "";
      setPaymentTerms(initialData.payment_terms || initialData.paymentTerms || "貴社お支払基準に準拠");

      if (dbCompName.trim() === "" && dbCompAddr.trim() === "" && dbCompTel.trim() === "") {
        apiFetch<CompanySettingsResponse>("/api/company-settings")
          .then((compData) => {
            setCompanyName(compData.company_name || "");
            setCompanyAddress(compData.company_address || "");
            setCompanyTel(compData.company_tel || "");
            setCompanyFax(compData.company_fax || "");
          })
          .catch((err) => console.error("会社設定の取得に失敗しました", err));
      } else {
        setCompanyName(dbCompName);
        setCompanyAddress(dbCompAddr);
        setCompanyTel(dbCompTel);
        setCompanyFax(dbCompFax);
      }

      setItems(
        initialData.items && initialData.items.length > 0
          ? initialData.items.map((item: any) => {
              const isMasterProduct = products.some((p) => p.id === item.itemId);
              return {
                ...item,
                inputType: item.inputType || (isMasterProduct ? "MASTER" : "DIRECT"),
              };
            })
          : [
              {
                itemId: "",
                itemName: "",
                inputType: "MASTER",
                quantity: 1,
                unitPrice: 0,
                unitCode: "",
                taxCategoryCode: "",
                sourceOrderItemId: null,
              },
            ],
      );
      setAttachments(
        initialData.attachments && Array.isArray(initialData.attachments)
          ? initialData.attachments.map((att: any) => ({
              id: att.id,
              fileName: att.fileName,
              storageType: att.storageType,
              attachmentR2Path: att.attachmentR2Path || null,
              externalUrl: att.externalUrl || null,
              fileType: att.fileType || "OTHER",
            }))
          : [],
      );
      setSelectedFiles({});
    } else {
      setRecognitionTitle("");
      const defaultPartnerId = partners[0]?.id || "";
      setPartnerId(defaultPartnerId);
      setOrderId("");
      setRecognitionDate(todayJst());
      setStatus("DRAFT");
      setDocumentType("PURCHASE");
      setOriginalRecognitionId("");
      setMemo("");
      setProjectId("");
      setPaymentTerms("貴社お支払基準に準拠");

      const defaultEmployeeNumber = currentUserEmployeeNumber || userMaster[0]?.employeeNumber || "";
      setPurchasePersonEmployeeNumber(defaultEmployeeNumber);
      const user = userMaster.find((u) => u.employeeNumber === defaultEmployeeNumber);
      setPurchasePersonDepartment(resolveDepartmentId("", user));
      setInputPersonEmployeeNumber(currentUserEmployeeNumber || "");

      setItems([
        {
          itemId: "",
          itemName: "",
          inputType: "MASTER",
          quantity: 1,
          unitPrice: 0,
          unitCode: "",
          taxCategoryCode: "",
          sourceOrderItemId: null,
        },
      ]);
      setAttachments([]);
      setSelectedFiles({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, initialData, partners, userMaster, products, currentUserEmployeeNumber]);

  const handlePartnerChange = (newPartnerId: string) => {
    // 対象検収は仕入先ごとの記録のため、仕入先を変えたら選択をクリアする
    if (newPartnerId !== partnerId) setReceiptIds([]);
    setPartnerId(newPartnerId);
  };

  const handlePurchasePersonChange = (selectedEmployeeNumber: string) => {
    setPurchasePersonEmployeeNumber(selectedEmployeeNumber);
    const user = userMaster.find((u) => u.employeeNumber === selectedEmployeeNumber);
    setPurchasePersonDepartment(user ? resolveDepartmentId("", user) : "");
  };

  const handleItemChange = (index: number, field: keyof PurchaseRecognitionItem, value: any) => {
    const updated = [...items];
    const currentItem = { ...updated[index], [field]: value };

    if (currentItem.inputType === "MASTER" && field === "itemId") {
      const prod = products.find((p) => p.id === value);
      if (prod) {
        currentItem.itemName = prod.name;
        currentItem.unitCode = prod.baseUnitCode || "";
        currentItem.taxCategoryCode = prod.taxCategoryCode || "";
      }
    }

    updated[index] = currentItem;
    setItems(updated);
  };

  const handleItemTypeChange = (index: number, type: "MASTER" | "DIRECT") => {
    const updated = [...items];
    updated[index] = {
      ...updated[index],
      inputType: type,
      itemId: "",
      itemName: "",
      unitPrice: 0,
      unitCode: "",
      taxCategoryCode: "",
    };
    setItems(updated);
  };

  const handleAddItemRow = () => {
    setItems([
      ...items,
      {
        itemId: "",
        itemName: "",
        inputType: "MASTER",
        quantity: 1,
        unitPrice: 0,
        unitCode: "",
        taxCategoryCode: "",
        sourceOrderItemId: null,
      },
    ]);
  };

  const handleRemoveItemRow = (index: number) => {
    const updated = [...items];
    updated.splice(index, 1);
    setItems(updated);
  };

  const handleMoveItemUp = (index: number) => {
    if (index <= 0) return;
    const updated = [...items];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setItems(updated);
  };

  const handleMoveItemDown = (index: number) => {
    if (index >= items.length - 1) return;
    const updated = [...items];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setItems(updated);
  };

  const handleAddAttachmentRow = (storageType: "R2" | "GOOGLE_DRIVE") => {
    setAttachments([...attachments, { fileName: "", storageType, externalUrl: "" }]);
  };

  const handleRemoveAttachmentRow = (index: number, fileName: string) => {
    const updatedAtts = [...attachments];
    updatedAtts.splice(index, 1);
    setAttachments(updatedAtts);

    const updatedFiles = { ...selectedFiles };
    delete updatedFiles[fileName];
    setSelectedFiles(updatedFiles);
  };

  const handleFileSelection = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const updatedAtts = [...attachments];
    updatedAtts[index].fileName = file.name;
    setAttachments(updatedAtts);

    setSelectedFiles({ ...selectedFiles, [file.name]: file });
  };

  const handleAttachmentFileNameChange = (index: number, value: string) => {
    const updated = [...attachments];
    updated[index].fileName = value;
    setAttachments(updated);
  };

  const handleAttachmentExternalUrlChange = (index: number, value: string) => {
    const updated = [...attachments];
    updated[index].externalUrl = value;
    setAttachments(updated);
  };

  // Item10: 「発注から選択」ピッカーを開く(発注検索・明細取得自体はモーダル側が行う)
  const openOrderPicker = () => {
    setShowOrderPicker(true);
  };

  // ピッカーで選択された発注・明細(数量入力込み)を、現在の明細一覧へ追加する
  const applyOrderSelection = (
    targetOrderId: string,
    selections: Array<{ progress: OrderItemProgress; quantity: number }>,
    orderProjectId?: string | null,
  ) => {
    const newItems: PurchaseRecognitionItem[] = selections
      .filter((s) => s.quantity > 0)
      .map((s) => ({
        itemId: s.progress.itemId || "",
        itemName: s.progress.itemName || "",
        inputType: s.progress.itemId && products.some((p) => p.id === s.progress.itemId) ? "MASTER" : "DIRECT",
        quantity: s.quantity,
        unitPrice: s.progress.unitPrice,
        unitCode: s.progress.unitCode || "",
        taxCategoryCode: s.progress.taxCategoryCode || "",
        accountCode: s.progress.accountCode || null,
        sourceOrderItemId: s.progress.sourceOrderItemId,
      }));

    setOrderId(targetOrderId);
    if (orderProjectId) setProjectId(orderProjectId);
    setItems((prev) => {
      const withoutEmptyFirstRow = prev.length === 1 && !prev[0].itemId ? [] : prev;
      return [...withoutEmptyFirstRow, ...newItems];
    });
    setShowOrderPicker(false);
  };

  const calcDiscountTotal = () =>
    items.reduce((sum, item) => {
      const amount = (item.quantity || 0) * (item.unitPrice || 0);
      return amount < 0 ? sum + amount : sum;
    }, 0);
  const calcGrossSubTotal = () =>
    items.reduce((sum, item) => {
      const amount = (item.quantity || 0) * (item.unitPrice || 0);
      return amount >= 0 ? sum + amount : sum;
    }, 0);
  const calcSubTotal = () => calcGrossSubTotal() + calcDiscountTotal();

  // BUG-042: 消費税の端数処理(会社設定)
  const taxRoundingMode = useTaxRoundingMode();

  const calcTaxBreakdown = () => {
    const buckets = {
      rate10: { excl: 0, tax: 0 },
      rate8: { excl: 0, tax: 0 },
      rate0: { excl: 0, tax: 0 },
    };
    for (const item of items) {
      const amount = (item.quantity || 0) * (item.unitPrice || 0);
      const rate = item.taxCategoryCode
        ? (taxCategories.find((t) => t.code === item.taxCategoryCode)?.taxRate ?? 0.1)
        : 0.1;
      const bucket =
        Math.abs(rate - 0.1) < 1e-9 ? "rate10" : Math.abs(rate - 0.08) < 1e-9 ? "rate8" : "rate0";
      buckets[bucket].excl += amount;
    }
    // BUG-042: 税率ごとに1回、会社設定の方法で端数処理する(保存時の Backend の計算と同じ)
    buckets.rate10.tax = roundTaxAmount(buckets.rate10.excl, 0.1, taxRoundingMode);
    buckets.rate8.tax = roundTaxAmount(buckets.rate8.excl, 0.08, taxRoundingMode);
    buckets.rate0.tax = 0;
    return buckets;
  };
  const calcTax = () => {
    const b = calcTaxBreakdown();
    return b.rate10.tax + b.rate8.tax + b.rate0.tax;
  };
  const calcTotal = () => calcSubTotal() + calcTax();

  const buildCurrentPayload = () => ({
    recognitionId,
    recognitionTitle,
    partnerId,
    orderId,
    recognitionDate,
    status,
    documentType,
    originalRecognitionId,
    companyDepartment: purchasePersonDepartment,
    purchasePersonEmployeeNumber,
    inputPersonEmployeeNumber,
    memo,
    companyName,
    companyAddress,
    companyTel,
    companyFax,
    paymentTerms,
    projectId,
    receiptIds,
    items,
    attachments,
    selectedFiles,
    totalAmount: calcTotal(),
    taxAmount: calcTax(),
  });

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(buildCurrentPayload());
  };


  // 追加要望L-2-a: 元の仕入から「赤伝を起票」したときのプレフィル(新規フォームのみ。保存するまで登録されない)。
  // 明細は元の内容をコピーし、発注明細との紐づけは引き継がない
  useEffect(() => {
    if (editingId || !redSlipSource) return;
    const src = redSlipSource;
    setRecognitionTitle(src.title ? `赤伝: ${src.title}` : "");
    setPartnerId(src.partnerId || "");
    setDocumentType("CORRECTION");
    setOriginalRecognitionId(src.id);
    setOrderId("");
    setRecognitionDate(todayJst());
    setProjectId(src.projectId || "");
    setPurchasePersonEmployeeNumber(src.purchasePersonEmployeeNumber || "");
    setInputPersonEmployeeNumber(currentUserEmployeeNumber || "");
    setMemo(`元仕入[${src.id}]の赤伝`);
    setItems(
      (src.items || []).map((it: any) => ({
        itemId: it.itemId || "",
        itemName: it.itemName || "",
        inputType: it.inputType || "MASTER",
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        unitCode: it.unitCode || "",
        taxCategoryCode: it.taxCategoryCode || "",
        accountCode: it.accountCode || null,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redSlipSource, editingId]);

  // 追加要望L-2-a: 返品・値引・赤伝の「対象の元仕入伝票」の候補(同じ取引先の承認済みの通常仕入)
  const [originalCandidates, setOriginalCandidates] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!partnerId || documentType === "PURCHASE") {
      setOriginalCandidates([]);
      return;
    }
    apiFetch<any>(
      `/api/purchase-recognitions?partnerId=${encodeURIComponent(partnerId)}&documentType=PURCHASE&status=APPROVED`,
    )
      .then((data) => {
        const list: any[] = Array.isArray(data) ? data : data.data || [];
        setOriginalCandidates(
          list.slice(0, 200).map((x) => ({
            id: x.id,
            label: `${x.id} ${x.recognitionDate ? String(x.recognitionDate).split("T")[0] : ""} ¥${(x.totalAmount ?? 0).toLocaleString()}`,
          })),
        );
      })
      .catch(() => setOriginalCandidates([]));
  }, [partnerId, documentType]);

  return {
    originalCandidates,
    recognitionTitle,
    setRecognitionTitle,
    partnerId,
    orderId,
    setOrderId,
    recognitionDate,
    setRecognitionDate,
    status,
    setStatus,
    documentType,
    setDocumentType,
    originalRecognitionId,
    setOriginalRecognitionId,
    purchasePersonEmployeeNumber,
    purchasePersonDepartment,
    setPurchasePersonDepartment,
    inputPersonEmployeeNumber,
    setInputPersonEmployeeNumber,
    memo,
    setMemo,
    projectId,
    setProjectId,
    receiptIds,
    setReceiptIds,
    companyName,
    setCompanyName,
    companyAddress,
    setCompanyAddress,
    companyTel,
    setCompanyTel,
    companyFax,
    setCompanyFax,
    paymentTerms,
    setPaymentTerms,
    items,
    attachments,
    showOrderPicker,
    setShowOrderPicker,
    openOrderPicker,
    applyOrderSelection,
    handlePartnerChange,
    handlePurchasePersonChange,
    handleItemChange,
    handleItemTypeChange,
    handleAddItemRow,
    handleRemoveItemRow,
    handleMoveItemUp,
    handleMoveItemDown,
    handleAddAttachmentRow,
    handleRemoveAttachmentRow,
    handleFileSelection,
    handleAttachmentFileNameChange,
    handleAttachmentExternalUrlChange,
    calcSubTotal,
    calcGrossSubTotal,
    calcDiscountTotal,
    calcTax,
    calcTaxBreakdown,
    calcTotal,
    handleFormSubmit,
    buildCurrentPayload,
  };
}
