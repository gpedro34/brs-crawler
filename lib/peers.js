'use strict';

const utils = require('./utils');

const BLOCK_REASONS = {
	NOT_BLOCKED: 0,
	ILLEGAL_ADDRESS: 1,
};

class Peers {
	constructor(db) {
		this.db = db;
	}

	async scan(userAgent, timeout, rescanInterval) {
		const dbc = await this.db.getConnection();
		let peer = null;
		try {
			await dbc.beginTransaction();
			const [res] = await dbc.execute(''
				+'SELECT address '
				+'FROM peers '
				+'WHERE blocked = ? '
				+'AND (last_scanned IS NULL OR TIMESTAMPDIFF(MINUTE, last_scanned, NOW()) > ?) '
				+'ORDER BY last_scanned IS NULL DESC, COALESCE(last_scanned,last_seen) ASC '
				+'LIMIT 1 FOR UPDATE',
				[BLOCK_REASONS.NOT_BLOCKED, rescanInterval]);
			if (res.length > 0) {
				peer = res[0].address;
				await dbc.execute(''
					+'UPDATE peers '
					+'SET last_scanned = NOW() '
					+'WHERE address = ?',
					[peer]);
			}
			await dbc.commit();
		} finally {
			dbc.release();
		}
		if (peer) {
			this.scanPeer(peer, userAgent, timeout);
		}
	}

	async addPeers(peers) {
		const tasks = [];
		for (let raw of peers) {
			const peer = utils.normalizePeer(raw);
			tasks.push(this.db.execute(''
				+'INSERT INTO peers '
				+'(address) VALUES (?) '
				+'ON DUPLICATE KEY UPDATE last_seen=CURRENT_TIMESTAMP()',
				[peer]));
		}
		await Promise.all(tasks);
	}

	async updatePeer(peer, peerInfo, rtt, peersCount) {
		this.db.execute(''
			+'UPDATE peers '
			+'SET last_reached = NOW(), '
			+'    version = ?, '
			+'    platform = ?, '
			+'    last_rtt = ?, '
			+'    last_peers_count = ? '
			+'WHERE address = ?',
			[
				peerInfo.version,
				peerInfo.platform,
				rtt,
				peersCount,
				peer,
			]
		);
	}

	async blockPeer(peer, reason) {
		await this.db.execute(''
			+'UPDATE peers '
			+'SET blocked = ? '
			+'WHERE address = ?',
			[reason, peer]);
	}

	async scanPeer(peer, userAgent, timeout) {
		const peerUrl = 'http://'+utils.normalizePeer(peer);
		console.log('#calling ' + peerUrl);

		let resInfo, resPeers;
		try {
			[resInfo,resPeers] = await Promise.all([
				utils.callBRS(peerUrl, userAgent, timeout, utils.BRS_REQUESTS.INFO),
				utils.callBRS(peerUrl, userAgent, timeout, utils.BRS_REQUESTS.PEERS),
			]);
		} catch (err) {
			if (err.cause) {
				switch (err.cause.code) {
				case 'ETIMEDOUT':
				case 'ESOCKETTIMEDOUT':
				case 'ENETUNREACH':
				case 'EHOSTUNREACH':
					console.log('#timeout '+peer+' (connected='+(err.connect === true)+','+err.cause.code+')');
					return;
				case 'ECONNREFUSED':
					console.log('#refused '+peer);
					return;
				case 'ENOTFOUND':
					console.log('#illegaladdress '+peer);
					this.blockPeer(peer, BLOCK_REASONS.ILLEGAL_ADDRESS);
					return;
				}
			} else if (err.statusCode === 302) {
				console.log('#redirectingwallet '+peer);
				this.blockPeer(peer, BLOCK_REASONS.ILLEGAL_ADDRESS);
				return;
			}
			console.log(err);
			return;
		}

		// TODO validate resInfo / resPeers JSON

		// TODO implement rtt
		let rtt = 0;

		await Promise.all([
			this.updatePeer(peer, resInfo, rtt, resPeers.peers.length),
			this.addPeers(resPeers.peers)
		]);
	}
}

module.exports = Peers;
