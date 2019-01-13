'use strict';
const defaults = require('./config/defaults');

const assert = require('assert');
const cluster = require('cluster');

assert(cluster.isMaster);
console.log(`>>Master ${process.pid} is booting...`);

const CPU_COUNT = require('os').cpus().length;
const THREADS_PER_CPU = process.env.THREADS_PER_CPU || defaults.crawler.threadsPerCPU;

process.on('SIGINT', () => {
	console.log(`>>Master ${process.pid} exiting...`);
	cluster.disconnect(() => {
		console.log(`>>Master DOWN`);
		process.exit();
	});
});

cluster.setupMaster({exec: 'worker.js'});
cluster.on('exit', (worker, code, signal) => {
	console.log(`>>Worker ${worker.process.pid} EXIT ${code}/${signal}`);
});

for (let i = 0; i < CPU_COUNT * THREADS_PER_CPU; i++) {
	cluster.fork();
}

console.log(`>>Master ${process.pid} UP`);

