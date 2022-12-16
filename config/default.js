const isTrue = (v, def=false) => {
	return v != undefined
		? ['true', '1'].includes(v)
		: def
};

module.exports = {
	worker: {
		port: process.env.WORKER_PORT || 80,
		runtimeConfiguration: {
			worker: {
				workdir: process.env.WORKDIR || '/data',
				deviceType: process.env.WORKER_TYPE || 'testbot_hat',
			},
			screenCapture: isTrue(process.env.SCREEN_CAPTURE),
			network: {
				wired: process.env.NETWORK_WIRED_INTERFACE || 'eth1',
				wireless: process.env.NETWORK_WIRELESS_INTERFACE || 'wlan0',
			},
			qemu: {
				architecture: process.env.QEMU_ARCH || 'x86_64',
				cpus: process.env.QEMU_CPUS || '4',
				memory: process.env.QEMU_MEMORY || '512M',
				debug: isTrue(process.env.QEMU_DEBUG),
				forceRaid: isTrue(process.env.QEMU_FORCE_RAID),
				network: {
					autoconfigure: isTrue(process.env.QEMU_NETWORK_AUTOCONFIGURE, true),
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
