'use strict';

const fs = require('fs');
const request = require('request-promise-native');

const BRS_DEFAULT_PEER_PORT = 8123;
const BRS_PROTOCOL = 'B1';

exports.BRS_REQUESTS = {
	INFO: 'getInfo',
	PEERS: 'getPeers',
};

exports.readFileTrim = (file) => {
	if (fs.existsSync(file)) {
		return fs.readFileSync(file,'utf8').trim();
	}
	return null;
};

// return peer always with port.
// if no port was given, add default peering port.
exports.normalizePeer = (peer) => {
	if (peer.indexOf(':', peer.indexOf(']')) < 0) {
		return peer+':'+BRS_DEFAULT_PEER_PORT;
	}
	return peer;
};

exports.callBRS = async (peerUrl, userAgent, timeout, requestType) => {
	return request({
		method: 'POST',
		url: peerUrl,
		timeout: timeout,
		headers: {
			'User-Agent': userAgent
		},
		json: true,
		body: {
			'protocol': BRS_PROTOCOL,
			'requestType': requestType,
		},
		time: true,
	});
};
