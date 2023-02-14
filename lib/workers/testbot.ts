import {
	DeviceInteractor,
	IntelNuc,
	RaspberryPi,
	TestBotHat,
	BalenaFin,
	BalenaFinV09,
	BeagleBone,
	RevPiCore3,
	CM4IOBoard,
	Imx8mmebcrs08a2,
	CoralDevBoard,
	JetsonNano,
	Rockpi4bRk3399,
	Rpi243390,
	RevPiConnect,
	RtRpi300,
	RPI3Neuron,
	RPI4Neuron,
	JetsonTX2,
	Imx8mmVarDartNRT,
	RockPro64,
} from '@balena/testbot';
import { EventEmitter } from 'events';
import { createWriteStream } from 'fs';
import { join } from 'path';
import * as Stream from 'stream';
import { manageHandlers } from '../helpers';
import ScreenCapture from '../helpers/graphics';
import NetworkManager, { Supported } from '../helpers/nm';

// TODO: Consider moving network and screen capture logic to testbot SDK.

const dutSerialPath = '/reports/dut-serial.txt';

const resolveDeviceInteractor = (hat: TestBotHat): DeviceInteractor => {
	if (process.env.TESTBOT_DUT_TYPE === 'beaglebone-black') {
		return new BeagleBone(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'fincm3-v09') {
		return new BalenaFinV09(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'fincm3') {
		return new BalenaFin(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'intel-nuc') {
		return new IntelNuc(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'revpi-core-3') {
		return new RevPiCore3(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'revpi-connect') {
		return new RevPiConnect(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'raspberrypicm4-ioboard') {
		return new CM4IOBoard(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'imx8mmebcrs08a2') {
		return new Imx8mmebcrs08a2(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'coral-dev') {
		return new CoralDevBoard(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'jetson-nano') {
		return new JetsonNano(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'rockpi-4b-rk3399') {
		return new Rockpi4bRk3399(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === '243390-rpi3') {
		return new Rpi243390(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'rt-rpi-300') {
		return new RtRpi300(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'raspberrypi3-unipi-neuron') {
		return new RPI3Neuron(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'raspberrypi4-unipi-neuron') {
		return new RPI4Neuron(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'jetson-tx2') {
		return new JetsonTX2(hat);
	}
	if (process.env.TESTBOT_DUT_TYPE === 'imx8mm-var-dart-nrt') {
		return new Imx8mmVarDartNRT(hat);
        }
	if (process.env.TESTBOT_DUT_TYPE === 'rockpro64') {
		return new RockPro64(hat);
        }
	return new RaspberryPi(hat);
};

/** Worker implementation based on testbot. */
class TestBotWorker extends EventEmitter implements Leviathan.Worker {
	private internalState: Leviathan.WorkerState = { network: {} };
	private readonly networkCtl?: NetworkManager;
	private readonly screenCapturer?: ScreenCapture;

	private readonly hatBoard: TestBotHat;
	private readonly deviceInteractor: DeviceInteractor;
	private dutLogStream: Stream.Writable | null = null;

	constructor(options: Leviathan.RuntimeConfiguration) {
		super();

		this.hatBoard = new TestBotHat();
		this.deviceInteractor = resolveDeviceInteractor(this.hatBoard);

		if (options != null) {
			if (options.network != null) {
				this.networkCtl = new NetworkManager(options.network);
			}

			if (options.screenCapture === true) {
				this.screenCapturer = new ScreenCapture(
					{
						type: 'v4l2src',
					},
					join(options.worker.workdir, 'capture'),
				);
			}
		}
	}

	get state() {
		return this.internalState;
	}

	public async setup() {
		await this.hatBoard.setup();
	}

	public async flash(filename: string) {
		console.log('Start flashing...');
		await this.deviceInteractor.flash(filename);
		console.log('Flashing completed.');
	}

	public async powerOn() {
		const dutLog = await this.hatBoard.openDutSerial();
		if (dutLog) {
			this.dutLogStream = createWriteStream(dutSerialPath);
			dutLog.pipe(this.dutLogStream);
		}
		console.log('Trying to power on DUT...');
		await this.deviceInteractor.powerOn();
		console.log('Vout=', await this.hatBoard.readVout());
	}

	public async diagnostics() {
		return {
			vout: await this.hatBoard.readVout(),
			amperage: await this.hatBoard.readVoutAmperage(),
			deviceVoltage: this.deviceInteractor.powerVoltage,
		};
	}

	public async powerOff() {
		console.log('Powering off DUT...');
		await this.deviceInteractor.powerOff();
		this.dutLogStream?.end();
	}

	public async network(configuration: Supported['configuration']) {
		console.log('Start network setup');
		if (this.networkCtl == null) {
			throw new Error('Network not configured on this worker. Ignoring...');
		}

		if (configuration.wireless != null) {
			console.log('Adding wireless connection...');
			this.internalState.network = {
				wireless: await this.networkCtl.addWirelessConnection(
					configuration.wireless,
				),
			};
		} else {
			await this.networkCtl.teardowns.wireless.run();
			this.internalState.network.wireless = undefined;
		}

		if (configuration.wired != null) {
			console.log('Adding wired connection...');
			this.internalState.network = {
				wired: await this.networkCtl.addWiredConnection(configuration.wired),
			};
		} else {
			await this.networkCtl.teardowns.wired.run();
			this.internalState.network.wired = undefined;
		}
		console.log('Network setup completed');
	}

	public async captureScreen(
		action: 'start' | 'stop',
	): Promise<void | Stream.Readable> {
		if (this.screenCapturer == null) {
			throw new Error('Screen capture not configured');
		}

		switch (action) {
			case 'start':
				return await this.screenCapturer.startCapture();
			case 'stop':
				return await this.screenCapturer.stopCapture();
		}
	}

	public async teardown(signal?: NodeJS.Signals): Promise<void> {
		console.log('Performing teardown...');
		try {
			manageHandlers(this.teardown, {
				register: false,
			});

			await this.hatBoard.teardown(signal === 'SIGTERM' || signal === 'SIGINT');

			if (this.screenCapturer != null) {
				await this.screenCapturer.teardown();
			}

			if (this.networkCtl != null) {
				await this.networkCtl.teardown();
			}
		} finally {
			if (signal != null) {
				process.kill(process.pid, signal);
			}
		}
	}
}

export { TestBotWorker };
