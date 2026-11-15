-- REQ-006: 今ある倉庫(直送用を除く)の取引先(種類 WAREHOUSE、倉庫コードと同じ番号)を作る(データを足すだけ。列・表は変えない)。
-- 同じ番号の取引先が既にある倉庫は飛ばす(倉庫間移動の指示書を作る時にエラーで知らせる)。以後は倉庫マスタの更新に合わせて作り・直す。
INSERT INTO `partners` (`id`, `name`, `type`, `postal_code`, `address`, `phone`, `fax`, `status`, `memo`, `created_by`, `created_at`, `updated_by`, `updated_at`)
SELECT `w`.`id`, `w`.`name`, 'WAREHOUSE', `w`.`postal_code`, `w`.`address`, `w`.`phone_number`, `w`.`fax_number`, `w`.`status`,
       '倉庫マスタに合わせて自動で登録した倉庫の取引先(倉庫間移動の指示書の宛先。REQ-006)', 'SYSTEM', CAST(strftime('%s', 'now') AS INTEGER), 'SYSTEM', CAST(strftime('%s', 'now') AS INTEGER)
FROM `warehouses` AS `w`
WHERE `w`.`warehouse_type` <> 'DIRECT'
  AND NOT EXISTS (SELECT 1 FROM `partners` AS `p` WHERE `p`.`id` = `w`.`id`);
