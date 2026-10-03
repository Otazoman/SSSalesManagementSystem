import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  SalesInvoiceRecord,
  PartnerMaster,
  ProductMaster,
  UserOption,
  SalesInvoiceItem,
  SalesInvoiceAttachment,
  TaxCategoryLookup,
  SalesOrderItemProgress,
} from "../_types";
import { roundTaxAmount } from "../../../_shared/tax-amounts";
import { useTaxRoundingMode } from "../../../_shared/hooks/use-tax-rounding-mode";
import { todayJst } from "../../../_shared/jst-date";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

interface CompanySettingsResponse {
  company_name?: string;
  company_address?: string;
  company_tel?: string;
  company_fax?: string;
  is_otp_download_restricted_to_contacts?: boolean;
}

// K-4-1: useQuoteForm.tsのPartnerContactOptionと同型
export interface PartnerContactOption {
  id: string;
  name: string;
  email?: string;
  department?: string;
  position?: string;
}

interface UseSalesInvoiceFormProps {
  editingId: string | null;
  invoiceId: string;
  partners: PartnerMaster[];
  products: ProductMaster[];
  userMaster: UserOption[];
  departments: { id: string; name: string }[];
  taxCategories?: TaxCategoryLookup[];
  onSubmit: (formData: any) => void;
  fetchSpecialPrice: (partnerId: string, prodID: string, quantity: number) => Promise<number | null>;
  initialData?: any;
  // 追加要望L-2-a: 元の売上から「赤伝を起票」する場合の元伝票(新規フォームへプレフィルする)
  redSlipSource?: any;
  handleSingleMailSend?: (params: { invoiceId: string; recipientEmail: string }) => Promise<boolean>;
  currentUserEmployeeNumber?: string;
}

/**
 * `useQuoteForm.ts`と同じ構成の状態管理・副作用・イベントハンドラをsales_invoices向けに
 * 移植したもの。K-4-1でメール送信関連の状態を追加(Phase2時点では承認済み実装計画により
 * 除外していたが、見積・発注と揃える方針に変更)。「受注から選択」ピッカー(applyOrderSelection)も持つ。
 */
