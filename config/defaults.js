'use strict';

// Crawler configuration
exports.crawler = {
	"threadsPerCPU": 1,
	"rescanInterval": 15,
	"brsUserAgent": "BRS/9.9.9",
	"timeout": 10000
};

// MariaDB connection configuration
exports.mariadb = {
	"host": "localhost",
	"port": 3306,
	"name": "brs_crawler",
	"user": "brs_crawler",
	"pass": "brs_crawler"
};
