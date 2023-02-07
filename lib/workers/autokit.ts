import { Autokit } from '@balena/autokit';
import { EventEmitter } from 'events';
import * as Stream from 'stream';
import { manageHandlers } from '../helpers';

/** Worker implementation based on testbot. */
class AutokitWorker extends EventEmitter implements Leviathan.Worker {
	private internalState: Leviathan.WorkerState = { network: {} };

	private autoKit: Autokit;
	private dutLogStream: Stream.Writable | null = null;

	constructor(options: Leviathan.RuntimeConfiguration) {
		super();


        const autokitConfig = {
            power: process.env.POWER || 'autokitRelay',
            sdMux: process.env.SD_MUX || 'linuxAut',
            network: process.env.NETWORK ||  'linuxNetwork',
            video: process.env.VIDEO || 'linuxVideo',
			serial: process.env.SERIAL || 'dummySerial',
            usbBootPort: process.env.USB_BOOT_PORT || '4',
			digitalRelay: process.env.DIGITAL_RELAY || 'usbRelay'
        }

		this.autoKit = new Autokit(autokitConfig);
	}

	get state() {
		return this.internalState;
	}

	public async setup() {
		await this.autoKit.setup();
	}

	public async flash(filename: string) {
		console.log('Start flashing...');
		await this.autoKit.flash(filename, process.env.TESTBOT_DUT_TYPE || '');
		console.log('Flashing completed.');
	}

	public async powerOn() {
		// todo - implement serial logging

		console.log('Trying to power on DUT...');
		await this.autoKit.power.on();
	}

	public async diagnostics() {
		return {
		};
	}

	public async powerOff() {
		console.log('Powering off DUT...');
		await this.autoKit.power.off();
	}

	public async network(configuration: {
        wireless: {
            ssid?: string,
            psk?: string
        },
        wired?: {}
    }) {
		console.log('Start network setup');

		if (configuration.wireless != null) {
			this.internalState.network = {
                wireless: await this.autoKit.network.createWirelessNetwork(configuration.wireless.ssid, configuration.wireless.psk)
			};
		} 

		if (configuration.wired != null) {
			this.internalState.network = {
				wired: await this.autoKit.network.createWiredNetwork()
			};
		} 
		console.log('Network setup completed');
	}

	public async captureScreen(
		action: 'start' | 'stop',
	): Promise<void | Stream.Readable> {
		switch (action) {
			case 'start':
				return await this.autoKit.video.startCapture();
			case 'stop':
				return await this.autoKit.video.stopCapture();
		}
	}

	public async teardown(signal?: NodeJS.Signals): Promise<void> {
		console.log('Performing teardown...');
		try {
			manageHandlers(this.teardown, {
				register: false,
			});

			await this.autoKit.teardown();
		} finally {
			if (signal != null) {
				process.kill(process.pid, signal);
			}
		}
	}
}

export { AutokitWorker };
