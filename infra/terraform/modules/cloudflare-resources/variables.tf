variable "account_id" {
  description = "CloudflareのアカウントID(ダッシュボード右側、またはWorkers & Pagesの概要に表示)"
  type        = string
}

variable "name_suffix" {
  description = "リソース名の末尾に付ける環境の識別子。本番は空(既存の名前のまま)、ステージングは \"-staging\""
  type        = string
  default     = ""
}

variable "d1_location_hint" {
  description = "D1の配置地域のヒント(apac / weur / eeur / enam / wnam / oc)。作成後は変更できない。null=Cloudflareにまかせる"
  type        = string
  default     = null
}

variable "r2_location" {
  description = "R2の配置地域のヒント(apac / weur / eeur / enam / wnam / oc)。作成後は変更できない。null=Cloudflareにまかせる"
  type        = string
  default     = null
}

# D1: 物理データベース(グループ)ごとに、名前と使うバインディング名の一覧を指定する。
# 1グループ=1個のD1データベースを作り、その中の複数バインディングを同じデータベースへ向けられる
# (D1データベース数がアカウント単位で上限のある無料プランで、stagingをまとめて作るときに使う。
# アプリ側のコードはバインディング名を見るだけなので、この変更にコード変更は不要)。
# 既定値は本番と同じ6分割(現状維持)。
variable "d1_groups" {
  description = "D1データベースのグループ定義(グループ名 => { name = データベース名, bindings = バインディング名の一覧 })"
  type = map(object({
    name     = string
    bindings = list(string)
  }))
  default = {
    DB         = { name = "my-erp-db", bindings = ["DB"] }
    DB_LOG     = { name = "my-erp-log-db", bindings = ["DB_LOG"] }
    DB_OTP     = { name = "my-erp-otp-db", bindings = ["DB_OTP"] }
    DB_JOURNAL = { name = "my-erp-journal-db", bindings = ["DB_JOURNAL"] }
    DB_DEALS   = { name = "my-erp-deals-db", bindings = ["DB_DEALS"] }
    DB_UI      = { name = "my-erp-ui-db", bindings = ["DB_UI"] }
  }
}
