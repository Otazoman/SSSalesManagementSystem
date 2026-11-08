import { apiFetch } from "../../../_shared/hooks/use-api-fetch";

// REQ-005: 直送の発注の納品場所(発注書に印字する直送先)。「直送: 得意先名 納品先 〒郵便番号 住所」の形にする。
// 納品先は、受注で選んだ得意先の納品先 → 受注の納品場所(自由入力) → 得意先の住所 の順で使う

interface AddressParts {
  name?: string | null;
  postalCode?: string | null;
  address?: string | null;
}

export function formatDirectShipmentPlace(
  partner: AddressParts | null,
  destination: AddressParts | null,
  salesOrderDeliveryPlace: string | null | undefined,
): string {
  const postal = (zip: string | null | undefined) => (zip ? `〒${zip}` : "");
  let place: string[];
  if (destination) {
    place = [destination.name || "", postal(destination.postalCode), destination.address || ""];
  } else if (salesOrderDeliveryPlace) {
    place = [salesOrderDeliveryPlace];
  } else {
    place = [postal(partner?.postalCode), partner?.address || ""];
  }
  const text = [partner?.name || "", ...place].filter(Boolean).join(" ");
  return text ? `直送: ${text}` : "直送";
}

/** 受注から直送先を組み立てる。取得できなかった部分は空欄のまま(画面で直せる) */
export async function fetchDirectShipmentPlace(salesOrderId: string): Promise<string> {
  const order = await apiFetch<{
    partnerId: string;
    deliveryPlace?: string | null;
    deliveryDestinationId?: string | null;
  }>(`/api/sales-orders/${encodeURIComponent(salesOrderId)}`);
  const [partners, destinations] = await Promise.all([
    apiFetch<Array<AddressParts & { id: string }>>(
      `/api/partners?id=${encodeURIComponent(order.partnerId)}`,
    ).catch(() => []),
    order.deliveryDestinationId
      ? apiFetch<Array<AddressParts & { id: string }>>(
          `/api/partner-delivery-destinations?partnerId=${encodeURIComponent(order.partnerId)}&status=all`,
        ).catch(() => [])
      : Promise.resolve([]),
  ]);
  // 取引先一覧の ID 検索は部分一致のため、同じ ID のものを選ぶ
  const partner = partners.find((p) => p.id === order.partnerId) ?? null;
  const destination = destinations.find((d) => d.id === order.deliveryDestinationId) ?? null;
  return formatDirectShipmentPlace(partner, destination, order.deliveryPlace);
}
