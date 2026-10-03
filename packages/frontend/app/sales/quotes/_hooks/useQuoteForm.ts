import { useState, useEffect } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import {
  QuoteRecord,
  PartnerMaster,
  ProductMaster,
  UserOption,
  QuoteItem,
  QuoteAttachment,
  TaxCategoryLookup,
} from "../_types";
import { roundTaxAmount } from "../../../_shared/tax-amounts";
import { useTaxRoundingMode } from "../../../_shared/hooks/use-tax-rounding-mode";
import { todayJst, addMonthsToDate } from "../../../_shared/jst-date";
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

interface UseQuoteFormProps {
  editingId: string | null;
  quoteId: string;
  partners: PartnerMaster[];
  products: ProductMaster[];
  userMaster: UserOption[];
  departments: { id: string; name: string }[];
  taxCategories?: TaxCategoryLookup[];
  onSubmit: (formData: any, isRevisionUp: boolean) => void;
  fetchSpecialPrice: (
    custID: string,
    prodID: string,
    quantity: number,
  ) => Promise<number | null>;
  initialData?: any;
  handleSingleMailSend?: (params: {
    quoteId: string;
    recipientEmail: string;
  }) => Promise<boolean>;
  // Item7残課題(見積へも展開): 入力担当者欄の新規作成時の既定値(ログインユーザー)
  currentUserEmployeeNumber?: string;
}

/**
 * `QuoteForm.tsx`（1330行、専用hookなし、useStateが20個以上直書き）の状態管理・副作用・
 * イベントハンドラを切り出した専用hook。マークアップは`QuoteForm.tsx`及び分割後の
 * 各`_components`側に残し、ロジックのみをここへ移設（挙動は変更していない）。
 */
