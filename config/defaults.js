//Crawler configuration
exports.crawler = {
	"threadsPerCPU": 1,
	"rescanInterval": 15,
	"brsUserAgent": "BRS/2.2.7",				//BRS version to fake in the API calls
	"P2PTimeout": 3000									//if getInfo API call this is ignored
};
//MariaDB connection configuration
exports.mariadb = {
	"host": "localhost",
	"port": 3306,
	"name": "brs_crawler",
	"user": "brs_crawler",
	"pass": "brs_crawler"
};
