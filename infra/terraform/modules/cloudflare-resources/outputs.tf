# wrangler.jsonc へ反映するための値(infra/scripts/sync-wrangler.mjs が読む)。
# 形式を変えるときは、スクリプト側も合わせること。
output "wrangler_bindings" {
  description = "バインディング名ごとの、wrangler.jsonc に書く値"
  value = {
    # 1グループが複数バインディングを持つ場合(stagingでまとめた場合)、
    # そのグループの全バインディングへ同じdatabase_name/database_idを展開する
    d1 = merge([
      for group_key, group in var.d1_groups : {
        for binding in group.bindings :
        binding => {
          database_name = cloudflare_d1_database.this[group_key].name
          database_id   = cloudflare_d1_database.this[group_key].id
        }
      }
    ]...)
    r2 = {
      for binding, bucket in cloudflare_r2_bucket.this :
      binding => { bucket_name = bucket.name }
    }
    kv = {
      for binding, ns in cloudflare_workers_kv_namespace.this :
      binding => { id = ns.id }
    }
  }
}
