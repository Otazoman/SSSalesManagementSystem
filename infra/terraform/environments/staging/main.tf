terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # 状態(terraform.tfstate)は既定ではこのフォルダのローカルに置く(Git管理外)。
  # チームで共有する場合の設定は infra/README.md の「状態ファイルの置き場所」を参照。
}

# APIトークンはここに書かず、環境変数 CLOUDFLARE_API_TOKEN で渡す(README参照)
provider "cloudflare" {}

module "cloudflare" {
  source = "../../modules/cloudflare-resources"

  account_id       = var.account_id
  name_suffix      = "-staging"
  d1_location_hint = var.d1_location_hint
  r2_location      = var.r2_location

  # D1データベース数の無料プラン上限(1アカウント10個)に収めるため、staging用は
  # DB(業務データ)以外の5つ(DB_LOG/DB_OTP/DB_JOURNAL/DB_DEALS/DB_UI)を1つの物理
  # データベースにまとめる(テーブル名・migrationファイル名の重複が無いことを確認済み)。
  # アプリのコードはバインディング名(env.DB_LOG等)を見るだけなので、コード変更は不要。
  # 本番はmodules側の既定値(6分割)のまま変更しない
  d1_groups = {
    DB = { name = "my-erp-db", bindings = ["DB"] }
    DB_SHARED = {
      name     = "my-erp-shared-db"
      bindings = ["DB_LOG", "DB_OTP", "DB_JOURNAL", "DB_DEALS", "DB_UI"]
    }
  }
}

output "wrangler_bindings" {
  value = module.cloudflare.wrangler_bindings
}
