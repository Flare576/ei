-- EI Sync Database Schema (v2 - Hybrid Storage)
-- Run this on flare576.com MySQL database
--
-- Data is stored on filesystem at DATA_PATH/{aa}/{encrypted_id}.json
-- MySQL only tracks metadata for efficient lookups

CREATE TABLE IF NOT EXISTS ei_sync (
    encrypted_id VARCHAR(512) PRIMARY KEY,
    file_path VARCHAR(64) NOT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    rate_limit JSON DEFAULT NULL,
    INDEX idx_last_updated (last_updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
