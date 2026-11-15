import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { BadRequestError } from "../http/http-error";

/**
 * REQ-006: 倉庫の取引先(種類 WAREHOUSE、倉庫コードと同じ番号)。外部倉庫が絡む倉庫間移動の指示書は取引先の列が必須のため、
 * 相手の倉庫をこの取引先で表す(ユーザー確認済み。DB の列は変えない)。
 * 倉庫マスタの登録・更新・状態の変更・削除・CSV・承認に合わせて作る・直す・消す(倉庫マスタのリポジトリから呼ぶ)。直送用の倉庫は対象外。
 * 取引先マスタの画面からは、種類 WAREHOUSE の取引先を登録・変更・削除できない(倉庫マスタで直す)。
 */
export const WAREHOUSE_PARTNER_TYPE = "WAREHOUSE";

type Db = any;

/** 倉庫を登録する前に: 同じ番号の普通の取引先があれば断る */
export async function assertWarehouseIdNotUsedByPartner(db: Db, warehouseId: string): Promise<void> {
  const [partner] = await db.select().from(schema.partners).where(eq(schema.partners.id, warehouseId)).limit(1);
  if (partner && partner.type !== WAREHOUSE_PARTNER_TYPE) {
    throw new BadRequestError(
      `倉庫コード[${warehouseId}]と同じ番号の取引先(${partner.name})があるため登録できません。倉庫コードを変えてください`,
    );
  }
}

/** 取引先を登録・変更する前に: 倉庫と同じ番号・種類 WAREHOUSE の取引先は、取引先マスタからは扱わない */
export async function assertNotWarehousePartner(db: Db, partnerId: string, type?: string | null): Promise<void> {
  if (type === WAREHOUSE_PARTNER_TYPE) {
    throw new BadRequestError("種類「倉庫」の取引先は、倉庫マスタに合わせて自動で登録します(取引先マスタからは登録・変更できません)");
  }
  const [partner] = await db.select().from(schema.partners).where(eq(schema.partners.id, partnerId)).limit(1);
  if (partner?.type === WAREHOUSE_PARTNER_TYPE) {
    throw new BadRequestError("倉庫の取引先は、倉庫マスタで変更してください(取引先マスタからは変更・削除できません)");
  }
  const [warehouse] = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(eq(schema.warehouses.id, partnerId)).limit(1);
  if (warehouse && !partner) {
    throw new BadRequestError(`取引先コード[${partnerId}]は倉庫コードと同じのため登録できません。取引先コードを変えてください`);
  }
}

export interface WarehousePartnerSource {
  name: string;
  postalCode?: string | null;
  address?: string | null;
  phoneNumber?: string | null;
  faxNumber?: string | null;
  status: string;
  warehouseType?: string | null;
}

/**
 * 倉庫マスタの内容に合わせて、倉庫の取引先を作る・直す(倉庫が無ければ消す。使われていて消せなければ停止にする)。
 * saved: これから保存する倉庫の内容(承認の確定などで、書き込みが後でまとめて行われる時も正しい内容で合わせるため)。
 * 省略すると今の倉庫マスタを読む。null は倉庫を消した時
 */
export async function syncWarehousePartner(
  db: Db,
  warehouseId: string,
  operator: string,
  now: Date,
  saved?: WarehousePartnerSource | null,
): Promise<void> {
  const warehouse =
    saved === undefined
      ? (await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).limit(1))[0]
      : saved;
  const [partner] = await db.select().from(schema.partners).where(eq(schema.partners.id, warehouseId)).limit(1);
  if (partner && partner.type !== WAREHOUSE_PARTNER_TYPE) return; // 普通の取引先(登録の時に断っている。今ある倉庫の重複)は触らない

  if (!warehouse || warehouse.warehouseType === "DIRECT") {
    if (!partner) return;
    try {
      await db.delete(schema.partners).where(eq(schema.partners.id, warehouseId));
    } catch {
      // 指示書などで使われていて消せない時は停止にする
      await db
        .update(schema.partners)
        .set({ status: "suspended", updatedBy: operator, updatedAt: now })
        .where(eq(schema.partners.id, warehouseId));
    }
    return;
  }

  const values = {
    name: warehouse.name,
    postalCode: warehouse.postalCode ?? null,
    address: warehouse.address ?? null,
    phone: warehouse.phoneNumber ?? null,
    fax: warehouse.faxNumber ?? null,
    status: warehouse.status,
    updatedBy: operator,
    updatedAt: now,
  };
  if (partner) {
    await db.update(schema.partners).set(values).where(eq(schema.partners.id, warehouseId));
  } else {
    await db.insert(schema.partners).values({
      id: warehouseId,
      type: WAREHOUSE_PARTNER_TYPE,
      memo: "倉庫マスタに合わせて自動で登録した倉庫の取引先(倉庫間移動の指示書の宛先。REQ-006)",
      createdBy: operator,
      createdAt: now,
      ...values,
    });
  }
}

/** 倉庫間移動の指示書の宛先: 倉庫の取引先の番号(無ければ、同じ番号の普通の取引先がある倉庫のため断る) */
export async function requireWarehousePartner(db: Db, warehouseId: string): Promise<string> {
  const [partner] = await db.select().from(schema.partners).where(eq(schema.partners.id, warehouseId)).limit(1);
  if (!partner) {
    throw new BadRequestError(`倉庫[${warehouseId}]の取引先がありません。倉庫マスタで一度保存し直してください`);
  }
  if (partner.type !== WAREHOUSE_PARTNER_TYPE) {
    throw new BadRequestError(
      `倉庫[${warehouseId}]と同じ番号の取引先(${partner.name})があるため、倉庫間移動の指示書を作れません。どちらかの番号を変えてください`,
    );
  }
  return partner.id;
}
