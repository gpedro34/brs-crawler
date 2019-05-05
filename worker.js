'use strict';

const exit = require('exit');
const assert = require('assert');
const cluster = require('cluster');

const defaults = require('./config/defaults');
const utils = require('./lib/utils');
const peers = require('./lib/peers');

assert(cluster.isWorker);
console.log(`>>Worker ${process.pid} booting...`);

const BRS_USER_AGENT =
	process.env.BRS_USER_AGENT || defaults.crawler.brsUserAgent;
const BRS_TIMEOUT = process.env.BRS_TIMEOUT || defaults.crawler.timeout;
const RESCAN_INTERVAL =
	process.env.RESCAN_INTERVAL || defaults.crawler.rescanInterval;

const retries = process.env.DB_CONN_RETRIES || defaults.mariadb.retries;
let dbRetry = retries;

const connect = () =>
	require('mysql2/promise').createPool({
		host: process.env.DB_HOST || defaults.mariadb.host,
		port: process.env.DB_PORT || defaults.mariadb.port,
		user: process.env.DB_USER || defaults.mariadb.user,
		password:
			process.env.DB_PASS ||
			utils.readFileTrim(__dirname + '/.db.passwd') ||
			defaults.mariadb.pass,
		database: process.env.DB_NAME || defaults.mariadb.name,
		connectionLimit: 3
		// supportBigNumbers: true,
	});

let db, p2p;
try {
	db = connect();
	dbRetry = 0;
	p2p = new peers(db);
	console.log('Connected to MariaDB');
} catch (err) {
	console.log(
		'Failed trying to establish connection to MariaDB. Trying again in 5 seconds...'
	);
	console.log(err);
	dbRetry--;
	const int = setInterval(() => {
		if (dbRetry > 0) {
			try {
				db = connect();
				dbRetry = 0;
				p2p = new peers(db);
				console.log('Connected to MariaDB');
				clearInterval(int);
			} catch (err) {
				console.log(
					'Failed trying to establish connection to MariaDB. Trying again in 5 seconds...'
				);
				console.log(err);
				dbRetry--;
			}
		} else {
			// prettier-ignore
			console.log(
				'Failed trying to establish connection to MariaDB. Tried ' + retries + ' times. Exiting!'
			);
			clearInterval(int);
			exit(500);
		}
		dbRetry--;
	}, 5000);
}

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
