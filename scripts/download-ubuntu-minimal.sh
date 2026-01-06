#!/bin/bash
# Download and set up Ubuntu Minimal cloud image for VMs
set -e

BASE_IMAGES_DIR="${HOME}/.local/share/agentcontainers/base-images"
IMAGE_NAME="ubuntu-minimal-24.04"
IMAGE_DIR="${BASE_IMAGES_DIR}/${IMAGE_NAME}"

# Ubuntu minimal cloud image URL
IMAGE_URL="https://cloud-images.ubuntu.com/minimal/releases/noble/release/ubuntu-24.04-minimal-cloudimg-amd64.img"

echo "Setting up Ubuntu Minimal 24.04 base image..."

# Create directory
mkdir -p "${IMAGE_DIR}"

# Download image if not exists
if [ ! -f "${IMAGE_DIR}/image.qcow2" ]; then
    echo "Downloading Ubuntu Minimal cloud image..."
    wget -q --show-progress "${IMAGE_URL}" -O "${IMAGE_DIR}/image.qcow2.tmp"
    mv "${IMAGE_DIR}/image.qcow2.tmp" "${IMAGE_DIR}/image.qcow2"
    echo "Download complete."
else
    echo "Image already exists, skipping download."
fi

# We need to extract kernel and initrd from the image
# Cloud-hypervisor requires them as separate files for direct kernel boot
echo "Extracting kernel and initrd from image..."

# Create a temporary mount point
MOUNT_DIR=$(mktemp -d)
NBD_DEVICE=""

cleanup() {
    if [ -n "$NBD_DEVICE" ]; then
        sudo umount "${MOUNT_DIR}" 2>/dev/null || true
        sudo qemu-nbd --disconnect "$NBD_DEVICE" 2>/dev/null || true
    fi
    rmdir "${MOUNT_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

# Check if kernel/initrd already exist
if [ -f "${IMAGE_DIR}/kernel" ] && [ -f "${IMAGE_DIR}/initrd" ]; then
    echo "Kernel and initrd already extracted."
else
    # Load nbd module
    sudo modprobe nbd max_part=8

    # Find available nbd device
    for i in $(seq 0 15); do
        if [ ! -e /sys/block/nbd${i}/pid ]; then
            NBD_DEVICE="/dev/nbd${i}"
            break
        fi
    done

    if [ -z "$NBD_DEVICE" ]; then
        echo "Error: No available NBD device found"
        exit 1
    fi

    echo "Using NBD device: ${NBD_DEVICE}"

    # Connect the QCOW2 image
    sudo qemu-nbd --connect="${NBD_DEVICE}" "${IMAGE_DIR}/image.qcow2"
    sleep 1

    # Wait for partition to appear
    for i in $(seq 1 10); do
        if [ -e "${NBD_DEVICE}p1" ]; then
            break
        fi
        sleep 0.5
    done

    # Mount the first partition (root filesystem)
    sudo mount "${NBD_DEVICE}p1" "${MOUNT_DIR}"

    # Copy kernel and initrd
    KERNEL=$(ls "${MOUNT_DIR}/boot/vmlinuz-"* 2>/dev/null | sort -V | tail -1)
    INITRD=$(ls "${MOUNT_DIR}/boot/initrd.img-"* 2>/dev/null | sort -V | tail -1)

    if [ -z "$KERNEL" ] || [ -z "$INITRD" ]; then
        echo "Error: Could not find kernel or initrd in image"
        sudo umount "${MOUNT_DIR}"
        sudo qemu-nbd --disconnect "${NBD_DEVICE}"
        exit 1
    fi

    echo "Found kernel: ${KERNEL}"
    echo "Found initrd: ${INITRD}"

    sudo cp "${KERNEL}" "${IMAGE_DIR}/kernel"
    sudo cp "${INITRD}" "${IMAGE_DIR}/initrd"
    sudo chown $(id -u):$(id -g) "${IMAGE_DIR}/kernel" "${IMAGE_DIR}/initrd"

    # Cleanup
    sudo umount "${MOUNT_DIR}"
    sudo qemu-nbd --disconnect "${NBD_DEVICE}"
    NBD_DEVICE=""

    echo "Kernel and initrd extracted successfully."
fi

# Resize image to ensure it has enough space for QCOW2 overlays
echo "Ensuring image has minimum size for overlays..."
CURRENT_SIZE=$(qemu-img info --output=json "${IMAGE_DIR}/image.qcow2" | grep '"virtual-size"' | grep -oP '\d+')
MIN_SIZE=$((10 * 1024 * 1024 * 1024)) # 10GB

if [ "$CURRENT_SIZE" -lt "$MIN_SIZE" ]; then
    echo "Resizing image to 10GB..."
    qemu-img resize "${IMAGE_DIR}/image.qcow2" 10G
fi

echo ""
echo "Ubuntu Minimal 24.04 setup complete!"
echo "Location: ${IMAGE_DIR}"
echo ""
echo "Files:"
ls -lh "${IMAGE_DIR}/"
echo ""
echo "To use this image, it will be available in the Base Images section of the UI."
