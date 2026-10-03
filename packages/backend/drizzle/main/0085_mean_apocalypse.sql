CREATE TABLE `purchase_recognition_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_recognition_id` text NOT NULL,
	`item_receipt_id` text NOT NULL,
	FOREIGN KEY (`purchase_recognition_id`) REFERENCES `purchase_recognitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_receipt_id`) REFERENCES `item_receipt_headers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_recognition_receipts_unique` ON `purchase_recognition_receipts` (`purchase_recognition_id`,`item_receipt_id`);