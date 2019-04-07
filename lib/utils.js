'use strict';

const fs = require('fs');
const request = require('request-promise-native');
const jsonschema = require('jsonschema');

const BRS_DEFAULT_PEER_PORT = 8123;
const BRS_PROTOCOL = 'B1';

exports.BRS_REQUESTS = {
	INFO: 'getInfo',
	PEERS: 'getPeers',
	DIFFICULTY: 'getCumulativeDifficulty',
};

const BRS_RESPONSE_JSON_SCHEMAS = {
	getInfo: {
		"type": "object",
		"properties": {
			"application": {"type":"string"},
			"version": {"type":"string"},
			"platform": {"type":"string"},
			"shareAddress": {"type":"boolean"},
			"announcedAddress": {"type":"string"},
		},
		"required": [
			"application",
			"version",
			"platform",
		]
	},
	getPeers: {
		"type": "object",
		"properties": {
			"peers": {
				"type": "array",
				"items": {"type":"string"}
			}
		},
		"required": [
			"peers",
		]
	},
	getCumulativeDifficulty: {
		"type": "object",
		"properties": {
			"blockchainHeight": {"type":"integer"},
			"cumulativeDifficulty": {"type":"string"},
		},
		"required": [
			"blockchainHeight",
			"cumulativeDifficulty",
		]
	},
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
	const res = await request({
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
		resolveWithFullResponse: true,
	});

	if (res && res.body) {
		const validationResult = jsonschema.validate(res.body, BRS_RESPONSE_JSON_SCHEMAS[requestType]);
		if (!validationResult.valid) {
			throw Object.assign(new Error, {code: 'ERR_BRS_INVALID_RESPONSE'});
		}
		return [res.body, res.timingPhases.total];
	}
	throw Object.assign(new Error, {code: 'ERR_BRS_EMPTY_RESPONSE'});
};

// removes port from a given domain or IP
exports.withoutPort = (ip) => {
  if(ip.indexOf('[') >= 0){
    return ip.slice(0, ip.indexOf(':', ip.indexOf(']')));
  } else if(ip.indexOf('http')>= 0){
    return ip.slice(0, ip.indexOf(':', ip.indexOf('/')));
  } else {
    return ip.slice(0, ip.indexOf(':'));
  }
}
