CREATE TABLE `users` (
  `id` char(36) NOT NULL,
  `email` varchar(191) NOT NULL,
  `password_hash` text NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`)
);

CREATE UNIQUE INDEX `users_email_unique_idx` ON `users` (`email`);

CREATE TABLE `sessions` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `refresh_token_hash` varchar(128) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `sessions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `sessions_refresh_token_hash_unique_idx`
  ON `sessions` (`refresh_token_hash`);

CREATE INDEX `sessions_user_id_idx`
  ON `sessions` (`user_id`);

CREATE TABLE `folders` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `parent_folder_id` char(36) NULL,
  `display_name` varchar(255) NOT NULL,
  `is_root` boolean NOT NULL DEFAULT false,
  `storage_rel_path` varchar(1024) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `folders_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `folders_parent_folder_id_fkey`
    FOREIGN KEY (`parent_folder_id`) REFERENCES `folders`(`id`) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX `folders_storage_rel_path_unique_idx`
  ON `folders` (`storage_rel_path`);

CREATE UNIQUE INDEX `folders_sibling_name_unique_idx`
  ON `folders` (`user_id`, `parent_folder_id`, `display_name`);

CREATE INDEX `folders_parent_lookup_idx`
  ON `folders` (`user_id`, `parent_folder_id`);

CREATE TABLE `files` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `folder_id` char(36) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `stored_extension` varchar(32) NOT NULL,
  `mime_type` varchar(255) NOT NULL,
  `size_bytes` bigint unsigned NOT NULL,
  `sha256` varchar(64) NOT NULL,
  `status` enum('uploading', 'ready') NOT NULL,
  `storage_rel_path` varchar(1024) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `files_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `files_folder_id_fkey`
    FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX `files_storage_rel_path_unique_idx`
  ON `files` (`storage_rel_path`);

CREATE INDEX `files_folder_lookup_idx`
  ON `files` (`user_id`, `folder_id`, `created_at`);

CREATE INDEX `files_sha256_lookup_idx`
  ON `files` (`user_id`, `sha256`);

CREATE TABLE `upload_batches` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `folder_id` char(36) NOT NULL,
  `status` enum('open', 'completed', 'partial') NOT NULL,
  `expected_count` int NULL,
  `completed_count` int NOT NULL DEFAULT 0,
  `failed_count` int NOT NULL DEFAULT 0,
  `completed_at` datetime(3) NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `upload_batches_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `upload_batches_folder_id_fkey`
    FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON DELETE RESTRICT
);

CREATE INDEX `upload_batches_user_id_idx`
  ON `upload_batches` (`user_id`, `created_at`);

CREATE TABLE `upload_items` (
  `id` char(36) NOT NULL,
  `batch_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `file_id` char(36) NULL,
  `client_idempotency_key` varchar(191) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `status` enum('pending', 'uploading', 'complete', 'failed') NOT NULL,
  `error_code` varchar(64) NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `upload_items_batch_id_fkey`
    FOREIGN KEY (`batch_id`) REFERENCES `upload_batches`(`id`) ON DELETE CASCADE,
  CONSTRAINT `upload_items_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `upload_items_file_id_fkey`
    FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE SET NULL
);

CREATE UNIQUE INDEX `upload_items_idempotency_unique_idx`
  ON `upload_items` (`user_id`, `batch_id`, `client_idempotency_key`);

CREATE INDEX `upload_items_batch_status_idx`
  ON `upload_items` (`batch_id`, `status`);

CREATE TABLE `file_derivatives` (
  `id` char(36) NOT NULL,
  `file_id` char(36) NOT NULL,
  `kind` varchar(64) NOT NULL,
  `mime_type` varchar(255) NOT NULL,
  `size_bytes` bigint unsigned NOT NULL,
  `status` enum('queued', 'processing', 'ready', 'failed') NOT NULL,
  `storage_rel_path` varchar(1024) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `file_derivatives_file_id_fkey`
    FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `file_derivatives_kind_unique_idx`
  ON `file_derivatives` (`file_id`, `kind`);

CREATE TABLE `media_jobs` (
  `id` char(36) NOT NULL,
  `file_id` char(36) NOT NULL,
  `job_type` varchar(64) NOT NULL,
  `status` enum('queued', 'processing', 'ready', 'failed') NOT NULL,
  `attempt_count` int NOT NULL DEFAULT 0,
  `scheduled_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `started_at` datetime(3) NULL,
  `finished_at` datetime(3) NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `media_jobs_file_id_fkey`
    FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE CASCADE
);

CREATE INDEX `media_jobs_status_scheduled_idx`
  ON `media_jobs` (`status`, `scheduled_at`);
