'use strict';

const dns = require('dns');

const utils = require('./utils');
const def = require('./../config/defaults.js');
def.crawler.useUtilsCrawler =
	process.env.USE_UTILS_CRAWLER || def.crawler.useUtilsCrawler;

const BLOCK_REASONS = {
	NOT_BLOCKED: 0,
	ILLEGAL_ADDRESS: 1,
	OLD_IP: 2,
	UNREACHABLE: 10
};

const SCAN_RESULT = {
	SUCCESS: 0,
	UNKNOWN: 1,
	TIMEOUT: 2,
	REFUSED: 3,
	REDIRECT: 4,
	EMPTY_RESPONSE: 5,
	INVALID_RESPONSE: 6
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
			const [res] = await dbc.execute(
				'' +
					'SELECT id, address ' +
					'FROM peers ' +
					// only scan unblocked peers
					'WHERE blocked = ? ' +
					// only scan peers who either have never been scanned or have not been scanned for X minutes
					'AND (last_scanned IS NULL OR TIMESTAMPDIFF(MINUTE, last_scanned, NOW()) > ?) ' +
					// only scan peers who have been seen by other peers in the last 24 hours,
					// this avoids rescanning constantly changing residential IPs
					'AND TIMESTAMPDIFF(HOUR, last_seen, NOW()) < 24 ' +
					// always scan unscanned peers first, then scan peers oldest first
					'ORDER BY last_scanned IS NULL DESC, COALESCE(last_scanned,last_seen) ASC ' +
					// only lock one peer at a time
					'LIMIT 1 FOR UPDATE',
				[BLOCK_REASONS.NOT_BLOCKED, rescanInterval]
			);
			if (res.length > 0) {
				peer = { id: res[0].id, address: res[0].address };
				await dbc.execute(
					'' + 'UPDATE peers ' + 'SET last_scanned = NOW() ' + 'WHERE id = ?',
					[peer.id]
				);
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
		// eslint-disable-next-line
		for (let raw of peers) {
			const address = utils.normalizePeer(raw);
			const [res] = await this.db.execute(
				'' + 'UPDATE peers ' + 'SET last_seen = NOW() ' + 'WHERE address = ? ',
				[address]
			);
			if (res.affectedRows === 0) {
				// ignore insert errors when two workers detect the
				// same node at the same time through different peers.
				await this.db.execute(
					'' + 'INSERT IGNORE INTO peers ' + '(address) VALUES (?)',
					[address]
				);
			}
		}
	}

	async logPeer(peer, peerInfo, peerDifficulty, rtt, peersCount) {
		const putKeyValue = async (table, column, data) => {
			if (data) {
				const [ins] = await this.db.execute(
					'' +
						'INSERT INTO ' +
						table +
						' (' +
						column +
						') ' +
						'SELECT ? FROM seq_0_to_0 ' +
						'WHERE NOT EXISTS (SELECT 1 FROM ' +
						table +
						' x WHERE x.' +
						column +
						' = ?)',
					[data, data]
				);
				if (ins.insertId) {
					return ins.insertId;
				} else {
					const [res] = await this.db.execute(
						'SELECT id FROM ' + table + ' WHERE ' + column + ' = ?',
						[data]
					);
					if (res.length > 0) {
						return res[0].id;
					}
				}
			}
			return null;
		};
		const versionId = await putKeyValue(
			'scan_versions',
			'version',
			peerInfo.version
		);
		const platformId = await putKeyValue(
			'scan_platforms',
			'platform',
			peerInfo.platform
		);

		await this.db.execute(
			'' +
				'INSERT INTO scans ' +
				'(peer_id, result, rtt, version_id, platform_id, peers_count, block_height) ' +
				'VALUES ' +
				'(?, ?, ?, ?, ?, ?, ?)',
			[
				peer.id,
				SCAN_RESULT.SUCCESS,
				rtt,
				versionId,
				platformId,
				peersCount,
				peerDifficulty.blockchainHeight
			]
		);
		if (def.crawler.useUtilsCrawler) {
			const add = utils.withoutPort(peer.address);
			const isIP = require('net').isIP(add);
			switch (isIP) {
				case 0:
					// Test if 'old' becomes a single ip or an array
					const old = await this.db.execute(
						'' + 'SELECT ip FROM checks ' + 'WHERE peer_id = ? AND blocked = ?',
						[peer.id, BLOCK_REASONS.UNREACHABLE]
					);
					dns.resolve(add, async (err, addrs) => {
						if (err) {
							// handle it
							console.log(err);
						}
						console.log(addrs);
						await this.updateIP(addrs[0], BLOCK_REASONS.NOT_BLOCKED, peer.id);
					});
					await this.updateIP(old, BLOCK_REASONS.OLD_IP);
					break;
				case 4:
				case 6:
					await this.updateIP(add, BLOCK_REASONS.NOT_BLOCKED);
			}
		}
	}

	async failPeer(peer, scanResult) {
		await this.db.execute(
			'' + 'INSERT INTO scans ' + '(peer_id, result) ' + 'VALUES ' + '(?, ?)',
			[peer.id, scanResult]
		);
		if (def.crawler.useUtilsCrawler) {
			let add = utils.withoutPort(peer.address);
			const isIP = require('net').isIP(add);
			switch (isIP) {
				case 0:
					// Test if 'add' becomes a single ip
					add = await this.db.execute(
						'' + 'SELECT ip FROM checks ' + 'WHERE peer_id = ? AND blocked = ?',
						[peer.id, BLOCK_REASONS.UNREACHABLE]
					);
					await this.updateIP(add, BLOCK_REASONS.OLD_IP);
					break;
				case 4:
				case 6:
					await this.updateIP(add, BLOCK_REASONS.UNREACHABLE);
			}
		}
	}

	async blockPeer(peer, reason) {
		await this.db.execute(
			'' + 'UPDATE peers ' + 'SET blocked = ? ' + 'WHERE id = ?',
			[reason, peer.id]
		);
		if (def.crawler.useUtilsCrawler) {
			let add = utils.withoutPort(peer.address);
			const isIP = require('net').isIP(add);
			switch (isIP) {
				case 0:
					// Test if 'add' becomes a single ip
					add = await this.db.execute(
						'' + 'SELECT ip FROM checks ' + 'WHERE peer_id = ? AND blocked = ?',
						[peer.id, BLOCK_REASONS.UNREACHABLE]
					);
					await this.updateIP(add, BLOCK_REASONS.OLD_IP);
					break;
				case 4:
				case 6:
					await this.updateIP(add, reason);
			}
		}
	}

	async updateIP(ip, reason, peerId) {
		const [res] = await this.db.execute(
			'' +
				'UPDATE checks ' +
				'SET blocked = ?, ' +
				'last_scanned = NOW() ' +
				'WHERE ip = ?',
			[reason, ip]
		);
		if (res.affectedRows === 0) {
			// ignore insert new IP
			const hash = require('crypto')
				.createHash('md5')
				.update(peerId + ',' + ip)
				.digest('hex');
			await this.db.execute(
				'' +
					'INSERT IGNORE INTO checks ' +
					'(hash, peer_id, ip, blocked, last_scanned) VALUES (?, ?, ?, ?, NOW())',
				[hash, peerId, ip, reason]
			);
		}
		console.log(`#Updated status (${reason}) of IP ${ip}`);
		return null;
	}

	async scanPeer(peer, userAgent, timeout) {
		const peerUrl = 'http://' + utils.normalizePeer(peer.address);
		console.log(`#calling ${peerUrl}`);

		let timeInfo, resInfo, resPeers, resDifficulty;
		try {
			[[resInfo, timeInfo], [resPeers], [resDifficulty]] = await Promise.all([
				utils.callBRS(peerUrl, userAgent, timeout, utils.BRS_REQUESTS.INFO),
				utils.callBRS(peerUrl, userAgent, timeout, utils.BRS_REQUESTS.PEERS),
				utils.callBRS(
					peerUrl,
					userAgent,
					timeout,
					utils.BRS_REQUESTS.DIFFICULTY
				)
			]);
		} catch (err) {
			if (err.cause) {
				switch (err.cause.code) {
					case 'ETIMEDOUT':
					case 'ESOCKETTIMEDOUT':
					case 'ENETUNREACH':
					case 'EHOSTUNREACH':
						console.log(
							`#timeout ${peer.address} (connected=${err.connect},${
								err.cause.code
							})`
						);
						await this.failPeer(peer, SCAN_RESULT.TIMEOUT);
						return;
					case 'ECONNREFUSED':
						console.log(`#refused ${peer.address}`);
						await this.failPeer(peer, SCAN_RESULT.REFUSED);
						return;
					case 'EINVAL':
					case 'ENOTFOUND':
					case 'EAI_AGAIN':
					case 'EADDRNOTAVAIL':
						console.log(`#illegaladdress ${peer.address}`);
						await this.blockPeer(peer, BLOCK_REASONS.ILLEGAL_ADDRESS);
						return;
				}
			} else if (err.statusCode === 302) {
				console.log(`#redirectingwallet ${peer.address}`);
				await this.failPeer(peer, SCAN_RESULT.REDIRECT);
				return;
			} else if (err.statusCode >= 400) {
				console.log(`#invalid(${err.statusCode}) ${peer.address}`);
				await this.failPeer(peer, SCAN_RESULT.INVALID_RESPONSE);
				return;
			} else {
				switch (err.code) {
					case 'ERR_BRS_EMPTY_RESPONSE':
						console.log(`#empty ${peer.address}`);
						await this.failPeer(peer, SCAN_RESULT.EMPTY_RESPONSE);
						return;
					case 'ERR_BRS_INVALID_RESPONSE':
						console.log(`#invalid ${peer.address}`);
						await this.failPeer(peer, SCAN_RESULT.INVALID_RESPONSE);
						return;
				}
			}
			console.log(err);
			await this.failPeer(peer, SCAN_RESULT.UNKNOWN);
			return;
		}

		await Promise.all([
			this.logPeer(
				peer,
				resInfo,
				resDifficulty,
				timeInfo,
				resPeers.peers.length
			),
			this.addPeers(resPeers.peers)
		]);
	}
}

module.exports = Peers;
