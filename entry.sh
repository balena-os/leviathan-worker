#!/bin/sh

eval $(ssh-agent)

if [ "${WORKER_TYPE}" != "qemu" ]; then
	exec node ./build/bin
fi

misc_major=10
tun_minor=$(grep tun /proc/misc | cut -d ' ' -f1)
if [ -n "${tun_minor}" ]; then
	mkdir -p /dev/net
	if ! test -e /dev/net/tun \
			&& ! mknod -m 666 /dev/net/tun c "${misc_major}" "${tun_minor}"; then
		echo "Unable to create TUN device node"
		exit 1
	fi
else
	echo "TUN is unavailable, unable to setup networking"
	exit 1
fi


kvm_minor=$(grep kvm /proc/misc | cut -d ' ' -f1)
if [ -n "${kvm_minor}" ]; then
	if ! test -e ${kvm_minor} \
			&& ! mknod -m 666 /dev/kvm c "${misc_major}" "${kvm_minor}"; then
		echo "Unable to create KVM device node, software emulation is still available"
	fi
else
	echo "KVM is unavailable, falling back on software emulation"
fi

loop_major=7
loopctrl_minor=$(grep loop-control /proc/misc | cut -d ' ' -f1)
if [ -n "${loopctrl_minor}" ]; then
	if ! test -e /dev/loop-control \
			&& ! mknod -m 660 /dev/loop-control c "${misc_major}" "${loopctrl_minor}"; then
		echo "Unable to create loop-control device node"
		exit 1
	fi

	for i in $(seq 0 128); do
		mknod -m 660 "/dev/loop${i}" b "${loop_major}" "${i}"
	done
fi

metadata_major=9
for i in $(seq 0 127); do
	if ! test -e "/dev/md${i}"; then
		mknod -m 660 "/dev/md${i}" b "${metadata_major}" "${i}"
	fi
done

node ./build/bin
