import { apiFetch } from "./hooks/use-api-fetch";

// BUG-067: 取引先一覧APIの区分(type)の条件は1つしか指定できないため、区分ごとに問い合わせて指定した順にまとめる。
// 伝票の取引先は、販売側は得意先(CUSTOMER)・兼用(BOTH)、購買側は仕入先(SUPPLIER)・兼用(BOTH)を選べるようにする
// (以前は CUSTOMER・SUPPLIER だけを取得しており、兼用の取引先を伝票で選べなかった)
export async function fetchPartnersOfTypes<T>(types: string[]): Promise<T[]> {
  const lists = await Promise.all(
    types.map((type) => apiFetch<T[]>(`/api/partners?type=${encodeURIComponent(type)}`)),
  );
  return lists.flat();
}

// BUG-063・BUG-066: 取引停止(suspended)の取引先は、伝票の取引先の選択肢に出さない。
// 既に選ばれている取引先(取引停止になる前に作った伝票など)は、表示が消えないよう残す
export function selectablePartners<T extends { id: string; status?: string | null }>(
  partners: T[],
  selectedId?: string | null,
): T[] {
  return partners.filter((p) => p.status !== "suspended" || p.id === selectedId);
}
