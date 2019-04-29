# BRS Crawler
Burst Reference Software Network Crawler, detects network nodes by crawling from peer to peer. This project is forked from [chrulri brs-crawler repo](https://github.com/chrulri/brs-crawler).

## Requirements
- Storage: MariaDB (tested with 10.1)
- Runtime: NodeJS (tested with 11.6)

[![Build Status](https://travis-ci.com/gpedro34/brs-crawler.svg?branch=develop)](https://travis-ci.com/gpedro34/brs-crawler)

## Run
```shell
$ npm install
$ mysql <init.sql
$ node app.js
```

#### Change number of workers used
```shell
$ WORKERS=5 node app.js
```
*(Default: 11)*

## Contribute
See [TODO.md](TODO.md) for open tasks.
