
-- sample user/schema creation
--CREATE DATABASE brs_crawler;
--CREATE USER 'brs_crawler'@'localhost' IDENTIFIED BY 'brs_crawler';
--GRANT ALL PRIVILEGES ON brs_crawler.* TO 'brs_crawler'@'localhost';

use brs_crawler;

-- peers table
CREATE TABLE IF NOT EXISTS peers (
	id INT UNSIGNED NOT NULL AUTO_INCREMENT,
	address VARCHAR(100) NOT NULL,
	blocked SMALLINT UNSIGNED DEFAULT 0 NOT NULL,
	first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL,
	last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL,
	last_scanned TIMESTAMP NULL,
	CONSTRAINT peers_pk PRIMARY KEY (id),
	CONSTRAINT peers_address_uk UNIQUE KEY (address)
)
AUTO_INCREMENT=1
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_general_ci;

-- scans tables
CREATE TABLE IF NOT EXISTS scan_versions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  version VARCHAR(10) NOT NULL,
  CONSTRAINT scan_versions_pk PRIMARY KEY (id),
  CONSTRAINT scan_versions_version_uk UNIQUE KEY (version)
)
AUTO_INCREMENT=1
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS scan_platforms (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  platform VARCHAR(100) NOT NULL,
  CONSTRAINT scan_platforms_pk PRIMARY KEY (id),
  CONSTRAINT scan_platforms_platform_uk UNIQUE KEY (platform)
)
AUTO_INCREMENT=1
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS scans (
	id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	peer_id INT UNSIGNED NOT NULL,
	ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL,
	result SMALLINT UNSIGNED NOT NULL,
	rtt SMALLINT UNSIGNED NULL,
	version_id INT UNSIGNED NULL,
	platform_id INT UNSIGNED NULL,
	peers_count SMALLINT UNSIGNED NULL,
	block_height INT UNSIGNED NULL,
	CONSTRAINT scans_pk PRIMARY KEY (id),
  CONSTRAINT scans_peer_id_fk FOREIGN KEY (peer_id) REFERENCES peers (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
)
AUTO_INCREMENT=1
ENGINE=InnoDB
DEFAULT CHARSET=utf8mb4
COLLATE=utf8mb4_general_ci;

-- insert bootstrap peer(s)
INSERT peers (address) VALUES ('wallet.burst-alliance.org:8123') ON DUPLICATE KEY UPDATE last_scanned=NULL;
