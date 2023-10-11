#!/bin/sh
modprobe sg

eval $(ssh-agent)

# Only start docker in docker if not using the qemu worker
if [ "${WORKER_TYPE}" != "qemu" ]; then
	rm -rf /var/run/docker 2>/dev/null || true
	rm -f /var/run/docker.sock 2>/dev/null || true
	rm -f /var/run/docker.pid 2>/dev/null || true

	dockerd &

	exec node ./build/bin
fi

misc_major=10
tun_minor=$(grep tun /proc/misc | cut -d ' ' -f1)
if [ -n "${tun_minor}" ]; then
	mkdir -p /dev/net
	if ! mknod -m 666 /dev/net/tun c "${misc_major}" "${tun_minor}"; then
		echo "Unable to create TUN device node"
		exit 1
	fi
else
	echo "TUN is unavailable, unable to setup networking"
	exit 1
fi


kvm_minor=$(grep kvm /proc/misc | cut -d ' ' -f1)
if [ -n "${kvm_minor}" ]; then
	if ! mknod -m 666 /dev/kvm c "${misc_major}" "${kvm_minor}"; then
		echo "Unable to create KVM device node, software emulation is still available"
	fi
else
	echo "KVM is unavailable, falling back on software emulation"
fi

loop_major=7
loopctrl_minor=$(grep loop-control /proc/misc | cut -d ' ' -f1)
if [ -n "${loopctrl_minor}" ]; then
	if ! mknod -m 660 /dev/loop-control c "${misc_major}" "${loopctrl_minor}"; then
		echo "Unable to create loop-control device node"
		exit 1
	fi

	for i in $(seq 0 128); do
		mknod -m 660 "/dev/loop${i}" b "${loop_major}" "${i}"
	done
fi

metadata_major=9
for i in $(seq 0 127); do
	mknod -m 660 "/dev/md${i}" b "${metadata_major}" "${i}"
done

node ./build/bin
