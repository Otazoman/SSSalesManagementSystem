variable "account_id" {
  description = "CloudflareのアカウントID"
  type        = string
}

variable "d1_location_hint" {
  description = "D1の配置地域のヒント(apac など)。作成後は変更できない"
  type        = string
  default     = null
}

variable "r2_location" {
  description = "R2の配置地域のヒント(apac など)。作成後は変更できない"
  type        = string
  default     = null
}
