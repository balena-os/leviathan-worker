export const config = {
	worker: {
		port: process.env.WORKER_PORT || 80,
		runtimeConfiguration: {
			worker: {
				workdir: process.env.WORKDIR || '/tmp',
				deviceType: process.env.WORKER_TYPE || 'testbot_hat',
			},
			screenCapture: process.env.SCREEN_CAPTURE === 'true',
			network: {
				wired: process.env.NETWORK_WIRED_INTERFACE || 'eth1',
				wireless: process.env.NETWORK_WIRELESS_INTERFACE || 'wlan0',
			},
			serial: {
				baudRate: process.env.BAUD_RATE || 115200,
				path: process.env.SERIAL_PATH || '/dev/pts/0'
			},
			qemu: {
				architecture: process.env.QEMU_ARCH || 'x86_64',
				cpus: process.env.QEMU_CPUS || '4',
				memory: process.env.QEMU_MEMORY || '2G',
				debug: process.env.QEMU_DEBUG || false,
				forceRaid: process.env.QEMU_FORCE_RAID || false,
				secureBoot: process.env.QEMU_SECUREBOOT || false,
				internalStorage: process.env.QEMU_INTERNAL_STORAGE? ['1','true'].includes(process.env.QEMU_INTERNAL_STORAGE as string) : true,
				externalStorage: process.env.QEMU_EXTERNAL_STORAGE? ['1','true'].includes(process.env.QEMU_EXTERNAL_STORAGE as string) : true,
				network: {
					autoconfigure: true,
					bridgeName: process.env.QEMU_BRIDGE_NAME || null,
					bridgeAddress: process.env.QEMU_BRIDGE_ADDRESS || null,
					dhcpRange: process.env.QEMU_DHCP_RANGE || null,
					vncPort: process.env.QEMU_VNC_PORT || null,
					qmpPort: process.env.QEMU_QMP_PORT || null,
					vncMinPort: process.env.QEMU_VNC_MIN_PORT || 5900,
					vncMaxPort: process.env.QEMU_VNC_MAX_PORT || 5999,
					qmpMinPort: process.env.QEMU_QMP_MIN_PORT || 5000,
					qmpMaxPort: process.env.QEMU_QMP_MAX_PORT || 5899,
				}
			}
		},
	},
};

export default config
