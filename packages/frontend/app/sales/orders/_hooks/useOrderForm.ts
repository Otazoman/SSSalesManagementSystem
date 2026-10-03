import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  OrderRecord,
  PartnerMaster,
  ProductMaster,
  UserOption,
  OrderItem,
  OrderAttachment,
  TaxCategoryLookup,
  PartnerDeliveryDestinationLookup,
} from "../_types";
import { roundTaxAmount } from "../../../_shared/tax-amounts";
import { useTaxRoundingMode } from "../../../_shared/hooks/use-tax-rounding-mode";
import { todayJst } from "../../../_shared/jst-date";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

export interface PartnerContactOption {
  id: string;
  name: string;
  email?: string;
  department?: string;
  position?: string;
}

interface CompanySettingsResponse {
  company_name?: string;
  company_zip?: string;
  company_address?: string;
  company_tel?: string;
  company_fax?: string;
  is_otp_download_restricted_to_contacts?: boolean;
}

interface UseOrderFormProps {
  editingId: string | null;
  orderId: string;
  partners: PartnerMaster[];
  products: ProductMaster[];
  userMaster: UserOption[];
  departments: { id: string; name: string }[];
  taxCategories?: TaxCategoryLookup[];
  onSubmit: (formData: any) => void;
  fetchSpecialPrice: (partnerId: string, prodID: string, quantity: number) => Promise<number | null>;
  initialData?: any;
  handleSingleMailSend?: (params: { orderId: string; recipientEmail: string }) => Promise<boolean>;
  // Item7残課題: 入力担当者欄の新規作成時の既定値(ログインユーザー)
  currentUserEmployeeNumber?: string;
}

/**
 * Item7: quotes/_hooks/useQuoteForm.tsと同じ方針(状態管理・副作用・イベントハンドラを
 * 専用hookへ分離)。受注には見積のvalidUntil(有効期限)相当の概念が無いため持たない。
 */
