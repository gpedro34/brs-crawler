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
	//
	//
	// CODE related purely to brs-crawler
	// Check DB for available jobs (L1)
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
					// only scan peers who have been seen by other peers in the last 24 hours,
					// this avoids rescanning constantly changing residential IPs
					'AND TIMESTAMPDIFF(HOUR, last_seen, NOW()) < 24 ' +
					// only scan peers who either have never been scanned or have not been scanned for X minutes
					'AND (last_scanned IS NULL OR TIMESTAMPDIFF(MINUTE, last_scanned, NOW()) > ?) ' +
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
	//
	// Scans a Peer (L2)
	async scanPeer(peer, userAgent, timeout) {
		const peerUrl = 'http://' + utils.normalizePeer(peer.address);
		console.log(`#calling ${peerUrl}`);

		let timeInfo, resInfo, resPeers, resDifficulty;
		try {
			[[resInfo, timeInfo], [resPeers], [resDifficulty]] = await Promise.all([
				utils.callBRS(peerUrl, userAgent, timeout, utils.BRS_REQUESTS.INFO),
				utils.callBRS(peerUrl, userAgent, timeout, utils.BRS_REQUESTS.PEERS),
				utils.callBRS(peerUrl,userAgent,timeout,utils.BRS_REQUESTS.DIFFICULTY)
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
	//
	// Create a new peer (L2.5)
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
	//
	// Change blocked state of a peer (L2.5)
	async blockPeer(peer, reason) {
		await this.db.execute(
			'' + 'UPDATE peers ' + 'SET blocked = ? ' + 'WHERE id = ?',
			[reason, peer.id]
		);
		if (def.crawler.useUtilsCrawler) {
			await this.assertIPState(peer, 'failure');
		}
	}
	//
	// Inserts success scans and new adds versions and platforms (L3)
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
			await this.assertIPState(peer, 'success');
		}
	}
	//
	// Inserts failed scans (L3)
	async failPeer(peer, scanResult) {
		await this.db.execute(
			'' + 'INSERT INTO scans ' + '(peer_id, result) ' + 'VALUES ' + '(?, ?)',
			[peer.id, scanResult]
		);
		if (def.crawler.useUtilsCrawler) {
			await this.assertIPState(peer, 'failure');
		}
	}
	//
	//
	// CODE related to utils-crawler plugin integration to enable dynamic IP tracking
	// Check if peer is IP or domain, resolve domains and re-route accordingly (L1)
	async assertIPState(peer, result) {
		// Switch configurations
		const success = {
			BLOCK: BLOCK_REASONS.NOT_BLOCKED,
			OLD: BLOCK_REASONS.OLD_IP,
			MESSAGE: 'Unbocked'
		};
		const failure = {
			BLOCK: BLOCK_REASONS.UNREACHABLE,
			OLD: BLOCK_REASONS.OLD_IP,
			MESSAGE: 'Blocked'
		};

		// Assign switched object
		let REASONS; // eslint-disable-line
		switch (result) {
			case 'success':
				REASONS = success;
				break;
			case 'failure':
				REASONS = failure;
				break;
		}

		// Check if address is an IP or not
		const add = utils.withoutPort(peer.address);
		const isIP = require('net').isIP(add);
		switch (isIP) {
			case 0:
				// Resolve domain
				dns.resolve(add, async (err, addrs) => {
					if (err || !addrs[0]) {
						// Couldn't resolve domain
						await this.checkOldIPs(peer, BLOCK_REASONS.ILLEGAL_ADDRESS, add);
						// eslint-disable-next-line
						console.log('ID: ' + peer.id + " - Couldn't resolve address (" +
							add + '). Keeping it as an unreachable peer!');
					} else {
						// Checks if IP-Peer combination exists in DB
						await this.checkIP(peer, addrs[0], REASONS);
					}
				});
				break;
			case 4:
			case 6:
				// Block/Unblock IP
				await this.blockIPSwitch(add, REASONS, peer);
				break;
		}
	}
	//
	// Checks if IP-Peer combination exists in DB and re-route accordingly (L2)
	async checkIP(peer, add, REASONS) {
		const [exist] = await this.db.execute(
			'SELECT ip FROM checks ' + 'WHERE peer_id = ? AND ip = ?',
			[peer.id, add]
		);
		if (exist[0]) {
			// Block/Unblock IP
			await this.blockIPSwitch(exist[0].ip, REASONS, peer);
		} else {
			// Mark previous IPs as old ones
			await this.checkOldIPs(peer, REASONS.OLD, add);
			// Insert new IP
			await this.updateIP(add, REASONS.BLOCK, peer, REASONS);
		}
	}
	//
	// Block/Unblock IP  (L2)
	async blockIPSwitch(add, REASONS, peer) {
		await this.updateIP(add, REASONS.BLOCK, peer, REASONS);
	}
	//
	// Mark all other IPs of the same peer as old ones (L3)
	async checkOldIPs(peer, reason, add) {
		// Mark other known IPs as old IPs
		const [old] = await this.db.execute(
			'SELECT ip FROM checks ' + 'WHERE peer_id = ? AND blocked = ?',
			[peer.id, BLOCK_REASONS.UNREACHABLE]
		);
		if (old[0]) {
			old.forEach(async el => {
				if(el !== add){
					await this.updateIP(el, REASONS.OLD, peer, REASONS);
				}
			});
			// eslint-disable-next-line
			console.log('ID: ' + peer.id + ' - Got a new IP (' +
				add + '). Changed previous IPs block state: ', old);
		}
	}
	//
	// Insert/Update the new IP into checks table (L3)
	async updateIP(ip, reason, peer, REASONS) {
		const hash = require('crypto')
			.createHash('md5')
			.update(peer.id + ',' + ip)
			.digest('hex');
		// eslint-disable-next-line
		const [res] = await this.db.execute(
			 'INSERT INTO checks (hash, peer_id, blocked, ip, last_scanned) '
			+'VALUES (?, ?, ?, ?, NOW()) '
			+'ON DUPLICATE KEY UPDATE blocked = ?',
			[hash, peer.id, reason, ip, reason]
		);
		// eslint-disable-next-line
		console.log('ID: ' + peer.id + ' - New IP added (' + [reason] + '): ' + ip);
		return null;
	}

}

module.exports = Peers;
