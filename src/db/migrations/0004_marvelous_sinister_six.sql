CREATE TABLE `symbol_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`class` text NOT NULL,
	`display_name` text NOT NULL,
	`symbol` text NOT NULL,
	`provider_id` text NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `symbol_mappings_key_class_uq` ON `symbol_mappings` (`key`,`class`);