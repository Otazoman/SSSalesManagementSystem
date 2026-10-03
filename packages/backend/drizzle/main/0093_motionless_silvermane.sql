CREATE TABLE `journal_posting_patterns` (
	`event_type` text NOT NULL,
	`document_type` text NOT NULL,
	`line_kind` text NOT NULL,
	`debit_from_item` integer DEFAULT false NOT NULL,
	`debit_account_code` text,
	`credit_from_item` integer DEFAULT false NOT NULL,
	`credit_account_code` text,
	`updated_by` text,
	`updated_at` integer,
	PRIMARY KEY(`event_type`, `document_type`, `line_kind`),
	FOREIGN KEY (`debit_account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credit_account_code`) REFERENCES `accounts`(`code`) ON UPDATE no action ON DELETE no action
);