export function useSalesInvoiceForm({
  editingId,
  invoiceId,
  partners,
  products,
  userMaster,
  departments,
  taxCategories = [],
  onSubmit,
  fetchSpecialPrice,
  initialData,
  redSlipSource,
  handleSingleMailSend,
  currentUserEmployeeNumber,
}: UseSalesInvoiceFormProps) {
  const confirm = useConfirm();
  const [invoiceTitle, setInvoiceTitle] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [salesOrderId, setSalesOrderId] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [status, setStatus] = useState<SalesInvoiceRecord["status"]>("DRAFT");
  const [documentType, setDocumentType] = useState<SalesInvoiceRecord["documentType"]>("SALE");
  const [originalInvoiceId, setOriginalInvoiceId] = useState<string>("");
  const [salesPersonEmployeeNumber, setSalesPersonEmployeeNumber] = useState("");
  const [salesPersonDepartment, setSalesPersonDepartment] = useState("");
  const [inputPersonEmployeeNumber, setInputPersonEmployeeNumber] = useState("");
  const [memo, setMemo] = useState("");
  // 追加要望: プロジェクト。受注からそのまま引き継ぐ。受注に依存しない単独売上は手動選択できる
  const [projectId, setProjectId] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyTel, setCompanyTel] = useState("");
  const [companyFax, setCompanyFax] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("貴社お支払基準に準拠");

  const [items, setItems] = useState<SalesInvoiceItem[]>([]);
  const [attachments, setAttachments] = useState<SalesInvoiceAttachment[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<{ [key: string]: File }>({});

  // Item8: 「受注から選択」ピッカーの状態
  const [showOrderPicker, setShowOrderPicker] = useState(false);

  // K-4-1: 個別メール送信モーダルの状態(useQuoteForm.tsと同型)
  const [recipientEmail, setRecipientEmail] = useState("");
  const [showMailModal, setShowMailModal] = useState(false);
  const [partnerContacts, setPartnerContacts] = useState<PartnerContactOption[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  const [isEmailRestrictedToContacts, setIsEmailRestrictedToContacts] = useState(false);

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

  // K-4-1: OTPダウンロード宛先制限フラグ(useQuoteForm.tsと同型、新規/編集どちらでも必要なため独立取得)
  useEffect(() => {
    apiFetch<CompanySettingsResponse>("/api/company-settings")
      .then((data) => {
        setIsEmailRestrictedToContacts(data.is_otp_download_restricted_to_contacts === true);
      })
      .catch((err) => {
        console.error("OTPダウンロード宛先制限設定の取得に失敗しました", err);
      });
  }, []);

  // K-4-1: 取引先変更時、取引先担当者マスタから連絡先候補を取得(useQuoteForm.tsと同型)
  useEffect(() => {
    if (partnerId) {
      apiFetch<PartnerContactOption[] | { data: PartnerContactOption[] }>(
        `/api/partner-contacts?partnerId=${partnerId}`,
      )
        .then((data) => {
          const contactsList = Array.isArray(data) ? data : data.data || [];
          setPartnerContacts(contactsList);
        })
        .catch((err) => {
          console.error("取引先担当者マスタの取得に失敗しました", err);
          setPartnerContacts([]);
        });
    } else {
      setPartnerContacts([]);
    }
    setSelectedContactId("");
  }, [partnerId]);

  useEffect(() => {
    if (editingId && initialData) {
      setInvoiceTitle(initialData.title || "");
      setPartnerId(initialData.partnerId || "");
      setSalesOrderId(initialData.salesOrderId || "");
      setInvoiceDate(initialData.invoiceDate ? initialData.invoiceDate.split("T")[0] : "");
      setStatus(initialData.status);
      setDocumentType(initialData.documentType || "SALE");
      setOriginalInvoiceId(initialData.originalInvoiceId || "");
      setMemo(initialData.memo || "");
      setProjectId(initialData.projectId || "");

      const selectedEmployeeNumber = initialData.salesPersonEmployeeNumber || "";
      setSalesPersonEmployeeNumber(selectedEmployeeNumber);
      setInputPersonEmployeeNumber(initialData.inputPersonEmployeeNumber || "");

      const user = userMaster.find((u) => u.employeeNumber === selectedEmployeeNumber) as any;
      const savedDept = initialData.companyDepartment || initialData.company_department || "";
      setSalesPersonDepartment(resolveDepartmentId(savedDept, user));

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
      setInvoiceTitle("");
      const defaultPartnerId = partners[0]?.id || "";
      setPartnerId(defaultPartnerId);
      setSalesOrderId("");
      setInvoiceDate(todayJst());
      setStatus("DRAFT");
      setDocumentType("SALE");
      setOriginalInvoiceId("");
      setMemo("");
      setProjectId("");
      setPaymentTerms("貴社お支払基準に準拠");

      const defaultEmployeeNumber = currentUserEmployeeNumber || userMaster[0]?.employeeNumber || "";
      setSalesPersonEmployeeNumber(defaultEmployeeNumber);
      const user = userMaster.find((u) => u.employeeNumber === defaultEmployeeNumber);
      setSalesPersonDepartment(resolveDepartmentId("", user));
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
    setPartnerId(newPartnerId);
  };

  const handleSalesPersonChange = (selectedEmployeeNumber: string) => {
    setSalesPersonEmployeeNumber(selectedEmployeeNumber);
    const user = userMaster.find((u) => u.employeeNumber === selectedEmployeeNumber);
    setSalesPersonDepartment(user ? resolveDepartmentId("", user) : "");
  };

  // BUG-054: 入力した品目・数量はその場で反映し(単価の取得を待たない)、単価の取得結果は、応答が返った時点で
  // その明細の品目・数量が変わっていない場合だけ反映する。以前は単価の取得を待ってから入力前の明細一覧を元に
  // 上書きしていたため、続けて入力すると、後から返った古い入力への応答で数量が戻ることがあった
  const handleItemChange = async (index: number, field: keyof SalesInvoiceItem, value: any) => {
    const currentItem = { ...items[index], [field]: value };
    const needsPrice =
      currentItem.inputType === "MASTER" && (field === "itemId" || field === "quantity");
    if (needsPrice && field === "quantity") currentItem.quantity = Number(value);
    if (needsPrice && field === "itemId") {
      const prod = products.find((p) => p.id === value);
      if (prod) {
        currentItem.itemName = prod.name;
        currentItem.unitCode = prod.baseUnitCode || "";
        currentItem.taxCategoryCode = prod.taxCategoryCode || "";
      }
    }
    setItems((prev) => prev.map((item, i) => (i === index ? currentItem : item)));

    const targetItemId = currentItem.itemId;
    if (!needsPrice || !targetItemId) return;
    const targetQuantity = currentItem.quantity;

    let priceToApply = 0;
    const specialPriceVal = await fetchSpecialPrice(partnerId, targetItemId, targetQuantity);
    if (specialPriceVal !== null) {
      priceToApply = specialPriceVal;
    } else {
      const originalProd = products.find((p) => p.id === targetItemId);
      if (originalProd) priceToApply = originalProd.price ?? 0;
    }

    setItems((prev) =>
      prev.map((item, i) =>
        i === index &&
        item.inputType === "MASTER" &&
        item.itemId === targetItemId &&
        item.quantity === targetQuantity
          ? { ...item, unitPrice: priceToApply }
          : item,
      ),
    );
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

  // Item8: 「受注から選択」ピッカーを開く(受注検索・明細取得自体はモーダル側が行う)
  const openOrderPicker = () => {
    setShowOrderPicker(true);
  };

  // ピッカーで選択された受注・明細(数量入力込み)を、現在の明細一覧へ追加する。
  // BUG-050: 取引先を受注の得意先に切り替える。別の得意先の受注明細が既に入っている場合は
  // 追加せず、ピッカーに表示する理由を返す(1つの売上に複数の得意先の受注は混在できない)
  const applyOrderSelection = (
    targetOrderId: string,
    selections: Array<{ progress: SalesOrderItemProgress; quantity: number }>,
    orderProjectId?: string | null,
    orderPartnerId?: string | null,
  ): string | undefined => {
    if (orderPartnerId && orderPartnerId !== partnerId && items.some((item) => !!item.sourceOrderItemId)) {
      return "別の得意先の受注明細が既に入っているため、この受注は追加できません(1つの売上には同じ得意先の受注だけをまとめられます)";
    }
    const newItems: SalesInvoiceItem[] = selections
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
        sourceOrderItemId: s.progress.salesOrderItemId,
      }));

    setSalesOrderId(targetOrderId);
    if (orderPartnerId) setPartnerId(orderPartnerId);
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
    invoiceId,
    invoiceTitle,
    partnerId,
    salesOrderId,
    invoiceDate,
    status,
    documentType,
    originalInvoiceId,
    companyDepartment: salesPersonDepartment,
    salesPersonEmployeeNumber,
    inputPersonEmployeeNumber,
    memo,
    companyName,
    companyAddress,
    companyTel,
    companyFax,
    paymentTerms,
    projectId,
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

  // K-4-1: 連絡先プルダウン選択時の処理(useQuoteForm.tsと同型)
  const handleContactSelect = (contactId: string) => {
    setSelectedContactId(contactId);
    if (!contactId) return;
    const contact = partnerContacts.find((c) => c.id === contactId);
    if (contact && contact.email) {
      setRecipientEmail(contact.email);
    }
  };

  // K-4-1: 単独メール送信ハンドラー(useQuoteForm.tsと同型)
  const handleSingleMailSendAction = async () => {
    // 宛先が正しくない間は、送信モーダル(MailSendModal)の「送信」が押せない(BUG-037: 念のための確認)
    if (!recipientEmail || !recipientEmail.includes("@")) return;

    if (
      !(await confirm(`売上関連書類 [ ${invoiceId} ] を以下の宛先へ送信しますか？\n送信先: ${recipientEmail}`))
    ) {
      return;
    }

    if (handleSingleMailSend) {
      const success = await handleSingleMailSend({ invoiceId, recipientEmail });
      if (success) {
        setShowMailModal(false);
      }
    }
  };


  // 追加要望L-2-a: 元の売上から「赤伝を起票」したときのプレフィル(新規フォームのみ。保存するまで登録されない)。
  // 明細は元の内容をコピーし、受注明細との紐づけ(sourceOrderItemId)は引き継がない
  useEffect(() => {
    if (editingId || !redSlipSource) return;
    const src = redSlipSource;
    setInvoiceTitle(src.title ? `赤伝: ${src.title}` : "");
    setPartnerId(src.partnerId || "");
    setDocumentType("CORRECTION");
    setOriginalInvoiceId(src.id);
    setSalesOrderId("");
    setInvoiceDate(todayJst());
    setProjectId(src.projectId || "");
    setSalesPersonEmployeeNumber(src.salesPersonEmployeeNumber || "");
    setInputPersonEmployeeNumber(currentUserEmployeeNumber || "");
    setMemo(`元売上[${src.id}]の赤伝`);
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

  // 追加要望L-2-a: 返品・値引・赤伝の「対象の元売上伝票」の候補(同じ取引先の承認済みの通常売上)
  const [originalCandidates, setOriginalCandidates] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!partnerId || documentType === "SALE") {
      setOriginalCandidates([]);
      return;
    }
    apiFetch<any>(
      `/api/sales-invoices?partnerId=${encodeURIComponent(partnerId)}&documentType=SALE&status=APPROVED`,
    )
      .then((data) => {
        const list: any[] = Array.isArray(data) ? data : data.data || [];
        setOriginalCandidates(
          list.slice(0, 200).map((x) => ({
            id: x.id,
            label: `${x.id} ${x.invoiceDate ? String(x.invoiceDate).split("T")[0] : ""} ¥${(x.totalAmount ?? 0).toLocaleString()}`,
          })),
        );
      })
      .catch(() => setOriginalCandidates([]));
  }, [partnerId, documentType]);

  return {
    originalCandidates,
    invoiceTitle,
    setInvoiceTitle,
    partnerId,
    salesOrderId,
    setSalesOrderId,
    invoiceDate,
    setInvoiceDate,
    status,
    setStatus,
    documentType,
    setDocumentType,
    originalInvoiceId,
    setOriginalInvoiceId,
    salesPersonEmployeeNumber,
    salesPersonDepartment,
    setSalesPersonDepartment,
    inputPersonEmployeeNumber,
    setInputPersonEmployeeNumber,
    memo,
    setMemo,
    projectId,
    setProjectId,
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
    recipientEmail,
    setRecipientEmail,
    showMailModal,
    setShowMailModal,
    partnerContacts,
    selectedContactId,
    isEmailRestrictedToContacts,
    handleContactSelect,
    handleSingleMailSendAction,
    handlePartnerChange,
    handleSalesPersonChange,
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
