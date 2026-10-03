import * as v from "valibot";

// 画面から文字列またはBooleanで送られてくる入力をBooleanに変換するカスタム変換器
const booleanTransform = v.pipe(
  v.union([v.boolean(), v.string()]),
  v.transform((val) => {
    if (typeof val === "boolean") return val;
    return val === "true";
  }),
);

// PUT: システム設定更新用スキーマ
export const UpdateCompanySettingsSchema = v.object({
  company_name: v.optional(v.string(), ""),
  site_url: v.optional(v.string(), ""),
  company_zip: v.optional(v.string(), ""),
  company_address: v.optional(v.string(), ""),
  company_tel: v.optional(v.string(), ""),
  company_fax: v.optional(v.string(), ""),
  // Item4-a: 帳票テンプレートの{{company_invoice_no}}に対応(インボイス制度の登録番号)
  company_invoice_registration_no: v.optional(v.string(), ""),
  is_audit_log_enabled: v.optional(booleanTransform, true),
  // 旧is_master_approval_enabled。実態は取引先マスタ専用のフラグのため実情に合わせて改名(本番未稼働のため移行処理なしで改名)。
  is_partner_approval_enabled: v.optional(booleanTransform, true),
  // Item4-e: マスタ単位の承認トグル(取引先=is_partner_approval_enabledは既存のまま維持、
  // 他9マスタ分を新規追加)。現時点で実際に機能を持つのは取引先(is_partner_approval_enabled)のみ。
  // 他9項目は将来のItem5実装時に使う想定で、値の保存先だけ先に用意しておく(画面のみ整備、詳細実装は後日)。
  is_partner_contact_approval_enabled: v.optional(booleanTransform, true),
  is_product_approval_enabled: v.optional(booleanTransform, true),
  is_product_price_approval_enabled: v.optional(booleanTransform, true),
  is_item_structure_approval_enabled: v.optional(booleanTransform, true),
  is_unit_approval_enabled: v.optional(booleanTransform, true),
  is_account_approval_enabled: v.optional(booleanTransform, true),
  is_warehouse_approval_enabled: v.optional(booleanTransform, true),
  is_location_approval_enabled: v.optional(booleanTransform, true),
  // 新規要望: 営業拠点マスタ(2026-09-23新設)
  is_business_location_approval_enabled: v.optional(booleanTransform, true),
  is_tax_category_approval_enabled: v.optional(booleanTransform, true),
  // Item4-e: 伝票単位の承認トグル(旧is_document_approval_enabledという単一グローバルフラグを廃止し、
  // 伝票種別ごとに置き換え)。現時点で実際に機能を持つのはis_quote_approval_enabledのみ。
  // 他7項目は将来のItem7-10実装時に使う想定で、値の保存先だけ先に用意しておく。
  is_quote_approval_enabled: v.optional(booleanTransform, true),
  is_sales_order_approval_enabled: v.optional(booleanTransform, true),
  // Item9 Phase3: 購買申請。ON時は購買申請の承認申請提出(REGISTER)・変更申請(UPDATE)・
  // 削除申請(DELETE)がWorkflowEngine経由の承認必須になる(quotes/sales_ordersと同じ標準パターン)。
  is_purchase_requisition_approval_enabled: v.optional(booleanTransform, true),
  is_purchase_order_approval_enabled: v.optional(booleanTransform, true),
  is_sales_approval_enabled: v.optional(booleanTransform, true),
  is_purchase_approval_enabled: v.optional(booleanTransform, true),
  // Item8/10(2026-09-13ユーザー確認済み): 売上/仕入の残計上可能数量の基準を選択式にする。
  // false(既定)=受注/発注明細数量に対して独立計上可能。true=出荷/入荷済み数量までしか計上不可
  is_sales_invoice_requires_shipment: v.optional(booleanTransform, false),
  is_purchase_recognition_requires_receipt: v.optional(booleanTransform, false),
  is_receiving_approval_enabled: v.optional(booleanTransform, true),
  is_shipping_approval_enabled: v.optional(booleanTransform, true),
  is_inventory_approval_enabled: v.optional(booleanTransform, true),
  // Item6: 在庫マスタ(外部倉庫の指示発行/実績反映、廃棄決定)。今回は値の保存先のみ用意し、
  // workflow-engine/settings.ts側の判定関数は次回以降のセッションで実装する(後日配線パターン)。
  is_shipping_instruction_approval_enabled: v.optional(booleanTransform, true),
  is_shipping_result_approval_enabled: v.optional(booleanTransform, true),
  is_receiving_instruction_approval_enabled: v.optional(booleanTransform, true),
  is_receiving_result_approval_enabled: v.optional(booleanTransform, true),
  is_disposal_approval_enabled: v.optional(booleanTransform, true),
  // Item6 Phase6-3-2: 品質区分変更(破損・不良品管理)。良品⇔破損品/検品待ちどちらの向きの
  // 変更も承認対象とする。targetTypeは入出庫と同じinventory_stockを共有するため、
  // 承認フロー設定自体は新規に追加不要(このON/OFFフラグのみ独立させる)。
  is_damage_approval_enabled: v.optional(booleanTransform, true),
  // Item6 Phase6-3-3: 返品(仕入先へ返品/得意先から返品の両方向)。在庫を増減させる操作のため
  // 独立のフラグとする。targetTypeは入出庫と同じinventory_stockを共有するため、
  // 承認フロー設定自体は新規に追加不要(このON/OFFフラグのみ独立させる)。
  is_return_approval_enabled: v.optional(booleanTransform, true),
  is_pagination_enabled: v.optional(booleanTransform, false),
  // BUG-042: 消費税の端数処理(伝票ごと・税率ごとに1回)。floor=切り捨て / round=四捨五入 / ceil=切り上げ
  tax_rounding_mode: v.optional(v.picklist(["floor", "round", "ceil"]), "floor"),
  smtp_host: v.optional(v.string(), "smtp.gmail.com"),
  smtp_port: v.pipe(
    v.optional(v.union([v.string(), v.number()]), "587"),
    v.transform((val) => String(val).trim()),
  ),
  smtp_user: v.optional(v.string(), ""),
  smtp_pass: v.optional(v.string(), ""),
  smtp_from: v.optional(v.string(), ""),
  // Item0: 通知outbox関連
  slack_bot_token: v.optional(v.string(), ""),
  mail_batch_size: v.pipe(
    v.optional(v.union([v.string(), v.number()]), "5"),
    v.transform((val) => String(val).trim()),
  ),
  // Item4-c: 見積書OTPダウンロードで、入力メールアドレスを取引先の登録済み連絡先に限定するか
  is_otp_download_restricted_to_contacts: v.optional(booleanTransform, true),
  // Item4-c: OTPの桁数・有効期限(分)・最大試行回数(いずれも可変設定、ユーザー確認済み)
  otp_digit_count: v.pipe(
    v.optional(v.union([v.string(), v.number()]), "4"),
    v.transform((val) => String(val).trim()),
  ),
  otp_expiry_minutes: v.pipe(
    v.optional(v.union([v.string(), v.number()]), "10"),
    v.transform((val) => String(val).trim()),
  ),
  otp_max_attempts: v.pipe(
    v.optional(v.union([v.string(), v.number()]), "5"),
    v.transform((val) => String(val).trim()),
  ),
  // BUG-022: ログインの失敗回数の上限。続けてこの回数失敗したアカウントはロック(無効化)する。0は制限なし
  login_max_failed_attempts: v.pipe(
    v.optional(v.union([v.string(), v.number()]), "5"),
    v.transform((val) => String(val).trim()),
    v.regex(/^\d{1,3}$/, "ログインの失敗回数の上限は、0〜999の数字で入力してください"),
  ),
  // BUG-046: パスワードのルール。本人が設定する時(変更・再設定)に確かめ、管理者がユーザー管理で設定する時は確かめない
  password_min_length: v.pipe(
    v.optional(v.union([v.string(), v.number()]), "8"),
    v.transform((val) => String(val).trim()),
    v.check(
      (val) => /^\d{1,2}$/.test(val) && Number(val) >= 8 && Number(val) <= 64,
      "パスワードの最小文字数は、8〜64の数字で入力してください",
    ),
  ),
  password_require_uppercase: v.optional(booleanTransform, false),
  password_require_lowercase: v.optional(booleanTransform, false),
  password_require_digit: v.optional(booleanTransform, false),
  password_require_symbol: v.optional(booleanTransform, false),
  // 伝票番号フォーマット(伝票種別キー→設定)。未実装の伝票種別が今後増えても、
  // ここはスキーマ変更なしでキーを追加していけるようv.recordにしている
  document_number_formats: v.optional(
    v.record(
      v.string(),
      v.object({
        usePrefix: v.optional(booleanTransform, true),
        prefix: v.optional(v.string(), ""),
        digitCount: v.pipe(
          v.optional(v.union([v.string(), v.number()]), "4"),
          v.transform((val) => Number(val)),
          v.minValue(1),
          v.maxValue(10),
        ),
      }),
    ),
    {},
  ),
  // マスタコードフォーマット(マスタ種別キー→設定)。document_number_formatsと同じ理由でv.recordにしている
  master_code_formats: v.optional(
    v.record(
      v.string(),
      v.object({
        usePrefix: v.optional(booleanTransform, true),
        prefix: v.optional(v.string(), ""),
        digitCount: v.pipe(
          v.optional(v.union([v.string(), v.number()]), "4"),
          v.transform((val) => Number(val)),
          v.minValue(1),
          v.maxValue(10),
        ),
      }),
    ),
    {},
  ),
  // ファームバンキング: 全銀協会「総合振込」フォーマットのヘッダーレコードに必要な自社(委託者)情報。
  // 半角カナでの入力を前提とする(ファイル生成時にJIS X0201へそのままエンコードするため、
  // 全角/かな漢字が混じっているとエンコードできず生成エラーになる)
  fb_committer_code: v.optional(v.string(), ""),
  fb_committer_name: v.optional(v.string(), ""),
  fb_bank_code: v.optional(v.string(), ""),
  fb_bank_name: v.optional(v.string(), ""),
  fb_branch_code: v.optional(v.string(), ""),
  fb_branch_name: v.optional(v.string(), ""),
  fb_account_type: v.optional(v.string(), "ORDINARY"),
  fb_account_number: v.optional(v.string(), ""),
});

export type UpdateCompanySettingsInput = v.InferOutput<
  typeof UpdateCompanySettingsSchema
>;

// POST: テストメール送信用スキーマ
export const SendTestEmailSchema = v.object({
  toEmail: v.pipe(
    v.string(),
    v.email("有効なメールアドレス形式で入力してください"),
  ),
  settings: UpdateCompanySettingsSchema,
});

export type SendTestEmailInput = v.InferOutput<typeof SendTestEmailSchema>;