export function useOrderForm({
  editingId,
  orderId,
  partners,
  products,
  userMaster,
  departments,
  taxCategories = [],
  onSubmit,
  fetchSpecialPrice,
  initialData,
  handleSingleMailSend,
  currentUserEmployeeNumber,
}: UseOrderFormProps) {
  const confirm = useConfirm();
  const [orderTitle, setOrderTitle] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [sourceQuoteId, setSourceQuoteId] = useState<string | null>(null);
  const [orderDate, setOrderDate] = useState("");
  const [status, setStatus] = useState<OrderRecord["status"]>("DRAFT");
  const [salesPersonEmployeeNumber, setSalesPersonEmployeeNumber] = useState("");
  const [salesPersonDepartment, setSalesPersonDepartment] = useState("");
  // Item7残課題: 営業担当(見積から引き継ぐ)とは別の、実際にこの伝票を入力する担当者
  const [inputPersonEmployeeNumber, setInputPersonEmployeeNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [terms, setTerms] = useState("");
  // 追加要望: プロジェクト。見積からそのまま引き継ぎ、売上計上まで伝播させる
  const [projectId, setProjectId] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [companyZip, setCompanyZip] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyTel, setCompanyTel] = useState("");
  const [companyFax, setCompanyFax] = useState("");

  const [deliveryDate, setDeliveryDate] = useState("注文確定後、約2週間でお届け");
  const [deliveryPlace, setDeliveryPlace] = useState("貴社指定場所");
  // 新規要望(2026-09-23): 取引先ごとの複数納品先からの選択
  const [deliveryDestinationId, setDeliveryDestinationId] = useState("");
  const [deliveryDestinations, setDeliveryDestinations] = useState<
    PartnerDeliveryDestinationLookup[]
  >([]);
  const [paymentTerms, setPaymentTerms] = useState("貴社お支払基準に準拠");

  // Item9: 前受の最小対応(発注のisPaid/paidAtと対称)
  const [isPrepaid, setIsPrepaid] = useState(false);
  const [prepaidAt, setPrepaidAt] = useState("");

  const [items, setItems] = useState<OrderItem[]>([]);
  const [attachments, setAttachments] = useState<OrderAttachment[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<{ [key: string]: File }>({});

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
    if (partnerId) {
      const selectedPartner = partners.find((p) => p.id === partnerId) as any;
      if (selectedPartner?.email) {
        setRecipientEmail(selectedPartner.email);
      }

      apiFetch<PartnerContactOption[] | { data: PartnerContactOption[] }>(
        `/api/partner-contacts?customerId=${partnerId}`,
      )
        .then((data) => {
          const contactsList = Array.isArray(data) ? data : data.data || [];
          setPartnerContacts(contactsList);
        })
        .catch((err) => {
          console.error("取引先担当者マスタの取得に失敗しました", err);
          setPartnerContacts([]);
        });

      apiFetch<PartnerDeliveryDestinationLookup[]>(
        `/api/partner-delivery-destinations?partnerId=${partnerId}&status=active`,
      )
        .then((data) => {
          const list = Array.isArray(data) ? data : [];
          setDeliveryDestinations(list);
          // 編集データ読み込み(initialData)でセット済みのdeliveryDestinationIdが、
          // この取引先の納品先一覧に含まれていれば保持し、含まれなければ(=手動で取引先を
          // 変更した場合)クリアする(setPartnerIdはinitialData読み込み時にも呼ばれるため、
          // 常にクリアしてしまうと編集時の復元値まで消えてしまう)
          setDeliveryDestinationId((prev) =>
            prev && list.some((d) => d.id === prev) ? prev : "",
          );
        })
        .catch((err) => {
          console.error("取引先納品先マスタの取得に失敗しました", err);
          setDeliveryDestinations([]);
        });
    } else {
      setPartnerContacts([]);
      setDeliveryDestinations([]);
      setDeliveryDestinationId("");
    }
    setSelectedContactId("");
  }, [partnerId, partners]);

  useEffect(() => {
    async function loadCompanySettings() {
      try {
        const data = await apiFetch<CompanySettingsResponse>("/api/company-settings");
        setCompanyName(data.company_name || "");
        setCompanyZip(data.company_zip || "");
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
    apiFetch<CompanySettingsResponse>("/api/company-settings")
      .then((data) => {
        setIsEmailRestrictedToContacts(data.is_otp_download_restricted_to_contacts === true);
      })
      .catch((err) => {
        console.error("OTPダウンロード宛先制限設定の取得に失敗しました", err);
      });
  }, []);

  useEffect(() => {
    // Item7: editingIdの有無に関わらず、initialDataがあれば常にそこから初期化する。
    // 見積からの受注作成(QuotePickerModal)はeditingId=nullのまま初期値だけ渡す
    // (この時点ではDBに未登録のため。既存受注の編集時はeditingId+initialDataの両方が揃う)
    if (initialData) {
      setOrderTitle(initialData.title || "");
      setPartnerId(initialData.partnerId || "");
      setSourceQuoteId(initialData.sourceQuoteId || null);
      setOrderDate(initialData.orderDate ? initialData.orderDate.split("T")[0] : "");
      setStatus(initialData.status || "DRAFT");
      setMemo(initialData.memo || "");
      setTerms(initialData.terms || "");
      setProjectId(initialData.projectId || "");

      const selectedEmployeeNumber = initialData.salesPersonEmployeeNumber || "";
      setSalesPersonEmployeeNumber(selectedEmployeeNumber);

      // Item7残課題: 既存受注の編集時は保存済みの値を復元する。見積からのプレフィル(editingId未確定)
      // では入力担当者は見積から引き継がず、ログインユーザーを既定値とする
      setInputPersonEmployeeNumber(
        editingId
          ? initialData.inputPersonEmployeeNumber || ""
          : currentUserEmployeeNumber || "",
      );

      const user = userMaster.find((u) => u.employeeNumber === selectedEmployeeNumber) as any;

      const savedDept = initialData.companyDepartment || "";
      const resolvedId = resolveDepartmentId(savedDept, user);
      setSalesPersonDepartment(resolvedId);

      const dbCompName = initialData.companyName || "";
      const dbCompZip = initialData.companyZip || "";
      const dbCompAddr = initialData.companyAddress || "";
      const dbCompTel = initialData.companyTel || "";
      const dbCompFax = initialData.companyFax || "";

      setDeliveryDate(initialData.deliveryDate || "注文確定後、約2週間でお届け");
      setDeliveryPlace(initialData.deliveryPlace || "貴社指定場所");
      setDeliveryDestinationId(initialData.deliveryDestinationId || "");
      setPaymentTerms(initialData.paymentTerms || "貴社お支払基準に準拠");
      setIsPrepaid(initialData.isPrepaid || false);
      setPrepaidAt(initialData.prepaidAt ? initialData.prepaidAt.split("T")[0] : "");

      if (dbCompName.trim() === "" && dbCompAddr.trim() === "" && dbCompTel.trim() === "") {
        apiFetch<CompanySettingsResponse>("/api/company-settings")
          .then((compData) => {
            setCompanyName(compData.company_name || "");
            setCompanyZip(compData.company_zip || "");
            setCompanyAddress(compData.company_address || "");
            setCompanyTel(compData.company_tel || "");
            setCompanyFax(compData.company_fax || "");
          })
          .catch((err) => {
            console.error("会社設定の取得に失敗しました", err);
          });
      } else {
        setCompanyName(dbCompName);
        setCompanyZip(dbCompZip);
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
      setOrderTitle("");
      const defaultPartnerId = partners[0]?.id || "";
      setPartnerId(defaultPartnerId);
      setSourceQuoteId(null);
      setOrderDate(todayJst());
      setStatus("DRAFT");
      setMemo("");
      setTerms("");
      setProjectId("");
      // 2026-08-27: 新規作成時の既定値をログインユーザーに変更(以前はuserMaster[0]、
      // マスタの並び順で偶然先頭になったユーザーが毎回選ばれてしまっていた)
      const defaultEmployeeNumber =
        currentUserEmployeeNumber || userMaster[0]?.employeeNumber || "";
      setSalesPersonEmployeeNumber(defaultEmployeeNumber);
      const user = userMaster.find((u) => u.employeeNumber === defaultEmployeeNumber);
      const newFormDeptId = resolveDepartmentId("", user);
      setSalesPersonDepartment(newFormDeptId);
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
        },
      ]);
      setAttachments([]);
      setSelectedFiles({});
      if (defaultPartnerId) {
        handlePartnerChange(defaultPartnerId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, initialData, partners, userMaster, products, currentUserEmployeeNumber]);

  const handleContactSelect = (contactId: string) => {
    setSelectedContactId(contactId);
    if (!contactId) return;

    const contact = partnerContacts.find((c) => c.id === contactId);
    if (contact && contact.email) {
      setRecipientEmail(contact.email);
    }
  };

  const handleSalesPersonChange = (selectedEmployeeNumber: string) => {
    setSalesPersonEmployeeNumber(selectedEmployeeNumber);
    const user = userMaster.find((u) => u.employeeNumber === selectedEmployeeNumber);

    if (user) {
      const deptId = resolveDepartmentId("", user);
      setSalesPersonDepartment(deptId);
    } else {
      setSalesPersonDepartment("");
    }
  };

  const handlePartnerChange = async (newPartnerId: string) => {
    setPartnerId(newPartnerId);
    if (!newPartnerId) return;

    const targetPartner = partners.find((p) => p.id === newPartnerId);
    if (targetPartner) {
      setDeliveryDate("注文確定後、約2週間でお届け");
      if (targetPartner.address && targetPartner.address.trim() !== "") {
        setDeliveryPlace(targetPartner.address);
      } else {
        setDeliveryPlace("貴社指定場所");
      }

      const partner = targetPartner as any;
      const rawClosing = partner.closingDay ?? partner.closing_day;
      const rawPayment = partner.paymentDay ?? partner.payment_day;
      const rawOffset = partner.paymentMonthOffset ?? partner.payment_month_offset;
      const rawMethod = partner.paymentMethod ?? partner.payment_method;

      if (rawClosing !== undefined && rawClosing !== null) {
        const cDay = Number(rawClosing);
        const closing = cDay === 31 || cDay === 99 || cDay === 0 ? "末" : String(cDay);
        const pDay = Number(rawPayment);
        const payment = pDay === 31 || pDay === 99 || pDay === 0 ? "末" : String(pDay);

        let offset = "当";
        const offsetNum = Number(rawOffset);
        if (offsetNum === 1) offset = "翌";
        if (offsetNum === 2) offset = "翌々";

        const method = rawMethod && String(rawMethod).trim() !== "" ? String(rawMethod) : "振込";
        setPaymentTerms(`${closing}日締め / ${offset}月${payment}日 ${method}払い`);
      } else {
        setPaymentTerms("貴社お支払基準に準拠");
      }
    }

    const updatedItems = await Promise.all(
      items.map(async (item) => {
        if (item.inputType === "MASTER" && item.itemId) {
          const specialPriceVal = await fetchSpecialPrice(newPartnerId, item.itemId, item.quantity);
          if (specialPriceVal !== null) {
            return { ...item, unitPrice: specialPriceVal };
          }
          const originalProd = products.find((p) => p.id === item.itemId);
          if (originalProd) {
            return { ...item, unitPrice: originalProd.price ?? 0 };
          }
        }
        return item;
      }),
    );
    // BUG-054: 単価の取得中に明細が変わっていても上書きしない(取得した時点と品目・数量が同じ明細にだけ単価を反映する)
    setItems((prev) =>
      prev.map((item, i) => {
        const priced = updatedItems[i];
        return priced &&
          item.inputType === priced.inputType &&
          item.itemId === priced.itemId &&
          item.quantity === priced.quantity
          ? { ...item, unitPrice: priced.unitPrice }
          : item;
      }),
    );
  };

  // BUG-054: 入力した品目・数量はその場で反映し(単価の取得を待たない)、単価の取得結果は、応答が返った時点で
  // その明細の品目・数量が変わっていない場合だけ反映する。以前は単価の取得を待ってから入力前の明細一覧を元に
  // 上書きしていたため、続けて入力すると、後から返った古い入力への応答で数量が戻ることがあった
  const handleItemChange = async (index: number, field: keyof OrderItem, value: any) => {
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
    orderId,
    orderTitle,
    partnerId,
    sourceQuoteId,
    orderDate,
    status,
    companyDepartment: salesPersonDepartment,
    salesPersonEmployeeNumber,
    inputPersonEmployeeNumber,
    memo,
    terms,
    companyName,
    companyZip,
    companyAddress,
    companyTel,
    companyFax,
    deliveryDate,
    deliveryPlace,
    deliveryDestinationId: deliveryDestinationId || null,
    paymentTerms,
    projectId,
    isPrepaid,
    prepaidAt,
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

  const handleSingleMailSendAction = async () => {
    // 宛先が正しくない間は、送信モーダル(MailSendModal)の「送信」が押せない(BUG-037: 念のための確認)
    if (!recipientEmail || !recipientEmail.includes("@")) return;

    if (!(await confirm(`注文請書 [ ${orderId} ] を以下の宛先へ送信しますか？\n送信先: ${recipientEmail}`))) {
      return;
    }

    if (handleSingleMailSend) {
      const success = await handleSingleMailSend({ orderId, recipientEmail });
      if (success) {
        setShowMailModal(false);
      }
    }
  };

  return {
    orderTitle,
    setOrderTitle,
    partnerId,
    sourceQuoteId,
    orderDate,
    setOrderDate,
    status,
    setStatus,
    salesPersonEmployeeNumber,
    salesPersonDepartment,
    setSalesPersonDepartment,
    inputPersonEmployeeNumber,
    setInputPersonEmployeeNumber,
    memo,
    setMemo,
    terms,
    setTerms,
    projectId,
    setProjectId,
    companyName,
    setCompanyName,
    companyZip,
    setCompanyZip,
    companyAddress,
    setCompanyAddress,
    companyTel,
    setCompanyTel,
    companyFax,
    setCompanyFax,
    deliveryDate,
    setDeliveryDate,
    deliveryPlace,
    setDeliveryPlace,
    deliveryDestinationId,
    setDeliveryDestinationId,
    deliveryDestinations,
    paymentTerms,
    setPaymentTerms,
    isPrepaid,
    setIsPrepaid,
    prepaidAt,
    setPrepaidAt,
    items,
    attachments,
    recipientEmail,
    setRecipientEmail,
    showMailModal,
    setShowMailModal,
    partnerContacts,
    selectedContactId,
    isEmailRestrictedToContacts,
    handleContactSelect,
    handleSalesPersonChange,
    handlePartnerChange,
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
    handleSingleMailSendAction,
  };
}
