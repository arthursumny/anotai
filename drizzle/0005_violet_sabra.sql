CREATE INDEX `knowledge_org_state` ON `knowledge_documents` (`org_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `recording_sequence` ON `recording_parts` (`file_id`,`sequence`);