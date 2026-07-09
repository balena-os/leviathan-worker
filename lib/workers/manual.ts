import { EventEmitter } from 'events';
import * as Stream from 'stream';

/** Worker implementation based on testbot. */
class ManualWorker extends EventEmitter implements Leviathan.Worker {
	private internalState: Leviathan.WorkerState = { network: {} };

	constructor(options: Leviathan.RuntimeConfiguration) {
		super();
        console.log('Using manual worker: manual flashing of DUT is required')
	}

	get state() {
		return this.internalState;
	}

	public async setup() {
		
	}

	public async flash(filename: string) {
		console.log(`[Manual worker]: Manually flash DUT now, with image at ${filename}`);
	}

	public async powerOn() {
		console.log('[Manual worker]: Power on DUT');
	}

	public async diagnostics() {
		return {
		};
	}

	public async powerOff() {
        console.log('[Manual worker]: Power off DUT');
	}

	public async network(configuration: {
        wireless: {
            ssid?: string,
            psk?: string
        },
        wired?: {}
    }) {

		if (configuration.wireless != null) {
            console.log(`[Manual worker]: Test suite expects DUT to be connected to Wifi network, SSID: ${configuration.wireless.ssid}, PSK: ${configuration.wireless.psk}`);
		} 

		if (configuration.wired != null) {
            console.log(`[Manual worker]: Test suite expects DUT to be connected to wired network`);
		} 
	}

	public async captureScreen(
		action: 'start' | 'stop',
	): Promise<void | Stream.Readable> {
        console.log(`[Manual worker]: Manual worker does not support screen capture`);
	}

	public async teardown(signal?: NodeJS.Signals): Promise<void> {
        console.log(`[Manual worker]: Tear down DUT`);
	}
}

export { ManualWorker };
