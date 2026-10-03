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
  name_suffix      = ""
  d1_location_hint = var.d1_location_hint
  r2_location      = var.r2_location
}

output "wrangler_bindings" {
  value = module.cloudflare.wrangler_bindings
}
