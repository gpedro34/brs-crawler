'use strict';

const http = require('http');
const server = http.createServer();
server.on('request', (req, res) => {
	console.log(`${req.method} ${req.url}`);
	res.setHeader('Content-Type', 'text/plain');
	res.end();
});
server.listen(8080);
