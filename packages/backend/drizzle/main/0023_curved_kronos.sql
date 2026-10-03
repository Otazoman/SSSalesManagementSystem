CREATE TABLE `tax_categories` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tax_type` text NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`valid_from` integer,
	`valid_to` integer
);

-- 2. 初期データ（消費税マスタ）を投入
INSERT OR IGNORE INTO `tax_categories` (`code`, `name`, `tax_type`, `tax_rate`) VALUES 
('TAX_10', '10% (標準税率)', 'STANDARD', 0.10),
('TAX_8_REDUCED', '8% (軽減税率)', 'STANDARD', 0.08),
('TAX_EXEMPT', '非課税', 'EXEMPT', 0.00),
('TAX_VARIABLE', '可変 / 手入力', 'VARIABLE', 0.00);

-- 3. items テーブルに外部キー参照 (REFERENCES) を除外した形でカラムを追加
ALTER TABLE `items` ADD `tax_category_code` text DEFAULT 'TAX_10' NOT NULL;