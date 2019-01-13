# BRS Crawler
Burst Reference Software Network Crawler, detects network nodes by crawling from peer to peer.

## Requirements
- Storage: MariaDB (tested with 10.1)
- Runtime: NodeJS (tested with 11.6)

## Run
```shell
$ npm install
$ node app.js
```

#### Change number of threads per CPU used
```shell
$ THREADS_PER_CPU=5 node app.js
```
*(Default: 10)*

## Contribute
See [TODO.md](TODO.md) for open tasks.
