CREATE TABLE `partner_contact_document_types` (
	`contact_id` text NOT NULL,
	`document_type` text NOT NULL,
	PRIMARY KEY(`contact_id`, `document_type`),
	FOREIGN KEY (`contact_id`) REFERENCES `partner_contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `warehouse_contact_document_types` (
	`contact_id` text NOT NULL,
	`document_type` text NOT NULL,
	PRIMARY KEY(`contact_id`, `document_type`),
	FOREIGN KEY (`contact_id`) REFERENCES `warehouse_contacts`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
-- 移行: 従来は「isEmailTarget=true」の担当者へ全帳票を送っていたため、その担当者には全帳票を送る設定を作る
-- (移行直後も宛先が従来と同じになる)。isEmailTarget列はシステム通知の対象として残す。
-- D1は複合SELECTの項数に制限があるため、帳票ごとにINSERTを分けている
INSERT INTO `partner_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'quote' FROM `partner_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `partner_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'sales_order' FROM `partner_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `partner_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'delivery_note' FROM `partner_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `partner_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'sales_invoice_sale' FROM `partner_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `partner_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'sales_invoice_return' FROM `partner_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `partner_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'sales_invoice_discount' FROM `partner_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `partner_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'sales_invoice_correction' FROM `partner_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `partner_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'billing' FROM `partner_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `partner_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'purchase_order' FROM `partner_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `partner_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'acceptance_inspection' FROM `partner_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `warehouse_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'shipment_instruction' FROM `warehouse_contacts` WHERE `is_email_target` = 1;
--> statement-breakpoint
INSERT INTO `warehouse_contact_document_types` (`contact_id`, `document_type`) SELECT `id`, 'receipt_instruction' FROM `warehouse_contacts` WHERE `is_email_target` = 1;
