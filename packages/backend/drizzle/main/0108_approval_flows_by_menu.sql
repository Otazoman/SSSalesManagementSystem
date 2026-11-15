-- BUG-103: 承認フローをメニュー(画面)単位にする(ユーザー確認済み)。今ある承認フローの対象申請種別を、裏側の申請の種類からメニューの種類に移す(データの変更だけ)。
-- 同じメニューの中で伝票の種類ごとに分けていた動き(入庫と入荷指示など)を保つため、移したフローには分岐条件 documentKind を付ける
-- (分岐条件の無いフローは、そのメニューの全ての伝票に使う)。承認中の申請はフローの番号で進むため、元のフローはその場で書き換え、他のメニューの分は複製する。
-- 既に分岐条件を持つフローは、条件を変えずに種類だけ移す。

-- 1. 複製(元の種類のうちに作る)。入出庫 → 出荷・在庫(品質区分変更・廃棄・返品)、指示 → 出荷指示
INSERT INTO `approval_flows` (`id`, `name`, `request_type`, `min_amount`, `max_amount`, `is_active`, `match_field`, `match_value`)
SELECT `id` || '-' || `k`.`suffix`, `name` || '(' || `k`.`label` || ')', `k`.`menu`, `min_amount`, `max_amount`, `is_active`,
       COALESCE(`match_field`, 'documentKind'), COALESCE(`match_value`, `k`.`kind`)
FROM `approval_flows`
JOIN (
  SELECT 'inventory_stock' AS `src`, 'inventory_shipping' AS `menu`, 'SHIPMENT' AS `kind`, 'SHP' AS `suffix`, '出庫' AS `label`
  UNION ALL SELECT 'inventory_stock', 'inventory_audit', 'RECLASSIFICATION', 'RCL', '品質区分変更'
  UNION ALL SELECT 'inventory_stock', 'inventory_audit', 'DISPOSAL', 'DSP', '廃棄'
  UNION ALL SELECT 'inventory_stock', 'inventory_audit', 'RETURN', 'RTN', '返品'
  UNION ALL SELECT 'inventory_instructions', 'inventory_shipping', 'SHIPMENT_INSTRUCTION', 'SHI', '出荷指示'
) AS `k` ON `k`.`src` = `approval_flows`.`request_type`;
--> statement-breakpoint
INSERT INTO `approval_flow_steps` (`id`, `flow_id`, `step_order`, `approver_role_id`, `target_department_surrogate_id`, `step_name`, `memo`)
SELECT `s`.`id` || '-' || `k`.`suffix`, `s`.`flow_id` || '-' || `k`.`suffix`, `s`.`step_order`, `s`.`approver_role_id`, `s`.`target_department_surrogate_id`, `s`.`step_name`, `s`.`memo`
FROM `approval_flow_steps` AS `s`
JOIN `approval_flows` AS `f` ON `f`.`id` = `s`.`flow_id`
JOIN (
  SELECT 'inventory_stock' AS `src`, 'SHP' AS `suffix`
  UNION ALL SELECT 'inventory_stock', 'RCL'
  UNION ALL SELECT 'inventory_stock', 'DSP'
  UNION ALL SELECT 'inventory_stock', 'RTN'
  UNION ALL SELECT 'inventory_instructions', 'SHI'
) AS `k` ON `k`.`src` = `f`.`request_type`;
--> statement-breakpoint
-- 2. その場で書き換え(入出庫 → 入荷の入庫、指示 → 入荷指示、仕入 → 仕入管理、入金 → 請求管理、支払の消込 → 支払管理)
UPDATE `approval_flows` SET `request_type` = 'inventory_receiving',
  `match_field` = COALESCE(`match_field`, 'documentKind'), `match_value` = COALESCE(`match_value`, 'RECEIPT')
WHERE `request_type` = 'inventory_stock';
--> statement-breakpoint
UPDATE `approval_flows` SET `request_type` = 'inventory_receiving',
  `match_field` = COALESCE(`match_field`, 'documentKind'), `match_value` = COALESCE(`match_value`, 'RECEIPT_INSTRUCTION')
WHERE `request_type` = 'inventory_instructions';
--> statement-breakpoint
UPDATE `approval_flows` SET `request_type` = 'purchase_receipts' WHERE `request_type` = 'purchase_recognitions';
--> statement-breakpoint
UPDATE `approval_flows` SET `request_type` = 'sales_billing',
  `match_field` = COALESCE(`match_field`, 'documentKind'), `match_value` = COALESCE(`match_value`, 'PAYMENT_RECEIPT')
WHERE `request_type` = 'sales_payment_receipts';
--> statement-breakpoint
UPDATE `approval_flows` SET `request_type` = 'sales_billing',
  `match_field` = COALESCE(`match_field`, 'documentKind'), `match_value` = COALESCE(`match_value`, 'CASH_RECEIPT')
WHERE `request_type` = 'sales_cash_receipts';
--> statement-breakpoint
UPDATE `approval_flows` SET `request_type` = 'purchase_payment' WHERE `request_type` = 'purchase_payment_disbursements';
