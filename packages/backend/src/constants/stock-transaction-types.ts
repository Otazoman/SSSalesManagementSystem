/**
 * stock_transactions.type の許容値。DB側にCHECK制約は設けず(既存規約踏襲)、
 * app層(このファイル)で型・valibot enumを一元管理する。
 *
 * Phase6-2で実際に使用: RECEIPT / SHIPMENT
 * Phase6-1時点でスキーマ・型としてのみ確定させる将来分(Phase6-3以降で使用): ADJUSTMENT / DAMAGE / DISPOSAL / RETURN / TRANSFER
 */
import * as v from "valibot";

export const STOCK_TRANSACTION_TYPES = [
  "RECEIPT",
  "SHIPMENT",
  "ADJUSTMENT",
  "DAMAGE",
  "DISPOSAL",
  "RETURN",
  "TRANSFER",
] as const;

export type StockTransactionType = (typeof STOCK_TRANSACTION_TYPES)[number];

export const stockTransactionTypeSchema = v.picklist(STOCK_TRANSACTION_TYPES);

/**
 * stocks.qualityStatus / stock_transactions.qualityStatus の許容値。
 * NORMAL(良品) / DAMAGED(破損品) / QUARANTINE(検品待ち)
 */
export const STOCK_QUALITY_STATUSES = ["NORMAL", "DAMAGED", "QUARANTINE"] as const;

export type StockQualityStatus = (typeof STOCK_QUALITY_STATUSES)[number];

export const stockQualityStatusSchema = v.picklist(STOCK_QUALITY_STATUSES);
