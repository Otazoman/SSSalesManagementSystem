# 販売管理システムのCloudflareリソース(D1・R2・KV)の定義。
# Secrets StoreはCloudflareが自動作成し、アカウントに1つしか作れないため、Terraformでは管理しない
# (wranglerのコマンドで作成・確認する。README.mdの「4-5」を参照)。
# Workerそのもの(コード)はwranglerでデプロイするため、ここでは作らない。
#
# バインディング名(キー)と、リソースの基本名(値)の対応がこのファイルの唯一の定義。
# 追加・変更はここだけで行い、wrangler.jsonc への反映は infra/scripts/sync-wrangler.mjs で行う
# (バインディング自体は packages/backend/wrangler.jsonc.example に追加する)。
# (packages/backend/src/types/env.ts のバインディング名と揃えること)

locals {
  # D1はvariables.tfのd1_groups(グループ名 => {name, bindings})で定義する
  # (本番=6分割/staging=まとめる、を環境ごとに変えられるようにするため)。

  # R2: バインディング名 => バケット名
  r2_buckets = {
    SYSTEM_BUCKET                 = "system"
    QUATES_BUCKET                 = "my-erp-quates-attachments"
    PRODUCTS_BUCKET               = "my-erp-products-attachments"
    PARTNERS_BUCKET               = "my-erp-partners-attachments"
    WAREHOUSES_BUCKET             = "my-erp-warehouses-attachments"
    SHIPMENT_INSTRUCTIONS_BUCKET  = "my-erp-shipment-instructions-attachments"
    RECEIPT_INSTRUCTIONS_BUCKET   = "my-erp-receipt-instructions-attachments"
    PURCHASE_REQUISITIONS_BUCKET  = "my-erp-purchase-requisitions-attachments"
    PURCHASE_ORDERS_BUCKET        = "my-erp-purchase-orders-attachments"
    SALES_ORDERS_BUCKET           = "my-erp-sales-orders-attachments"
    SALES_INVOICES_BUCKET         = "my-erp-sales-invoices-attachments"
    BILLING_BUCKET                = "my-erp-billing-attachments"
    PURCHASE_RECOGNITIONS_BUCKET  = "my-erp-purchase-recognitions-attachments"
    ACCEPTANCE_INSPECTIONS_BUCKET = "my-erp-acceptance-inspections-attachments"
    DELIVERY_NOTES_BUCKET         = "my-erp-delivery-notes-attachments"
    DEALS_BUCKET                  = "my-erp-deals-attachments"
  }

  # KV: バインディング名 => 名前空間のタイトル
  kv_namespaces = {
    COMPANY_SETTINGS = "my-erp-company-settings"
    KV_PERMISSIONS   = "my-erp-permissions-cache"
  }
}

resource "cloudflare_d1_database" "this" {
  for_each = var.d1_groups

  account_id            = var.account_id
  name                  = "${each.value.name}${var.name_suffix}"
  primary_location_hint = var.d1_location_hint

  # 未指定(null)のままだとAPIが"Expected object, received null"で拒否するため、
  # 既定どおり読み取りレプリカを使わない設定を明示する(2026-09時点のterraform-provider-cloudflareの既知の挙動)
  read_replication = {
    mode = "disabled"
  }
}

resource "cloudflare_r2_bucket" "this" {
  for_each = local.r2_buckets

  account_id = var.account_id
  name       = "${each.value}${var.name_suffix}"
  location   = var.r2_location
}

resource "cloudflare_workers_kv_namespace" "this" {
  for_each = local.kv_namespaces

  account_id = var.account_id
  title      = "${each.value}${var.name_suffix}"
}
