CREATE TABLE `liabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`asset_id` text,
	`currency` text NOT NULL,
	`outstanding_minor` integer NOT NULL,
	`as_of` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `liabilities_asset_idx` ON `liabilities` (`asset_id`);