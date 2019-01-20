
-- sample user/schema creation
--CREATE DATABASE brs_crawler;
--CREATE USER 'brs_crawler'@'localhost' IDENTIFIED BY 'brs_crawler';
--GRANT ALL PRIVILEGES ON brs_crawler.* TO 'brs_crawler'@'localhost';

use brs_crawler;
-- peers table
CREATE TABLE IF NOT EXISTS peers (
	address VARCHAR(100) NOT NULL,
	blocked SMALLINT UNSIGNED DEFAULT 0 NOT NULL,
	version VARCHAR(10) NULL,
	platform VARCHAR(100) NULL,
	first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL,
	last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL,
	last_reached TIMESTAMP NULL,
	last_scanned TIMESTAMP NULL,
	last_rtt SMALLINT UNSIGNED NULL,
	last_peers_count SMALLINT UNSIGNED NULL,
	last_block_height INT UNSIGNED NULL,
	CONSTRAINT peers_pk PRIMARY KEY (address)
)
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_general_ci;
--CREATE INDEX peers_version_idx USING BTREE ON peers (version);
--CREATE INDEX peers_platform_idx USING BTREE ON peers (platform);

-- insert bootstrap peer(s)
INSERT peers (address) VALUES ('wallet.burst-alliance.org:8123') ON DUPLICATE KEY UPDATE last_scanned=NULL;

