#! /usr/bin/env node

const fetch = require('cross-fetch');
const Promise = require('bluebird');
const fs = require('mz/fs');
const atmpt = require('atmpt');
const c = require('template-colors');
const prettyBytes = require('pretty-bytes');
const extend = require('deep-extend');
const prettyMs = require('pretty-ms');
const bitrate = require('bitrate');

const argv = require('yargs')
	.describe('config', 'conforms to fetch protocol')
	.describe('url', 'url of the request')
	.describe('concurrency', 'max concurrency')
	.describe('chunk', 'size of the request chunks')
	.describe('silent', 'hide progress output')
	.describe('agent', 'user agent')
	.default('config', '{}')
	.default('silent', false)
	.default('chunk', 1000 * 1000 * 5)
	.default('concurrency', 10)
	.default('agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3631.0 Safari/537.36')
	.demandOption([
		'url'
	])
	.argv;

const userAgent = argv.agent;
let started = Promise.pending();
let downloadedRanges = [];
let lastPart = 0;
let stdInRangePart = 0;
let stdInConcurrency = 0;
let stdOutRangePart = 0;
let downloadedBytes = 0;
let stdOutWriteLog = [];
let blocking = false;
let completed = Promise.pending();

argv.config = JSON.parse(argv.config);

function stdOutWrite (buffer) {
	let promise = new Promise((resolve, reject) => {
		process.stdout.write(buffer, () => {
			//process.exit();
			resolve();
		});
	});

	stdOutWriteLog.push(promise);

	return promise;
}

function getActiveWriteCount () {
	return stdOutWriteLog.filter(promise => !promise.isResolved()).length;
}

function log (message) {
	if (!argv.silent) {
		console.error(String(message));
	}
}

async function getRequestInformation () {
	return await atmpt(async attempt => {
		let response = await fetch(argv.url, extend({}, argv.config, {
			method: 'HEAD',
			headers: {
				'user-agent': userAgent
			}
		}));

		let bytes = parseInt(response.headers.get('content-length'), 10),
			ranges = response.headers.get('accept-ranges');

		return {
			bytes,
			ranges
		};
	}, {maxAttempts: 10, delay: attempt => attempt * 1000});
}

function downloadRange ({part, index, size}) {
	return new Promise (async (resolve, reject) => {
		await atmpt(async attempt => {
			let response = await fetch(argv.url, extend({}, argv.config, {
				headers: {
					'user-agent': userAgent,
					Range: `bytes=${index}-${index + size - 1}`
				}
			}));

			let buffer = await response.buffer();

			downloadedRanges.push({
				part,
				buffer,
				bytes: buffer.length
			});
		}, {maxAttempts: 10, delay: attempt => attempt * 1000});

		resolve();
	});
}

(async () => {
	await started.promise;

	if (!argv.silent) {
		process.stderr.write('\n\n\n\n\n');
	}

	while (stdOutRangePart <= lastPart) {
		let range = downloadedRanges.find(range => range.part === stdOutRangePart);

		if (range) {
			stdOutWrite(range.buffer);
			downloadedBytes += range.buffer.length;
			delete range.buffer;
			downloadedRanges = downloadedRanges.filter(range => range.buffer);
			stdOutRangePart++;
		}

		if (!argv.silent) {
			process.stderr.clearLine();
			process.stderr.moveCursor(0, -4);
			process.stderr.clearLine();
			process.stderr.cursorTo(0);
			process.stderr.write(c`${String(stdInConcurrency)}.bold.white connections, ${prettyBytes(downloadedBytes || 0)}.bold.white downloaded`.grey.toString() + '\n');
			process.stderr.clearLine();
			process.stderr.write(c`current chunk spread ${String(stdInRangePart - stdOutRangePart)}.bold.white`.grey.toString() + '\n');
			process.stderr.clearLine();
			process.stderr.write(c`stdout backpressure ${String(getActiveWriteCount())}.bold.white`.grey.toString() + '\n');
			process.stderr.clearLine();
			process.stderr.write(c`request status ${blocking ? 'blocking'.red : 'accepting'.green}`.grey.toString() + '\n');
		}

		if (stdOutRangePart <= lastPart) {
			await Promise.delay(20);
		} else {
			completed.resolve();
		}
	}
})().catch(log);

(async () => {
	let info = await getRequestInformation();

	let chunkSize = argv.chunk;

	if (chunkSize === 5000000) {
		chunkSize = info.bytes / argv.concurrency > chunkSize ? chunkSize : Math.ceil(info.bytes / argv.concurrency);

		if (chunkSize < 5000000) {
			chunkSize = 5000000;
		}
	} else {
		if (chunkSize < 5000000) {
			chunkSize = 5000000;
		}

		if (chunkSize > 50000000) {
			chunkSize = 50000000;
		}
	}

	let ranges = [];
	let parts = 0;
	for (let i = 0; i <= info.bytes && info.bytes - i;) {
		let size = info.bytes - i >= chunkSize ? chunkSize : info.bytes - i;

		ranges.push({
			part: parts,
			index: i,
			size: size
		});

		i += size;
		parts++;
	}

	log(c`fat pipe download started`.green.bold);
	log(c`- chunks = ${ranges.length}.white.bold`.grey);
	log(c`- chunk = ${prettyBytes(chunkSize)}.white.bold`.grey);
	log(c`- size = ${prettyBytes(info.bytes)}.white.bold`.grey);

	started.resolve();

	lastPart = ranges.length - 1;

	let startTime = new Date();
	let concurrent = [];

	while (ranges.length) {
		concurrent = concurrent.filter(promise => !promise.isResolved());
		stdInConcurrency = concurrent.length;
		if (
			concurrent.length < argv.concurrency &&
			stdInRangePart - stdOutRangePart < argv.concurrency * 1.5 &&
			getActiveWriteCount() < argv.concurrency * 10
		) {
			stdInRangePart++;
			concurrent.push(downloadRange(ranges.shift()));
			blocking = false;
		} else {
			blocking = true;
			await Promise.delay(20);
		}
	}

	await completed.promise;

	let duration = new Date() - startTime;
	log(c`\ndownload completed in ${prettyMs(duration)}.bold.white, at ${bitrate(info.bytes, duration/1000, 'mbps').toFixed(2)}.bold.white mb/s`.green.bold);
})().catch(log);