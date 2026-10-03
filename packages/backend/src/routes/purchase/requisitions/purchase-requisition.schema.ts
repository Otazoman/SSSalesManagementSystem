import * as v from "valibot";

// Helper: null, undefined, 空文字を安全に受容して文字列を返す(quote.schema.tsと同じ方針)
const optionalString = v.optional(v.nullable(v.string()));

// Helper: 数値、または数値に変換可能な文字列/null/undefinedを安全に受容
const optionalNumber = v.optional(
  v.nullable(
    v.union([
      v.number(),
      v.pipe(
        v.string(),
        v.transform((val) => (val === "" ? 0 : Number(val))),
      ),
    ]),
  ),
);

// Item9追加設計確定: 購買区分は当初案(消耗品/製品部材×都度/定期+前払の5種)から、
// 消耗品/製品部材の区別(会計科目区分のみの違いで挙動差が無い。明細ごとのaccountCodeで
// 別途管理される)を削り、都度/定期/前払の3種に簡素化(2026-09-03ユーザー確認済み)。
// 既存のpurchase_requests.requestType列をそのまま流用する。
export const PURCHASE_REQUISITION_CATEGORIES = [
  "ONE_TIME",
  "PERIODIC",
  "PREPAYMENT",
] as const;
export const PurchaseRequisitionCategorySchema = v.picklist(
  PURCHASE_REQUISITION_CATEGORIES,
);

// 一覧検索クエリのバリデーション
export const SearchPurchaseRequisitionsQuerySchema = v.object({
  id: v.optional(v.string()),
  title: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  status: v.optional(v.string()),
  requestType: v.optional(v.string()),
  applicantId: v.optional(v.string()),
  // 追加要望: 仕入先・含まれる商品での絞り込み検索
  partnerId: v.optional(v.string()),
  itemKeyword: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

// 明細行の型。quote_itemsと同じ「マスタ選択(MASTER)/手入力(DIRECT)」両対応。
// itemIdはどちらの形式でも値を持つ(MASTER=マスタのID、DIRECT=自由入力のコード文字列。quotesと同じ扱い)。
// Phase3フォローアップ: 勘定科目はヘッダー(PurchaseRequisitionPayloadSchema.accountCode)へ移動、
// 明細にはquote_itemsと同じunitCode/taxCategoryCode/sortOrderを追加
export const PurchaseRequisitionItemSchema = v.looseObject({
  itemId: v.string(),
  itemName: optionalString,
  inputType: v.optional(v.picklist(["MASTER", "DIRECT"]), "MASTER"),
  quantity: v.union([
    v.number(),
    v.pipe(
      v.string(),
      v.transform((val) => Number(val) || 0),
    ),
  ]),
  estimatedUnitPrice: v.union([
    v.number(),
    v.pipe(
      v.string(),
      v.transform((val) => Number(val) || 0),
    ),
  ]),
  unitCode: optionalString,
  taxCategoryCode: optionalString,
  // K-2-b: 明細単位で個別セットする勘定科目(未設定なら品目マスタのaccountCodeを使う)
  accountCode: optionalString,
  sortOrder: v.optional(
    v.union([
      v.number(),
      v.pipe(
        v.string(),
        v.transform((val) => Number(val) || 0),
      ),
    ]),
    0,
  ),
  memo: optionalString,
  // Item9 Phase4以降(受注紐付け)で使う。今回(Phase3、任意起票のみ)は常にnull固定
  salesOrderItemId: optionalString,
});

// 添付ファイルの型。quote_attachmentsと同じR2/外部URL(共有リンク)両対応
export const PurchaseRequisitionAttachmentInputSchema = v.looseObject({
  fileName: v.string(),
  storageType: v.optional(v.picklist(["R2", "GOOGLE_DRIVE"]), "R2"),
  attachmentR2Path: optionalString,
  externalUrl: optionalString,
});

// 購買申請登録・更新 JSON ペイロード用。仕入先は品目と同じ「マスタ選択(MASTER)/手入力(DIRECT)」両対応
export const PurchaseRequisitionPayloadSchema = v.looseObject({
  id: optionalString,
  title: v.string(),
  departmentSurrogateId: v.string(),
  requestType: v.optional(PurchaseRequisitionCategorySchema, "ONE_TIME"),
  partnerId: optionalString,
  partnerName: optionalString,
  partnerInputType: v.optional(v.picklist(["MASTER", "DIRECT"]), "MASTER"),
  // J-2-e(2026-09-13ユーザー確認済み): 勘定科目欄を廃止しプロジェクトに置き換えた。ヘッダー1件につき1つ
  projectId: optionalString,
  // 見積のsalesPersonEmployeeNumber/inputPersonEmployeeNumberと同じ2担当者分離。
  // applicantIdは既存列(従来はログイン操作者固定)だが、見積と同様に明示指定できるようにする
  applicantId: optionalString,
  inputPersonEmployeeNumber: optionalString,
  totalAmount: optionalNumber,
  taxAmount: optionalNumber,
  memo: optionalString,
  historyComment: optionalString,
  items: v.optional(v.array(PurchaseRequisitionItemSchema)),
  attachments: v.optional(v.array(PurchaseRequisitionAttachmentInputSchema)),
});

export type SearchPurchaseRequisitionsQuery = v.InferOutput<
  typeof SearchPurchaseRequisitionsQuerySchema
>;
export type PurchaseRequisitionPayload = v.InferOutput<
  typeof PurchaseRequisitionPayloadSchema
>;
export type PurchaseRequisitionCategory = v.InferOutput<
  typeof PurchaseRequisitionCategorySchema
>;
