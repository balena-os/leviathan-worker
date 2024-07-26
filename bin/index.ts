import config from '../lib/config';
import setup from '../lib/index';
import { getRuntimeConfiguration } from '../lib/helpers';

(async function (): Promise<void> {
	const port = config.worker.port;

	const runtimeConfiguration = await getRuntimeConfiguration();
	const app = await setup(runtimeConfiguration);

	/**
	 * Start Express Server
	 */
	const server = app.listen(port, () => {
		const address = server.address();
		server.timeout = 0
		server.headersTimeout = 0;
		server.keepAliveTimeout = 0; 
		server.requestTimeout = 900000 ; //15 mins
		server.setTimeout(0)

		if (typeof address !== 'string') {
			console.log(`Worker http listening on port ${address?.port}`);
		} else {
			console.log(`Worker listening at path ${address}`);
		}
	});
})();
