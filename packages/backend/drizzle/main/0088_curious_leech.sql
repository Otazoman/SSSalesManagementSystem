CREATE TABLE `cash_receipt_advance_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`cash_receipt_id` text NOT NULL,
	`sales_invoice_id` text NOT NULL,
	`amount` integer NOT NULL,
	`applied_by_id` text NOT NULL,
	`applied_at` integer NOT NULL,
	FOREIGN KEY (`cash_receipt_id`) REFERENCES `cash_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sales_invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `payment_receipts` ADD `cash_receipt_id` text REFERENCES cash_receipts(id);
--> statement-breakpoint
-- 移行: 単体入金の紐づけで作られた入金消込は、これまでmemoの先頭「単体入金[<単体入金ID>]」でしか判別できなかった。
-- そのIDが実在する単体入金のものだけ、cash_receipt_idへ復元する(仕訳の対象から除外するため)
UPDATE `payment_receipts`
SET `cash_receipt_id` = substr(`memo`, 6, instr(`memo`, ']') - 6)
WHERE `memo` LIKE '単体入金[%'
  AND substr(`memo`, 6, instr(`memo`, ']') - 6) IN (SELECT `id` FROM `cash_receipts`);
