import * as v from "valibot";
import { stockQualityStatusSchema } from "../../../constants/stock-transaction-types";

export const createDisposalSchema = v.object({
  itemId: v.string("品目IDは必須です"),
  warehouseId: v.string("倉庫IDは必須です"),
  locationId: v.string("ロケーションIDは必須です"),
  lotNumber: v.optional(v.string(), "NONE"),
  accountCode: v.optional(v.nullable(v.string())),
  qualityStatus: v.optional(stockQualityStatusSchema, "NORMAL"),
  quantity: v.pipe(
    v.number("数量は数値で指定してください"),
    v.minValue(0.001, "数量は0より大きい値を指定してください"),
  ),
  memo: v.optional(v.nullable(v.string())),
  // 追加要望F: 申請者が複数部門に所属する場合に選択した申請部門(任意)
  applicantDepartmentSurrogateId: v.optional(v.nullable(v.string())),
});

export type CreateDisposalInput = v.InferOutput<typeof createDisposalSchema>;

// 廃棄履歴一覧の検索クエリ
export const GetDisposalsQuerySchema = v.object({
  status: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  createdBy: v.optional(v.string()),
  // K-2-f: 品目・ロケーション・倉庫による検索
  itemId: v.optional(v.string()),
  locationId: v.optional(v.string()),
  warehouseId: v.optional(v.string()),
  sortBy: v.optional(v.string()),
  sortOrder: v.optional(v.string()),
});

export type GetDisposalsQuery = v.InferOutput<typeof GetDisposalsQuerySchema>;

// CSV一括登録(1行=1廃棄)
export const bulkRegisterDisposalSchema = v.object({
  csvData: v.string("CSVデータは文字列で指定してください"),
});

export type BulkRegisterDisposalInput = v.InferOutput<typeof bulkRegisterDisposalSchema>;
