CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`class` text NOT NULL,
	`name` text NOT NULL,
	`platform` text,
	`currency` text NOT NULL,
	`symbol` text,
	`grade` text,
	`grader` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_class_idx` ON `assets` (`class`);--> statement-breakpoint
CREATE INDEX `assets_platform_idx` ON `assets` (`platform`);--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`source` text NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_log_entity_idx` ON `change_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` real NOT NULL,
	`as_of` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_pair_asof_uq` ON `fx_rates` (`base`,`quote`,`as_of`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`kind` text NOT NULL,
	`platform` text,
	`period_start` text,
	`period_end` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lots` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`fees_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`date` text NOT NULL,
	`source_ref` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lots_asset_idx` ON `lots` (`asset_id`);--> statement-breakpoint
CREATE TABLE `price_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`currency` text NOT NULL,
	`price_minor` integer NOT NULL,
	`as_of` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_cache_symbol_uq` ON `price_cache` (`symbol`,`currency`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_key_uq` ON `settings` (`key`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`quantity` real,
	`hours_spent` real DEFAULT 0 NOT NULL,
	`source_account` text,
	`source_ref` text,
	`fingerprint` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_fingerprint_uq` ON `transactions` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `transactions_asset_date_idx` ON `transactions` (`asset_id`,`date`);--> statement-breakpoint
CREATE TABLE `valuation_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`date` text NOT NULL,
	`value_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `valuation_marks_asset_date_idx` ON `valuation_marks` (`asset_id`,`date`);