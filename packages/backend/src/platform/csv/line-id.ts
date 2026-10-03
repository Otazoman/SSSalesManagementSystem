import { BadRequestError } from "../http/http-error";

// 見積・受注・発注のCSVの明細ID(lineId)の検証。明細IDを指定すると、取込時にその値を明細のIDとして使う
// (空欄なら従来どおり自動採番)。受注(sourceQuoteItemId)・売上と仕入(sourceOrderItemId)がCSVから元の明細を
// 参照できるようにするため。CSV内での重複と、別の伝票の明細IDの流用はエラーにする(commit() より前に止めるため、
// 1件も取り込まない)。findParentId は、その明細IDを既に持つ伝票のID(無ければnull)を返す
export function createLineIdChecker(
  label: string,
  findParentId: (lineId: string) => Promise<string | null>,
) {
  const seen = new Map<string, string>();
  return async (lineId: string | null, parentId: string) => {
    if (!lineId) return;
    const firstParent = seen.get(lineId);
    if (firstParent !== undefined) {
      throw new BadRequestError(
        `CSVの${label}[${parentId}]: 明細ID[${lineId}]がCSV内で重複しています(${label}[${firstParent}]でも使われています)`,
      );
    }
    seen.set(lineId, parentId);
    const existingParent = await findParentId(lineId);
    if (existingParent && existingParent !== parentId) {
      throw new BadRequestError(
        `CSVの${label}[${parentId}]: 明細ID[${lineId}]は既に${label}[${existingParent}]の明細で使われています`,
      );
    }
  };
}
