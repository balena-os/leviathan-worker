import * as bodyParser from 'body-parser';
import { ChildProcess, exec } from 'child_process';
import { multiWrite } from 'etcher-sdk';
import * as express from 'express';
import * as http from 'http';
import { getSdk } from 'balena-sdk';
import { resolveLocalTarget } from './helpers';
import { TestBotWorker } from './workers/testbot';
import QemuWorker from './workers/qemu';
import { AutokitWorker } from './workers/autokit';
import { Contract } from '../typings/worker';

import { Stream } from 'stream';
import { join } from 'path';
import * as tar from 'tar-fs';
import * as util from 'util';
const pipeline = util.promisify(Stream.pipeline);
const execSync = util.promisify(exec);
import { readFile, createReadStream, createWriteStream, watch, stat as Fstat, unlink as Unlink } from 'fs-extra';
const unlink = util.promisify(Unlink);
const stat = util.promisify(Fstat);

import { createGzip, createGunzip } from 'zlib';
import * as lockfile from 'proper-lockfile';
import * as serialTerminal from '@balena/node-serial-terminal';

const balena = getSdk({
	apiUrl: process.env.BALENA_API_URL || 'https://api.balena-cloud.com/',
});

const workersDict: Dictionary<typeof TestBotWorker | typeof QemuWorker | typeof AutokitWorker> = {
	testbot_hat: TestBotWorker,
	qemu: QemuWorker,
	autokit: AutokitWorker
};

const balenaLockPath = process.env.BALENA_APP_LOCK_PATH?.replace('.lock', '');

const handleCompromised = (err: Error) => {
	console.warn(`lock compromised: ${err}`);
};

async function lock(lockPath: string) {
	const options = { realpath: false, onCompromised: handleCompromised };
	await lockfile.check(lockPath, options)
		.then(async (isLocked) => {
			if (!isLocked) {
				await lockfile
					.lock(lockPath, options)
					.catch((err) => console.error(err))
					.then(() => console.log('updates locked...'));
			}
		})
		.catch((err) => console.error(err));
}

async function unlock(lockPath: string) {
	const options = { realpath: false, onCompromised: handleCompromised };
	await lockfile.check(lockPath, options)
		.then(async (isLocked) => {
			if (isLocked) {
				await lockfile
					.unlock(lockPath, options)
					.catch((err) => console.error(err))
					.then(() => console.log('updates unlocked...'));
			}
		})
		.catch((err) => console.error(err));
}

let state = 'IDLE';
let flashState = 'IDLE';
let heartbeatTimeout: NodeJS.Timeout;
const tunnels: ChildProcess[] = [];

