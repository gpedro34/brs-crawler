'use strict';
const defaults = require('./config/defaults');
const utils = require('./lib/utils');
const peers = require('./lib/peers');

const assert = require('assert');
const cluster = require('cluster');

assert(cluster.isWorker);
console.log(`>>Worker ${process.pid} booting...`);

const BRS_USER_AGENT = process.env.BRS_USER_AGENT || defaults.crawler.brsUserAgent;
const BRS_TIMEOUT = process.env.BRS_TIMEOUT || defaults.crawler.timeout;
const RESCAN_INTERVAL = process.env.RESCAN_INTERVAL || defaults.crawler.rescanInterval;

const db = require('mysql2/promise').createPool({
	host: process.env.DB_HOST || defaults.mariadb.host,
	port: process.env.DB_PORT || defaults.mariadb.port,
	user: process.env.DB_USER || defaults.mariadb.user,
	password: process.env.DB_PASS || utils.readFileTrim(__dirname + '/.db.passwd') || defaults.mariadb.pass,
	database: process.env.DB_NAME || defaults.mariadb.name,
	//supportBigNumbers: true,
});
const p2p = new peers(db);

const scanLoop = setInterval(() => {
	p2p.scan(BRS_USER_AGENT, BRS_TIMEOUT, RESCAN_INTERVAL);
}, 500);

process.on('SIGINT', () => {
	console.log(`>>Worker ${process.pid} exiting...`);

	clearInterval(scanLoop);
	db.end();

	console.log(`>>Worker ${process.pid} DOWN`);
	process.exit();
});

console.log(`>>Worker ${process.pid} UP`);
