'use strict';

// Crawler configuration
exports.crawler = {
	workers: 10,
	rescanInterval: 15,
	brsUserAgent: 'BRS/9.9.9',
	timeout: 10000,
	useUtilsCrawler: false
};

// MariaDB connection configuration
exports.mariadb = {
	host: 'localhost',
	port: 3306,
	name: 'brs_crawler',
	user: 'brs_crawler',
	pass: 'brs_crawler',
	retries: 20
};