async function setup(
	runtimeConfiguration: Leviathan.RuntimeConfiguration,
): Promise<express.Application> {
	const possibleWorkers = Object.keys(workersDict);
	if (!possibleWorkers.includes(runtimeConfiguration.worker.deviceType)) {
		throw new Error(
			`${runtimeConfiguration.worker.deviceType} is not a supported worker`,
		);
	}

	const worker: Leviathan.Worker = new workersDict[
		runtimeConfiguration.worker.deviceType
	](runtimeConfiguration);

	/**
	 * Server context
	 */
	const jsonParser = bodyParser.json();
	const app = express();
	const httpServer = http.createServer(app);
	httpServer.headersTimeout = 0;
	httpServer.timeout = 0
	httpServer.keepAliveTimeout = 0; 

	const proxy: { proc?: ChildProcess; kill: () => void } = {
		kill: () => {
			if (proxy.proc != null) {
				proxy.proc.kill();
			}
		},
	};

	const supportedTags = [`dut`, `screencapture`, `modem`];
	// parse labels and create 'contract'
	const contract: Contract = {
		uuid: process.env.BALENA_DEVICE_UUID,
		workerType: runtimeConfiguration.worker.deviceType,
		supportedFeatures: {},
	};

	if (
		typeof process.env.BALENA_API_KEY === 'string' &&
		typeof process.env.BALENA_DEVICE_UUID === 'string'
	) {
		await balena.auth.loginWithToken(process.env.BALENA_API_KEY);
		const tags = await balena.models.device.tags.getAllByDevice(
			process.env.BALENA_DEVICE_UUID,
		);
		for (const tag of tags) {
			if (supportedTags.includes(tag.tag_key)) {
				contract.supportedFeatures[tag.tag_key] =
					tag.value === 'true' ? true : tag.value;
			}
		}
	} else {
		console.log(`API key not available...`);
	}

	if (balenaLockPath != null) {
		await unlock(balenaLockPath);
	}

	await worker.setup();

	/**
	 * Setup DeviceUnderTest routes
	 */
	app.post(
		'/dut/on',
		async (
			_req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			const timer = setInterval(() => {
				res.write('status: pending');
			}, 5000);

			try {
				await worker.powerOn();
			} catch (err) {
				next(err);
			} finally {
				clearInterval(timer);
				res.write('OK');
				res.end();
			}
		},
	);
	app.get(
		'/dut/diagnostics',
		async (
			_req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			try {
				res.send(await worker.diagnostics());
			} catch (err) {
				next(err);
			}
		},
	);
	app.post(
		'/dut/off',
		async (
			_req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			try {
				await worker.powerOff();
				res.send('OK');
			} catch (err) {
				next(err);
			}
		},
	);
	app.post(
		'/dut/network',
		jsonParser,
		async (
			req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			try {
				await worker.network(req.body);
				res.send('OK');
			} catch (err) {
				console.error(err);
				next(err);
			}
		},
	);
	app.get(
		'/dut/ip',
		jsonParser,
		async (
			req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			try {
				if (req.body.target != null) {
					res.send(await resolveLocalTarget(req.body.target));
				} else {
					throw new Error('Target missing');
				}
			} catch (err) {
				next(err);
			}
		},
	);
	app.get(
		'/contract',
		jsonParser,
		async (
			req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			try {
				res.send(JSON.stringify(contract));
			} catch (err) {
				next(err);
			}
		},
	);
	app.post(
		'/dut/capture',
		async (
			_req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			try {
				await worker.captureScreen('start');
				res.send('OK');
			} catch (err) {
				next(err);
			}
		},
	);
	app.get(
		'/dut/capture',
		async (
			_req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			try {
				await worker.captureScreen('stop');
				/// send the captured images to the core, instead of relying on volume
				const CAPTURE_PATH = join(
					runtimeConfiguration.worker.workdir,
					'capture',
				);
				const line = pipeline(
					tar.pack(CAPTURE_PATH),
					createGzip({ level: 6 }),
					res,
				).catch((error) => {
					throw error;
				});
				await line;
				res.send('OK');
			} catch (err) {
				next(err);
			}
		},
	);

	app.post(
		'/proxy',
		jsonParser,
		async (
			req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			// This function is effectively stubbed and does nothing except return 127.0.0.1.
			// Glider has been removed from the worker, since the old proxy tests were always
			// passing even without a working proxy, they were invalid.
			// New proxy tests install glider in a container on the DUT and don't use this endpoint.
			console.warn(`proxy endpoint has been deprecated, returning localhost`);
			try {
				if (req.body.port != null) {
					res.send('127.0.0.1');
				} else {
					res.send('OK');
				}
			} catch (err) {
				next(err);
			}
		},
	);
	app.post(
		'/teardown',
		async (
			_req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			try {
				await worker.teardown();
				proxy.kill();
				try {
					await execSync(`pkill -f socat`);
				} catch (e) {
					if (e instanceof Error) {
						console.log(`Error tearing down tunnels : ${e.message}`);
					}
				}
				state = 'IDLE';
				flashState = 'IDLE';
				if (balenaLockPath != null) {
					await unlock(balenaLockPath);
				}
				clearTimeout(heartbeatTimeout);
				for (const tunnel of tunnels) {
					process.kill(tunnel.pid);
				}
				res.send('OK');
			} catch (e) {
				next(e);
			}
		},
	);
	app.use(function (
		err: Error,
		_req: express.Request,
		res: express.Response,
		_next: express.NextFunction,
	) {
		res.status(500).send(err.message);
	});
	app.post(
		'/dut/flash',
		async (req: express.Request, res: express.Response) => {

			res.setTimeout(0);
			console.log(`http keepalive timeout is ${httpServer.keepAliveTimeout}`)
			console.log(`http headertimeout is ${httpServer.headersTimeout}`);
			function onProgress(progress: multiWrite.MultiDestinationProgress): void {
				res.write(`progress: ${JSON.stringify(progress)}`);
			}

			res.writeHead(202, {
				'Content-Type': 'text/event-stream',
				Connection: 'keep-alive',
			});

			const timer = setInterval(() => {
				res.write('status: pending');
			}, 5000);

			const ZIPPED_IMAGE_PATH = '/data/os.img.gz';
			const UNZIPPED_IMAGE_PATH = '/data/os.img';

			try {
				worker.on('progress', onProgress);
				console.log(`Streaming image to temp file...`);
				await pipeline(
					req,
					createWriteStream(ZIPPED_IMAGE_PATH)
				)

				// Do not unzip as part of the request pipeline as it can lead to exceeding public URL timeout
				console.log(`Unzipping image....`);
				await pipeline(
					createReadStream(ZIPPED_IMAGE_PATH),
					createGunzip(),
					createWriteStream(UNZIPPED_IMAGE_PATH)
				)

				// Remove unzipped file to save space on low storage hosts like the fin
				console.log(`Removing zipped image...`);
				await unlink(ZIPPED_IMAGE_PATH)

				console.log(`attempting to flash ${UNZIPPED_IMAGE_PATH}...`)
				await worker.flash(UNZIPPED_IMAGE_PATH);
			} catch (e) {
				if (e instanceof Error) {
					console.log(e)
					res.write(`error: ${e.message}`);
				}
			} finally {
				worker.removeListener('progress', onProgress);
				res.write('status: done');
				res.end();
				clearInterval(timer);
			}
		},
	);

	app.post(
		'/dut/sendImage',
		async (
			req: express.Request, 
			res: express.Response,
			next: express.NextFunction
		) => {

			const ZIPPED_IMAGE_PATH = '/data/os.img.gz';
			try {
				console.log(`Streaming image to temp file...`);
				await pipeline(
					req,
					createWriteStream(ZIPPED_IMAGE_PATH)
				)
				res.send('OK');
			} catch (e) {
				if (e instanceof Error) {
					res.status(500).send(e.stack);
				}
			}
		},
	);

	// flashState tracks the state of the flashing process
	// DONE: completed
	// PENDING: still going
	// ERROR: there was an error
	// IDLE: nothing doing on
	app.post(
		'/dut/flashImage',
		async (
			req: express.Request, 
			res: express.Response,
			next: express.NextFunction
		) => {
			// set flashing state to pending
			flashState = 'PENDING' 
			const ZIPPED_IMAGE_PATH = '/data/os.img.gz';
			const UNZIPPED_IMAGE_PATH = '/data/os.img';
			const FLASH_TIMEOUT_TRIES = process.env.FLASH_TIMEOUT_TRIES || 60
			try {

				// respond OK to client/core once flashing is initiated to end connection
				res.send(JSON.stringify({timeoutTries: FLASH_TIMEOUT_TRIES}));

				// First unzip the image if its zipped
				// If a zipped version exist, we can assume thats what we want, as to save space we delete it after unzipping.
				// This saves public URL time, and reduces time in the case of a retry
				try{
					await stat(ZIPPED_IMAGE_PATH);

					console.log('Unzipping image...');
					await pipeline(
						createReadStream(ZIPPED_IMAGE_PATH),
						createGunzip(),
						createWriteStream(UNZIPPED_IMAGE_PATH)
					)

					// Delete zip archive after to save space, and enable the check above
					// Remove unzipped file to save space on low storage hosts like the fin
					console.log(`Removing zipped image...`);
					await unlink(ZIPPED_IMAGE_PATH)

				} catch (err: any) {
					if(err.code === 'ENOENT'){
						// fs.stat throws an ENOENT error if it doesn't exist
						console.log(`Image already unzipped`);
					} else {
						console.log(`Error unzipping image: ${err.message}`);
					}
				}
				
				console.log(`Flashing DUT...`);
				await worker.flash(UNZIPPED_IMAGE_PATH);
				// Once flashing is completed set state to done 
				flashState = 'DONE';
			} catch (e) {
				if (e instanceof Error) {
					flashState = 'ERROR';
					console.log(e.message)
				}
			}
		},
	);

	app.get('/dut/flashState', async (req: express.Request, res: express.Response) => {
		try {
			res.status(200).send(flashState);
		} catch (e) {
			if (e instanceof Error) {
				res.status(500).send(e.stack);
			}
		}
	});


	app.get('/heartbeat', async (req: express.Request, res: express.Response) => {
		try {
			heartbeatTimeout.refresh();
			res.status(200).send('OK');
		} catch (e) {
			if (e instanceof Error) {
				res.status(500).send(e.stack);
			}
		}
	});

	app.get('/state', async (req: express.Request, res: express.Response) => {
		try {
			res.status(200).send(state);
		} catch (e) {
			if (e instanceof Error) {
				res.status(500).send(e.stack);
			}
		}
	});

	app.get('/start', async (req: express.Request, res: express.Response) => {
		try {
			if (state !== 'BUSY') {
				state = 'BUSY';
				if (balenaLockPath != null) {
					await lock(balenaLockPath);
				}
				heartbeatTimeout = setTimeout(async () => {
					console.log(
						'Did not receive heartbeat from client - Tearing down...',
					);
					await worker.teardown();
					state = 'IDLE';
					if (balenaLockPath != null) {
						await unlock(balenaLockPath);
					}
				}, 1000 * 60 * 5);
				res.status(200).send('OK');
			} else {
				res.status(200).send('BUSY');
			}
		} catch (e) {
			if (e instanceof Error) {
				res.status(500).send(e.stack);
			}
		}
	});

	app.get('/dut/serial', (req: express.Request, res: express.Response) => {
		const reportPath = '/reports/dut-serial.txt';
		readFile(reportPath, (err, data) => {
			if (err) {
				console.error(`Unable to read ${reportPath}`, reportPath);
				res.status(500);
				res.send({ message: 'Cannot read the requested report' });
				return;
			}

			res.setHeader('content-type', 'text/plain');
			res.status(200);
			res.send(data);
		});
	});

	app.post(
		'/dut/keyboard',
		jsonParser,
		async (
			req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			try {
				console.log(`Trying to press: ${req.body.key}`)
				await worker.keyboardPress(req.body.key);
				res.send('OK');
			} catch (err) {
				console.error(err);
				next(err);
			}
		},
	);

	app.post(
		'/dut/serial/exec',
		jsonParser,
		async (
			req: express.Request,
			res: express.Response,
			next: express.NextFunction,
		) => {
			try {
				let output = await serialTerminal.exec(
					runtimeConfiguration.serial.path,
					runtimeConfiguration.serial.baudRate,
					req.body.cmd
				);
				res.send(output);
			} catch (err) {
				console.error(err);
				next(err);
			}
		},
	);

	app.get(
        '/dut/liveStream',
        async (
            _req: express.Request,
            res: express.Response,
            next: express.NextFunction,
        ) => {
            res.writeHead(200, {
                'Cache-Control': 'no-store, no-cache, must-revalidate, pre-check=0, post-check=0, max-age=0',
                Pragma: 'no-cache',
                Connection: 'close',
                'Content-Type': 'multipart/x-mixed-replace; boundary=FRAME'
            });
            // Send a MJPEG stream of the files in autoKit.video.captureFolder
			const CAPTURE_PATH = join(
				runtimeConfiguration.worker.workdir,
				'capture',
			);
			await worker.captureScreen('start');
            const fileWatcher = watch(CAPTURE_PATH, (event, filename) => {
                if(!filename.endsWith('.jpg')) return;
                readFile(`${CAPTURE_PATH}/${filename}`, (err, data) => {
                    if(!err) {
                        res.write('--FRAME\r\n', 'ascii');
                        res.write(`Content-Type: image/jpeg\r\nContent-Length: ${data.length}\r\n\r\n`, 'ascii');
                        res.write(data, 'binary');
                        res.write('\r\n', 'ascii');
                    }
                });
            });
            _req.on("close", async function() {
				await worker.captureScreen('stop');
                fileWatcher.close();
            });

            _req.on("end", async function() {
				await worker.captureScreen('stop');
                fileWatcher.close();
            });
        },
    );

	return app;
}

export default setup;
