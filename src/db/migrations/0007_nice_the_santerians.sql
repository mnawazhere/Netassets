CREATE TABLE `spend_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spend_entries_month_idx` ON `spend_entries` (`month`);