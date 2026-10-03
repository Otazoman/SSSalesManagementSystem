"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { matchProductByScanCode } from "../../../_shared/product-scan-code";
import {
  LocationRecord,
  PartnerRecord,
  ProductRecord,
  ShipmentItemRecord,
  ShipmentLineDraft,
  StockRecord,
  WarehouseRecord,
} from "../_types";
import type { ApplicantDepartmentOption } from "../../../types";
import { todayJst } from "../../../_shared/jst-date";

export interface ShipmentEditTarget {
  headerId: string;
  items: ShipmentItemRecord[];
  partnerId: string | null;
  // 新規要望(2026-09-23): 倉庫間移動。得意先の代わりに移動先倉庫が設定されている場合がある
  destinationWarehouseId?: string | null;
}

interface ShipmentInstructionOption {
  id: string;
  warehouseId: string;
  status: string;
  // Item7残課題6: 受注から作成された場合のみ設定される(単独作成の場合はnull)。
  // 実績入力時に「どの受注の消込か」を判別できるようにするため
  salesOrderId: string | null;
}

interface ShipmentInstructionItemOption {
  id: string;
  itemId: string;
  lotNumber: string;
  instructedQuantity: number;
  accountCode: string;
  // Item7残課題6: この明細が受注に紐づく出荷指示のものであれば設定される(単独作成の場合はnull)。
  // 実績反映時にこれを引き継がないと、受注紐付きの出荷指示から作成した実績が単独出庫扱いに
  // なってしまう(消込・納品書の受注番号転記が効かなくなる不具合があったため追加)
  salesOrderItemId: string | null;
}

interface SalesOrderOption {
  id: string;
  status: string;
}

interface SalesOrderItemOption {
  salesOrderItemId: string;
  itemId: string | null;
  itemName: string | null;
  remainingQuantity: number;
}

