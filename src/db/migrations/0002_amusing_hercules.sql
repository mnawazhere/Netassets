CREATE TABLE `review_items` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`payload` text NOT NULL,
	`reason` text NOT NULL,
	`conflicts_with` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_items_status_idx` ON `review_items` (`status`);--> statement-breakpoint
ALTER TABLE `imports` ADD `source_account` text;