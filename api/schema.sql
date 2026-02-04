-- EI Sync Database Schema
-- Run this on flare576.com MySQL database

CREATE TABLE IF NOT EXISTS ei_sync (
    encrypted_id VARCHAR(512) PRIMARY KEY,
    data LONGTEXT NOT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    rate_limit JSON DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
