'use strict';
const defaults = require('./config/defaults');

const assert = require('assert');
const cluster = require('cluster');

assert(cluster.isMaster);
console.log(`>>Master ${process.pid} is booting...`);

const WORKERS = process.env.WORKERS || defaults.crawler.workers;

process.on('SIGINT', () => {
	console.log(`>>Master ${process.pid} exiting...`);
	cluster.disconnect(() => {
		console.log(`>>Master DOWN`);
	});
});

cluster.setupMaster({exec: 'worker.js'});
cluster.on('exit', (worker, code, signal) => {
	console.log(`>>Worker ${worker.process.pid} EXIT ${code}/${signal}`);
});

for (let i = 0; i < WORKERS; i++) {
	cluster.fork();
}

console.log(`>>Master ${process.pid} UP`);