// Item6 Phase6-4: 自社倉庫の出庫(/inventory/stock)と外部倉庫の実績入力(/inventory/instructions)の
// 両方でこのフォームを共有する。warehouseTypeで倉庫選択肢を絞り込み、EXTERNALの場合のみ
// 出荷指示の紐付け(消込)入力を追加で有効にする
export function useStockShipmentForm(
  onSuccess: (message: string) => void,
  editTarget?: ShipmentEditTarget | null,
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
  // 新規要望(2026-09-23): 倉庫間移動の移動先倉庫選択肢(自社/外部を問わず全倉庫が対象)
  const [allWarehouses, setAllWarehouses] = useState<WarehouseRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [stocks, setStocks] = useState<StockRecord[]>([]);
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [instructions, setInstructions] = useState<ShipmentInstructionOption[]>([]);

  const [selectedLocation, setSelectedLocationState] = useState<LocationRecord | null>(null);
  const [selectedProduct, setSelectedProductState] = useState<ProductRecord | null>(null);
  // ロケーションに商品が1つだけのため自動で選んだ場合のみtrue(ユーザーが商品を選び直すとfalse)
  const [productAutoSelected, setProductAutoSelected] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [lines, setLines] = useState<ShipmentLineDraft[]>([]);
  // Item6 Phase6-4: 得意先(任意)。設定すると出庫確定時に納品書・納品予定データが生成される
  const [partnerId, setPartnerIdState] = useState("");
  // 新規要望(2026-09-23): 倉庫間移動の移動先倉庫(任意、得意先と排他)
  const [destinationWarehouseId, setDestinationWarehouseIdState] = useState("");
  // 得意先/移動先倉庫は排他選択(一方を選ぶと他方は自動でクリアする)
  const setPartnerId = useCallback((value: string) => {
    setPartnerIdState(value);
    if (value) setDestinationWarehouseIdState("");
  }, []);
  const setDestinationWarehouseId = useCallback((value: string) => {
    setDestinationWarehouseIdState(value);
    if (value) setPartnerIdState("");
  }, []);
  // Item6 Phase6-4: 消込対象の出荷指示(任意)。指定すると指示側の充足状況が更新される。
  // 自社倉庫の出庫でも選択可能(ユーザー要望により指示の発行元(外部倉庫)を問わず選べる)
  const [shipmentInstructionId, setShipmentInstructionId] = useState("");
  const [instructionItems, setInstructionItems] = useState<ShipmentInstructionItemOption[]>([]);
  // Item9残課題: 出荷指示を経由しない手動スキャン出庫でも受注残と消込できるようにする
  // (useStockReceiptForm.tsの発注から選ぶ、と同じパターン)
  const [orders, setOrders] = useState<SalesOrderOption[]>([]);
  const [salesOrderId, setSalesOrderId] = useState("");
  const [orderItems, setOrderItems] = useState<SalesOrderItemOption[]>([]);
  const [pendingSalesOrderItemId, setPendingSalesOrderItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reloadStocks = useCallback(async () => {
    const result = await apiFetch<StockRecord[]>("/api/stocks");
    setStocks(result);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [locs, whs, prods, partnerList] = await Promise.all([
          apiFetch<LocationRecord[]>("/api/locations?status=active"),
          apiFetch<WarehouseRecord[]>("/api/warehouses?status=active"),
          apiFetch<ProductRecord[]>("/api/products?status=active"),
          apiFetch<PartnerRecord[]>("/api/partners?status=active"),
        ]);
        // Item6 Phase6-4: 自社倉庫スキャンUIには外部倉庫を選択肢に出さない(逆にEXTERNAL指定時は
        // 外部倉庫のみ選択肢にする)。ロケーションはwarehouseId経由でしか倉庫区分を判定できないため、
        // warehousesと同様に絞り込む
        const typedWarehouses = whs.filter((w) => w.warehouseType === warehouseType);
        const typedWarehouseIds = new Set(typedWarehouses.map((w) => w.id));
        setLocations(locs.filter((l) => typedWarehouseIds.has(l.warehouseId)));
        setWarehouses(typedWarehouses);
        // 新規要望(2026-09-23): 倉庫間移動の移動先は自社/外部を問わず選べるようにする
        setAllWarehouses(whs);
        setProducts(prods);
        // 得意先(納品書の宛先)のみを選択肢にする
        setPartners(partnerList.filter((p) => p.type === "CUSTOMER" || p.type === "BOTH"));
        await reloadStocks();

        // Item6 消込データ引渡し: 出荷指示の一覧は倉庫種別を問わず取得する(自社倉庫の出庫でも、
        // 外部倉庫向けに発行済みの指示を消込対象として選べるようにするため)
        const instructionList = await apiFetch<{ data: ShipmentInstructionOption[] }>(
          "/api/shipment-instructions?limit=200",
        );
        setInstructions(
          instructionList.data.filter(
            (i) => i.status === "APPROVED" || i.status === "PARTIALLY_FULFILLED",
          ),
        );

        // Item9残課題: 消込対象の受注一覧は倉庫種別を問わず取得する(消込対象の出荷指示と同じ理由)
        const orderList = await apiFetch<{ data: SalesOrderOption[] }>(
          "/api/sales-orders?status=APPROVED&limit=200",
        );
        setOrders(orderList.data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "マスタ情報の取得に失敗しました");
      }
    })();
  }, [reloadStocks, warehouseType]);

  // 修正して再提出: editTargetが指定された場合、マスタ読込完了後に元の明細をlinesへ復元する
  useEffect(() => {
    if (!editTarget) return;
    if (locations.length === 0 || products.length === 0) return;
    void (async () => {
      setLines(
        editTarget.items.map((item) => {
          const location = locations.find((l) => l.id === item.locationId);
          const product = products.find((p) => p.id === item.itemId);
          return {
            key: crypto.randomUUID(),
            locationId: item.locationId,
            locationName: location?.name || item.locationId,
            itemId: item.itemId,
            itemName: product?.name || item.itemId,
            quantity: item.shippedQuantity,
            lotNumber: item.lotNumber,
            qualityStatus: item.qualityStatus,
          };
        }),
      );
      setPartnerIdState(editTarget.partnerId || "");
      setDestinationWarehouseIdState(editTarget.destinationWarehouseId || "");
    })();
  }, [editTarget, locations, products]);

  // Item6 消込データ引渡し: 消込対象の出荷指示を選ぶと、その明細(品目・ロット・数量・勘定科目)を
  // 取得しておき、applyInstructionItemでワンクリック入力欄へ反映できるようにする。あわせて
  // 得意先も指示のものへ引き継ぐ(指示は特定の得意先向けに発行済みのため、実績側で異なる
  // 得意先が選ばれたままだと納品書の宛先が食い違ってしまう)
  useEffect(() => {
    void (async () => {
      if (!shipmentInstructionId) {
        setInstructionItems([]);
        return;
      }
      try {
        const detail = await apiFetch<{
          header: { partnerId: string | null };
          items: ShipmentInstructionItemOption[];
        }>(`/api/shipment-instructions/${shipmentInstructionId}`);
        setInstructionItems(detail.items);
        if (detail.header.partnerId) setPartnerId(detail.header.partnerId);
      } catch {
        setInstructionItems([]);
      }
    })();
  }, [shipmentInstructionId, setPartnerId]);

  // 商品を選ぶ(スキャン・手動選択・出荷指示/受注の明細)。ユーザーが選んだ商品は自動選択とは区別する
  const setSelectedProduct = useCallback((product: ProductRecord | null) => {
    setSelectedProductState(product);
    setProductAutoSelected(false);
  }, []);

  const applyInstructionItem = useCallback(
    (item: ShipmentInstructionItemOption) => {
      const product = products.find((p) => p.id === item.itemId);
      if (product) setSelectedProduct(product);
      setQuantity(String(item.instructedQuantity));
      setPendingSalesOrderItemId(item.salesOrderItemId);
    },
    [products, setSelectedProduct],
  );

  // Item9残課題: 消込対象の受注を選ぶと、その明細(品目・残数量)を取得しておき、applyOrderItemで
  // ワンクリック入力欄へ反映できるようにする(消込対象の出荷指示と同じパターン)
  useEffect(() => {
    void (async () => {
      if (!salesOrderId) {
        setOrderItems([]);
        return;
      }
      try {
        const progress = await apiFetch<SalesOrderItemOption[]>(
          `/api/sales-orders/${salesOrderId}/shipment-progress`,
        );
        setOrderItems(progress.filter((i) => i.remainingQuantity > 0));
      } catch {
        setOrderItems([]);
      }
    })();
  }, [salesOrderId]);

  const applyOrderItem = useCallback(
    (item: SalesOrderItemOption) => {
      const product = products.find((p) => p.id === item.itemId);
      if (product) setSelectedProduct(product);
      setQuantity(String(item.remainingQuantity));
      setPendingSalesOrderItemId(item.salesOrderItemId);
    },
    [products, setSelectedProduct],
  );

  const findLocationById = useCallback(
    (code: string) => locations.find((l) => l.id === code) || null,
    [locations],
  );

  const findProductByBarcode = useCallback(
    (code: string) => matchProductByScanCode(products, code),
    [products],
  );

  const stocksAtLocation = useCallback(
    (locationId: string) => stocks.filter((s) => s.locationId === locationId && s.quantity > 0),
    [stocks],
  );

  // ロケーション×商品バーコードの両方をスキャンさせ、一致するstocks行を一意に特定する
  // (1ロケーションに複数ロット/品質区分が同居する場合の取り違え防止)
  const matchedStock = useCallback(
    (locationId: string, itemId: string) =>
      stocksAtLocation(locationId).find((s) => s.itemId === itemId) || null,
    [stocksAtLocation],
  );

  // ロケーションを選ぶ(スキャン・手動選択)。そのロケーションに出庫可能な在庫の行が1つだけなら、
  // 商品スキャンを省いて数量の入力だけで出庫できるよう、その商品を自動で選ぶ。
  // 同じ商品でもロット・品質区分が違う行が複数ある場合は、従来どおり選ばせる(1行に限る)。
  // ユーザーが既に商品を選んでいる場合はその選択を尊重し、自動で選んだ商品だけを入れ替える/外す
  const setSelectedLocation = useCallback(
    (location: LocationRecord | null) => {
      setSelectedLocationState(location);
      if (!location) return;
      const rows = stocksAtLocation(location.id);
      if (rows.length === 1) {
        const product = products.find((p) => p.id === rows[0].itemId);
        if (product && (!selectedProduct || productAutoSelected)) {
          setSelectedProductState(product);
          setProductAutoSelected(true);
        }
      } else if (productAutoSelected) {
        setSelectedProductState(null);
        setProductAutoSelected(false);
      }
    },
    [stocksAtLocation, products, selectedProduct, productAutoSelected],
  );

  const addLine = useCallback(() => {
    setError("");
    if (!selectedLocation) {
      setError("ロケーションを選択してください");
      return;
    }
    if (!selectedProduct) {
      setError("品目バーコードを選択してください");
      return;
    }
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setError("数量は0より大きい値を入力してください");
      return;
    }
    const stock = matchedStock(selectedLocation.id, selectedProduct.id);
    if (!stock) {
      setError("このロケーションに、指定した品目の出庫可能な在庫がありません");
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        locationId: selectedLocation.id,
        locationName: selectedLocation.name,
        itemId: selectedProduct.id,
        itemName: selectedProduct.name,
        quantity: qty,
        lotNumber: stock.lotNumber,
        qualityStatus: stock.qualityStatus,
        salesOrderItemId: pendingSalesOrderItemId,
      },
    ]);
    setQuantity("");
    setSelectedProduct(null);
    setPendingSalesOrderItemId(null);
  }, [selectedLocation, selectedProduct, quantity, matchedStock, pendingSalesOrderItemId, setSelectedProduct]);

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
      const url = editTarget ? `/api/stock-shipments/${editTarget.headerId}` : "/api/stock-shipments/register";
      const defaultErrorMessage = editTarget ? "出庫の修正・再申請に失敗しました" : "出庫確定に失敗しました";
      const result = await apiFetch<{ message: string }>(url, {
        method: editTarget ? "PUT" : "POST",
        json: {
          shippedDate: todayJst(),
          items: lines.map((l) => ({
            locationId: l.locationId,
            itemId: l.itemId,
            quantity: l.quantity,
            ...(l.lotNumber ? { lotNumber: l.lotNumber } : {}),
            ...(l.qualityStatus ? { qualityStatus: l.qualityStatus } : {}),
            ...(l.salesOrderItemId ? { salesOrderItemId: l.salesOrderItemId } : {}),
          })),
          partnerId: partnerId || null,
          // 新規要望(2026-09-23): 倉庫間移動の移動先倉庫(得意先と排他)
          destinationWarehouseId: destinationWarehouseId || null,
          // Item6 消込データ引渡し: 指示との紐付け(消込)は倉庫種別を問わず送る
          shipmentInstructionId: shipmentInstructionId || null,
          applicantDepartmentSurrogateId,
        },
        defaultErrorMessage,
      });
      setLines([]);
      setPartnerId("");
      setDestinationWarehouseId("");
      setShipmentInstructionId("");
      await reloadStocks();
      onSuccess(result.message);
    } catch (err: unknown) {
      const fallback = editTarget ? "出庫の修正・再申請に失敗しました" : "出庫確定に失敗しました";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  }, [
    lines,
    onSuccess,
    reloadStocks,
    editTarget,
    partnerId,
    destinationWarehouseId,
    shipmentInstructionId,
    applicantDepartmentSurrogateId,
    setPartnerId,
    setDestinationWarehouseId,
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
    destinationWarehouseId,
    setDestinationWarehouseId,
    shipmentInstructionId,
    setShipmentInstructionId,
    instructionItems,
    applyInstructionItem,
    orders,
    salesOrderId,
    setSalesOrderId,
    orderItems,
    applyOrderItem,
    selectedLocation,
    setSelectedLocation,
    selectedProduct,
    setSelectedProduct,
    productAutoSelected,
    quantity,
    setQuantity,
    lines,
    addLine,
    removeLine,
    updateLineQuantity,
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
