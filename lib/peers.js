'use strict';

const utils = require('./utils');

const BLOCK_REASONS = {
	NOT_BLOCKED: 0,
	ILLEGAL_ADDRESS: 1,
};

const SCAN_RESULT = {
	SUCCESS: 0,
	UNKNOWN: 1,
	TIMEOUT: 2,
	REFUSED: 3,
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
		for (let raw of peers) {
			const peer = utils.normalizePeer(raw);
			const [res] = await this.db.execute(''
				+'UPDATE peers '
				+'SET last_seen = NOW() '
				+'WHERE address = ? ',
				[peer]);
			if (res.affectedRows === 0) {
				// ignore insert errors when two workers detect the
				// same node at the same time through different peers.
				await this.db.execute(''
					+'INSERT IGNORE INTO peers '
					+'(address) VALUES (?)',
					[peer]);
			}
		}
	}

	async logPeer(peer, peerInfo, peerDifficulty, rtt, peersCount) {
		const [res] = await this.db.execute(''
			+'SELECT id '
			+'FROM peers '
			+'WHERE address = ?',
			[peer]);
		if (res.length > 0) {
			const id = res[0].id;
			await this.db.execute(''
				+'INSERT INTO scans '
				+'(peer_id, result, rtt, version, platform, peers_count, block_height) '
				+'VALUES '
				+'(?, ?, ?, ?, ?, ?, ?)',
				[
					id,
					SCAN_RESULT.SUCCESS,
					rtt,
					peerInfo.version,
					peerInfo.platform,
					peersCount,
					peerDifficulty.blockchainHeight,
				]
			);
		}
	}

	async failPeer(peer, scanResult) {
		await this.db.execute(''
			+'INSERT INTO scans '
			+'(peer_id, result) '
			+'SELECT id, ? '
			+'FROM peers '
			+'WHERE address = ?',
			[
				scanResult,
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

		let timeInfo, resInfo, resPeers, resDifficulty;
		try {
			[
				[resInfo,timeInfo],
				[resPeers],
				[resDifficulty]
			] = await Promise.all([
				utils.callBRS(peerUrl, userAgent, timeout, utils.BRS_REQUESTS.INFO),
				utils.callBRS(peerUrl, userAgent, timeout, utils.BRS_REQUESTS.PEERS),
				utils.callBRS(peerUrl, userAgent, timeout, utils.BRS_REQUESTS.DIFFICULTY),
			]);
		} catch (err) {
			if (err.cause) {
				switch (err.cause.code) {
				case 'ETIMEDOUT':
				case 'ESOCKETTIMEDOUT':
				case 'ENETUNREACH':
				case 'EHOSTUNREACH':
					console.log('#timeout '+peer+' (connected='+(err.connect === true)+','+err.cause.code+')');
					await this.failPeer(peer, SCAN_RESULT.TIMEOUT);
					return;
				case 'ECONNREFUSED':
					console.log('#refused '+peer);
					await this.failPeer(peer, SCAN_RESULT.REFUSED);
					return;
				case 'EINVAL':
				case 'ENOTFOUND':
					console.log('#illegaladdress '+peer);
					await this.blockPeer(peer, BLOCK_REASONS.ILLEGAL_ADDRESS);
					return;
				}
			} else if (err.statusCode === 302) {
				console.log('#redirectingwallet '+peer);
				await this.blockPeer(peer, BLOCK_REASONS.ILLEGAL_ADDRESS);
				return;
			}
			console.log(err);
			await this.failPeer(peer, SCAN_RESULT.UNKNOWN);
			return;
		}

		await Promise.all([
			this.logPeer(peer, resInfo, resDifficulty, timeInfo, resPeers.peers.length),
			this.addPeers(resPeers.peers)
		]);
	}
}

module.exports = Peers;
