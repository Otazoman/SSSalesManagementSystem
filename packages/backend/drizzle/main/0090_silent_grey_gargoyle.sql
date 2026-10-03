ALTER TABLE `orders` ADD `delivery_location_id` text REFERENCES business_locations(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_warehouse_id` text REFERENCES warehouses(id);