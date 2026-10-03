import { sql, SQL } from "drizzle-orm";
import * as schema from "../../db/schema";
import type {
  PartnerContactDocumentType,
  WarehouseContactDocumentType,
} from "../../constants/contact-document-types";

// V-5: 帳票のメール宛先は「その帳票を送る設定の担当者」(担当者マスタの帳票設定に行がある担当者)。
// isEmailTarget(システム通知の対象)は帳票の宛先には使わない。
// 各リポジトリのWHERE条件へ、andで足して使う

export function partnerContactReceivesDocument(documentType: PartnerContactDocumentType): SQL {
  return sql`${schema.partnerContacts.id} IN (SELECT ${schema.partnerContactDocumentTypes.contactId} FROM ${schema.partnerContactDocumentTypes} WHERE ${schema.partnerContactDocumentTypes.documentType} = ${documentType})`;
}

export function warehouseContactReceivesDocument(documentType: WarehouseContactDocumentType): SQL {
  return sql`${schema.warehouseContacts.id} IN (SELECT ${schema.warehouseContactDocumentTypes.contactId} FROM ${schema.warehouseContactDocumentTypes} WHERE ${schema.warehouseContactDocumentTypes.documentType} = ${documentType})`;
}