export function useQuoteForm({
  editingId,
  quoteId,
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
}: UseQuoteFormProps) {
  const confirm = useConfirm();
  const [quoteTitle, setQuoteTitle] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [quoteDate, setQuoteDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [status, setStatus] = useState<QuoteRecord["status"]>("DRAFT");
  const [salesPersonEmployeeNumber, setSalesPersonEmployeeNumber] = useState("");
  const [salesPersonDepartment, setSalesPersonDepartment] = useState("");
  // Item7残課題(見積へも展開): 営業担当とは別の、実際にこの伝票を入力する担当者
  const [inputPersonEmployeeNumber, setInputPersonEmployeeNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [terms, setTerms] = useState("");
  // 追加要望: プロジェクト。受注作成時にそのまま引き継ぐ
  const [projectId, setProjectId] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [companyZip, setCompanyZip] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyTel, setCompanyTel] = useState("");
  const [companyFax, setCompanyFax] = useState("");

  const [deliveryDate, setDeliveryDate] = useState(
    "注文確定後、約2週間でお届け",
  );
  const [deliveryPlace, setDeliveryPlace] = useState("貴社指定場所");
  const [paymentTerms, setPaymentTerms] = useState("貴社お支払基準に準拠");

  const [items, setItems] = useState<QuoteItem[]>([]);
  const [attachments, setAttachments] = useState<QuoteAttachment[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<{ [key: string]: File }>(
    {},
  );

  const [recipientEmail, setRecipientEmail] = useState("");
  const [showMailModal, setShowMailModal] = useState(false);
  const [partnerContacts, setPartnerContacts] = useState<
    PartnerContactOption[]
  >([]);
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  // 💡 見積書OTPダウンロードの宛先制限(会社・システム設定 → メール送信設定)がONの場合、
  // 個別メール送信画面でも送信先を連絡先マスタからの選択のみに制限する(手入力不可)。
  const [isEmailRestrictedToContacts, setIsEmailRestrictedToContacts] =
    useState(false);

  // 💡 どのような形式の部署情報からでもサロゲートID(dept.id)を特定する関数
  const resolveDepartmentId = (rawVal: string, user?: any): string => {
    if (!departments || departments.length === 0) return rawVal || "";

    // 1. 保存値や引数が直接サロゲートID、またはコード/名称に一致するか確認
    if (rawVal) {
      const matched = departments.find(
        (d) =>
          d.id === rawVal || (d as any).code === rawVal || d.name === rawVal,
      );
      if (matched) return matched.id;
    }

    // 2. ユーザー情報(user)からの逆引き
    if (user) {
      const userDeptId =
        user.relations?.[0]?.departmentId ||
        user.relations?.[0]?.department_id ||
        user.departmentId ||
        user.department_id ||
        "";
      const userDeptName = user.departments?.[0] || user.department || "";

      const matchedByUser = departments.find(
        (d) =>
          d.id === userDeptId ||
          (d as any).code === userDeptId ||
          d.name === userDeptName,
      );
      if (matchedByUser) return matchedByUser.id;
    }

    return rawVal || "";
  };

  // 得意先が選択・変更された際、得意先マスタのメールアドレスを自動セット
  useEffect(() => {
    if (customerId) {
      const selectedPartner = partners.find(
        (c) => c.id === customerId,
      ) as any;
      if (selectedPartner?.email) {
        setRecipientEmail(selectedPartner.email);
      }

      // 💡 取引先連絡先マスタから対象得意先の連絡先を取得
      apiFetch<PartnerContactOption[] | { data: PartnerContactOption[] }>(
        `/api/partner-contacts?customerId=${customerId}`,
      )
        .then((data) => {
          // レスポンス形式が配列の場合、または { data: [...] } の場合に対応
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
  }, [customerId, partners]);

  useEffect(() => {
    async function loadCompanySettings() {
      try {
        const data = await apiFetch<CompanySettingsResponse>(
          "/api/company-settings",
        );
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

  // 💡 OTPダウンロード宛先制限フラグは新規/編集どちらでもメール送信モーダルで
  // 必要になるため、上のloadCompanySettingsとは独立して常に取得する
  useEffect(() => {
    apiFetch<CompanySettingsResponse>("/api/company-settings")
      .then((data) => {
        setIsEmailRestrictedToContacts(
          data.is_otp_download_restricted_to_contacts === true,
        );
      })
      .catch((err) => {
        console.error("OTPダウンロード宛先制限設定の取得に失敗しました", err);
      });
  }, []);

  useEffect(() => {
    if (editingId && initialData) {
      setQuoteTitle(initialData.title || "");
      setCustomerId(initialData.customerId);
      setCustomerId(initialData.customerId || initialData.partnerId || "");
      setQuoteDate(
        initialData.quoteDate ? initialData.quoteDate.split("T")[0] : "",
      );
      setValidUntil(
        initialData.validUntil ? initialData.validUntil.split("T")[0] : "",
      );
      setStatus(initialData.status);
      setMemo(initialData.memo || "");
      setTerms(initialData.terms || "");
      setProjectId(initialData.projectId || "");

      const selectedEmployeeNumber = initialData.salesPersonEmployeeNumber || "";
      setSalesPersonEmployeeNumber(selectedEmployeeNumber);

      // Item7残課題(見積へも展開): 既存見積の編集時は保存済みの値を復元する
      setInputPersonEmployeeNumber(initialData.inputPersonEmployeeNumber || "");

      const user = userMaster.find(
        (u) => u.employeeNumber === selectedEmployeeNumber,
      ) as any;

      // 見積に既存保存された部署名があればそれを、無ければユーザーマスタの所属部署を参照
      const savedDept =
        initialData.companyDepartment || initialData.company_department || "";

      const resolvedId = resolveDepartmentId(savedDept, user);
      setSalesPersonDepartment(resolvedId);

      const dbCompName =
        initialData.company_name || initialData.companyName || "";
      const dbCompZip = initialData.company_zip || initialData.companyZip || "";
      const dbCompAddr =
        initialData.company_address || initialData.companyAddress || "";
      const dbCompTel = initialData.company_tel || initialData.companyTel || "";
      const dbCompFax = initialData.company_fax || initialData.companyFax || "";

      setDeliveryDate(
        initialData.delivery_date ||
          initialData.deliveryDate ||
          "注文確定後、約2週間でお届け",
      );
      setDeliveryPlace(
        initialData.delivery_place ||
          initialData.deliveryPlace ||
          "貴社指定場所",
      );
      setPaymentTerms(
        initialData.payment_terms ||
          initialData.paymentTerms ||
          "貴社お支払基準に準拠",
      );

      if (
        dbCompName.trim() === "" &&
        dbCompAddr.trim() === "" &&
        dbCompTel.trim() === ""
      ) {
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
              const isMasterProduct = products.some(
                (p) => p.id === item.itemId,
              );
              return {
                ...item,
                inputType:
                  item.inputType || (isMasterProduct ? "MASTER" : "DIRECT"),
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
              id: att.id, // IDを確実に引き継ぐ
              fileName: att.fileName,
              storageType: att.storageType,
              attachmentR2Path: att.attachmentR2Path || null, // R2パスを確実に保持する
              externalUrl: att.externalUrl || null,
              fileType: att.fileType || "OTHER",
            }))
          : [],
      );
      setSelectedFiles({});
    } else {
      setQuoteTitle("");
      const defaultPartnerId = partners[0]?.id || "";
      setCustomerId(defaultPartnerId);
      setQuoteDate(todayJst());
      setValidUntil(addMonthsToDate(todayJst(), 1));
      setStatus("DRAFT");
      setMemo("");
      setTerms("");
      setProjectId("");
      // 2026-08-27: 新規作成時の既定値をログインユーザーに変更(以前はuserMaster[0]、
      // マスタの並び順で偶然先頭になったユーザーが毎回選ばれてしまっていた)
      const defaultEmployeeNumber =
        currentUserEmployeeNumber || userMaster[0]?.employeeNumber || "";
      setSalesPersonEmployeeNumber(defaultEmployeeNumber);
      const user = userMaster.find(
        (u) => u.employeeNumber === defaultEmployeeNumber,
      );
      // 💡 user.departments[0] も探索するように修正
      // 新規作成時
      const newFormDeptId = resolveDepartmentId("", user);
      setSalesPersonDepartment(newFormDeptId);
      setInputPersonEmployeeNumber(currentUserEmployeeNumber || "");

      const defaultItems: QuoteItem[] = [
        {
          itemId: "",
          itemName: "",
          inputType: "MASTER",
          quantity: 1,
          unitPrice: 0,
          unitCode: "",
          taxCategoryCode: "",
        },
      ];
      setItems(defaultItems);
      setAttachments([]);
      setSelectedFiles({});
      if (defaultPartnerId) {
        // 💡 ここでitems state(クロージャ捕捉時点では旧レンダーの値)ではなく、
        // 直前にsetItems()した defaultItems を明示的に渡す。渡さないと
        // handleCustomerChange内のsetItems(updatedItems)が古いitemsを元に
        // 計算した結果で上書きし、今設定したばかりのデフォルト明細行が消えてしまう。
        handlePartnerChange(defaultPartnerId, defaultItems);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, initialData, partners, userMaster, products, currentUserEmployeeNumber]);

  // 💡 連絡先プルダウン選択時の処理
  const handleContactSelect = (contactId: string) => {
    setSelectedContactId(contactId);
    if (!contactId) return;

    const contact = partnerContacts.find((c) => c.id === contactId);
    if (contact && contact.email) {
      setRecipientEmail(contact.email);
    }
  };

  /* 担当者変更ハンドラー：兼務・自動セット対応 */
  const handleSalesPersonChange = (selectedEmployeeNumber: string) => {
    setSalesPersonEmployeeNumber(selectedEmployeeNumber);
    const user = userMaster.find(
      (u) => u.employeeNumber === selectedEmployeeNumber,
    );

    if (user) {
      // 💡 共通ヘルパー関数でユーザー情報からサロゲートIDを抽出
      const deptId = resolveDepartmentId("", user);
      setSalesPersonDepartment(deptId);
    } else {
      setSalesPersonDepartment("");
    }
  };

  // 💡 currentItems は既定でhook stateのitemsを使うが、呼び出し元が直前にsetItems()した
  // 値をこの関数が古いitems(クロージャ捕捉時点のstate)で上書きしてしまう競合を避けるため、
  // 明示的に渡せるようにしている(新規作成時の初期化effectがこれを利用する)。
  const handlePartnerChange = async (
    newPartnerId: string,
    currentItems: QuoteItem[] = items,
  ) => {
    setCustomerId(newPartnerId);
    if (!newPartnerId) return;

    const targetPartner = partners.find((c) => c.id === newPartnerId);
    if (targetPartner) {
      setDeliveryDate("注文確定後、約2週間でお届け");
      if (targetPartner.address && targetPartner.address.trim() !== "") {
        setDeliveryPlace(targetPartner.address);
      } else {
        setDeliveryPlace("貴社指定場所");
      }

      const cust = targetPartner as any;
      const rawClosing = cust.closingDay ?? cust.closing_day;
      const rawPayment = cust.paymentDay ?? cust.payment_day;
      const rawOffset = cust.paymentMonthOffset ?? cust.payment_month_offset;
      const rawMethod = cust.paymentMethod ?? cust.payment_method;

      if (rawClosing !== undefined && rawClosing !== null) {
        const cDay = Number(rawClosing);
        const closing =
          cDay === 31 || cDay === 99 || cDay === 0 ? "末" : String(cDay);
        const pDay = Number(rawPayment);
        const payment =
          pDay === 31 || pDay === 99 || pDay === 0 ? "末" : String(pDay);

        let offset = "当";
        const offsetNum = Number(rawOffset);
        if (offsetNum === 1) offset = "翌";
        if (offsetNum === 2) offset = "翌々";

        const method =
          rawMethod && String(rawMethod).trim() !== ""
            ? String(rawMethod)
            : "振込";
        setPaymentTerms(
          `${closing}日締め / ${offset}月${payment}日 ${method}払い`,
        );
      } else {
        setPaymentTerms("貴社お支払基準に準拠");
      }
    }

    const updatedItems = await Promise.all(
      currentItems.map(async (item) => {
        if (item.inputType === "MASTER" && item.itemId) {
          const specialPriceVal = await fetchSpecialPrice(
            newPartnerId,
            item.itemId,
            item.quantity,
          );
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
  const handleItemChange = async (index: number, field: keyof QuoteItem, value: any) => {
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
    const specialPriceVal = await fetchSpecialPrice(customerId, targetItemId, targetQuantity);
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

  // 明細行の並び順変更(sortOrderはバックエンド側で配列インデックスから自動算出されるため、
  // ここで配列の並びを入れ替えるだけで保存時に反映される)
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
    setAttachments([
      ...attachments,
      { fileName: "", storageType, externalUrl: "" },
    ]);
  };

  const handleRemoveAttachmentRow = (index: number, fileName: string) => {
    const updatedAtts = [...attachments];
    updatedAtts.splice(index, 1);
    setAttachments(updatedAtts);

    const updatedFiles = { ...selectedFiles };
    delete updatedFiles[fileName];
    setSelectedFiles(updatedFiles);
  };

  const handleFileSelection = (
    index: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
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

  // 値引き行(金額がマイナスの明細)の合計。専用の値引き列は設けず、既存のquantity/unitPriceが
  // マイナス値を許容する仕様をそのまま利用する(バックエンドのバリデーションも元々マイナスを禁止していない)。
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
  // Item4-b追加分: 明細ごとのtaxCategoryCodeを見て10%/8%/非課税に振り分ける。
  // バックエンドのcompute-quote-amount-breakdown.ts(PDF生成用)と同じ分類方式に揃えている
  // (未選択時は従来通り10%扱い、10%/8%以外の税率は非課税バケットにまとめる)
  const calcTaxBreakdown = () => {
    const buckets = {
      rate10: { excl: 0, tax: 0 },
      rate8: { excl: 0, tax: 0 },
      rate0: { excl: 0, tax: 0 },
    };
    for (const item of items) {
      const amount = (item.quantity || 0) * (item.unitPrice || 0);
      const rate = item.taxCategoryCode
        ? (taxCategories.find((t) => t.code === item.taxCategoryCode)
            ?.taxRate ?? 0.1)
        : 0.1;
      const bucket =
        Math.abs(rate - 0.1) < 1e-9
          ? "rate10"
          : Math.abs(rate - 0.08) < 1e-9
            ? "rate8"
            : "rate0";
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

  // Item4-e: 現在のフォーム入力値からpayloadを組み立てる。通常保存(handleFormSubmit)・
  // 承認済み見積の変更申請(QuoteForm側でonSubmitApprovedEditへ渡す)の双方から使う
  const buildCurrentPayload = () => ({
    quoteId,
    quoteTitle,
    customerId,
    quoteDate,
    validUntil,
    status,
    companyDepartment: salesPersonDepartment, // 自動参照した所属部署をペイロードに追加
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
    paymentTerms,
    projectId,
    items,
    attachments,
    selectedFiles,
    totalAmount: calcTotal(),
    taxAmount: calcTax(),
  });

  const handleFormSubmit = (e: React.FormEvent, isRevisionUp: boolean) => {
    e.preventDefault();
    onSubmit(buildCurrentPayload(), isRevisionUp);
  };

  // 👇 単独メール送信ハンドラー
  const handleSingleMailSendAction = async () => {
    // 宛先が正しくない間は、送信モーダル(MailSendModal)の「送信」が押せない(BUG-037: 念のための確認)
    if (!recipientEmail || !recipientEmail.includes("@")) return;

    if (
      !(await confirm(
        `見積書 [ ${quoteId} ] を以下の宛先へ送信しますか？\n送信先: ${recipientEmail}`,
      ))
    ) {
      return;
    }

    if (handleSingleMailSend) {
      const success = await handleSingleMailSend({
        quoteId,
        recipientEmail,
      });
      if (success) {
        setShowMailModal(false);
      }
    }
  };

  return {
    quoteTitle,
    setQuoteTitle,
    customerId,
    quoteDate,
    setQuoteDate,
    validUntil,
    setValidUntil,
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
    paymentTerms,
    setPaymentTerms,
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
