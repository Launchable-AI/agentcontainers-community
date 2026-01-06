#!/bin/bash
# Prepare a base image for Firecracker
#
# This script converts a QCOW2 image to raw format, extracts the kernel,
# and installs the MMDS configuration scripts.
#
# Usage: ./prepare-fc-image.sh <base-image-name>
# Example: ./prepare-fc-image.sh ubuntu-minimal-24.04

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
GUEST_INIT_DIR="$PROJECT_DIR/guest-init"

# Handle sudo: use SUDO_USER's home if running as root via sudo
if [ -n "$SUDO_USER" ]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    REAL_HOME="$HOME"
fi
BASE_IMAGES_DIR="${BASE_IMAGES_DIR:-$REAL_HOME/.local/share/agentcontainers/base-images}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

usage() {
    echo "Usage: $0 <base-image-name>"
    echo ""
    echo "Prepares a base image for Firecracker by:"
    echo "  1. Converting QCOW2 to raw ext4 format"
    echo "  2. Extracting the kernel (vmlinux)"
    echo "  3. Installing MMDS configuration scripts"
    echo ""
    echo "Example:"
    echo "  $0 ubuntu-minimal-24.04"
    echo ""
    echo "Prerequisites:"
    echo "  - Base image must exist at: \$BASE_IMAGES_DIR/<name>/image.qcow2"
    echo "  - Required tools: qemu-img, guestfish (or mount with sudo)"
    exit 1
}

# Check arguments
if [ $# -lt 1 ]; then
    usage
fi

IMAGE_NAME="$1"
IMAGE_DIR="$BASE_IMAGES_DIR/$IMAGE_NAME"
QCOW2_PATH="$IMAGE_DIR/image.qcow2"
RAW_PATH="$IMAGE_DIR/rootfs.ext4"
KERNEL_PATH="$IMAGE_DIR/vmlinux"

echo "=== Firecracker Image Preparation ==="
echo "Image name: $IMAGE_NAME"
echo "Image directory: $IMAGE_DIR"
echo ""

# Check if QCOW2 image exists
if [ ! -f "$QCOW2_PATH" ]; then
    error "QCOW2 image not found: $QCOW2_PATH"
fi

# Check if guest-init scripts exist
if [ ! -f "$GUEST_INIT_DIR/mmds-configure.sh" ]; then
    error "MMDS configure script not found: $GUEST_INIT_DIR/mmds-configure.sh"
fi

# Check for required tools
if ! command -v qemu-img &> /dev/null; then
    error "qemu-img is required but not installed. Install with: sudo apt install qemu-utils"
fi

# Step 1: Convert QCOW2 to raw
if [ -f "$RAW_PATH" ]; then
    warn "Raw image already exists: $RAW_PATH"
    read -p "Overwrite? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Skipping conversion"
    else
        log "Converting QCOW2 to raw..."
        qemu-img convert -p -f qcow2 -O raw "$QCOW2_PATH" "$RAW_PATH"
        log "Conversion complete"
    fi
else
    log "Converting QCOW2 to raw..."
    qemu-img convert -p -f qcow2 -O raw "$QCOW2_PATH" "$RAW_PATH"
    log "Conversion complete"
fi

# Step 2: Install MMDS scripts and extract kernel
log "Installing MMDS scripts and extracting kernel..."

# Try guestfish first (doesn't require root)
if command -v guestfish &> /dev/null; then
    log "Using guestfish for image modification..."

    # Create a script for guestfish
    GUESTFISH_SCRIPT=$(mktemp)
    cat > "$GUESTFISH_SCRIPT" << 'GFEOF'
# Mount the filesystem
run
mount /dev/sda1 /

# Copy MMDS configure script
upload MMDS_SCRIPT /usr/local/bin/mmds-configure.sh
chmod 0755 /usr/local/bin/mmds-configure.sh

# Copy systemd service
upload MMDS_SERVICE /etc/systemd/system/mmds-configure.service

# Enable the service
ln-sf /etc/systemd/system/mmds-configure.service /etc/systemd/system/multi-user.target.wants/mmds-configure.service

# Ensure jq is installed (needed for MMDS parsing)
# This is a no-op if already installed
command "which jq || apt-get update -qq && apt-get install -y -qq jq curl"

# Download kernel
download /boot/vmlinuz* KERNEL_PATH_PLACEHOLDER
GFEOF

    # Replace placeholders
    sed -i "s|MMDS_SCRIPT|$GUEST_INIT_DIR/mmds-configure.sh|g" "$GUESTFISH_SCRIPT"
    sed -i "s|MMDS_SERVICE|$GUEST_INIT_DIR/mmds-configure.service|g" "$GUESTFISH_SCRIPT"
    sed -i "s|KERNEL_PATH_PLACEHOLDER|$KERNEL_PATH|g" "$GUESTFISH_SCRIPT"

    # Run guestfish
    guestfish -a "$RAW_PATH" < "$GUESTFISH_SCRIPT" || {
        warn "guestfish failed, falling back to mount method"
        rm -f "$GUESTFISH_SCRIPT"
        USE_MOUNT=1
    }
    rm -f "$GUESTFISH_SCRIPT"
else
    USE_MOUNT=1
fi

# Fallback: use mount (requires root)
if [ "${USE_MOUNT:-0}" = "1" ]; then
    if [ "$EUID" -ne 0 ]; then
        warn "Guestfish not available and not running as root."
        warn "Please install guestfish or run with sudo:"
        warn "  sudo apt install libguestfs-tools"
        warn "  OR"
        warn "  sudo $0 $IMAGE_NAME"
        exit 1
    fi

    log "Using mount for image modification (requires root)..."

    MOUNT_POINT=$(mktemp -d)

    # Find the Linux root partition (type "Linux filesystem")
    # Use fdisk to find partition start sector
    PART_INFO=$(fdisk -l "$RAW_PATH" 2>/dev/null | grep "Linux filesystem" | head -1)
    if [ -z "$PART_INFO" ]; then
        # Try looking for partition 1
        PART_INFO=$(fdisk -l "$RAW_PATH" 2>/dev/null | grep "${RAW_PATH}.*1 " | head -1)
    fi

    if [ -n "$PART_INFO" ]; then
        # Extract start sector (second field after partition name)
        OFFSET=$(echo "$PART_INFO" | awk '{print $2}')
        # If the second field is '*' (bootable flag), use the third field
        if [ "$OFFSET" = "*" ]; then
            OFFSET=$(echo "$PART_INFO" | awk '{print $3}')
        fi
        OFFSET_BYTES=$((OFFSET * 512))
        log "Found partition at offset $OFFSET sectors ($OFFSET_BYTES bytes)"
    else
        OFFSET_BYTES=0
        warn "Could not detect partition offset, trying offset 0"
    fi

    # Use losetup for better partition handling
    LOOP_DEV=$(losetup -f --show -o "$OFFSET_BYTES" "$RAW_PATH" 2>/dev/null)
    if [ -z "$LOOP_DEV" ]; then
        error "Failed to setup loop device"
    fi

    trap "umount '$MOUNT_POINT' 2>/dev/null; losetup -d '$LOOP_DEV' 2>/dev/null; rmdir '$MOUNT_POINT' 2>/dev/null" EXIT

    mount "$LOOP_DEV" "$MOUNT_POINT" || {
        error "Failed to mount image. The image may have a different partition layout."
    }

    # Copy MMDS scripts
    cp "$GUEST_INIT_DIR/mmds-configure.sh" "$MOUNT_POINT/usr/local/bin/"
    chmod +x "$MOUNT_POINT/usr/local/bin/mmds-configure.sh"

    cp "$GUEST_INIT_DIR/mmds-configure.service" "$MOUNT_POINT/etc/systemd/system/"

    # Enable the service
    mkdir -p "$MOUNT_POINT/etc/systemd/system/multi-user.target.wants"
    ln -sf /etc/systemd/system/mmds-configure.service \
           "$MOUNT_POINT/etc/systemd/system/multi-user.target.wants/mmds-configure.service"

    # Extract kernel - Firecracker needs uncompressed vmlinux
    # First check if there's already an extracted kernel in the base image
    if [ -f "$IMAGE_DIR/kernel" ]; then
        # Check if it's uncompressed (vmlinux) or compressed (vmlinuz)
        if file "$IMAGE_DIR/kernel" | grep -q "ELF"; then
            log "Using existing uncompressed kernel from base image"
            cp "$IMAGE_DIR/kernel" "$KERNEL_PATH"
        else
            log "Existing kernel is compressed, extracting from image..."
            KERNEL_FILE=$(ls "$MOUNT_POINT/boot/vmlinux"* 2>/dev/null | head -1)
            if [ -z "$KERNEL_FILE" ]; then
                KERNEL_FILE=$(ls "$MOUNT_POINT/boot/vmlinuz"* 2>/dev/null | head -1)
            fi
            if [ -n "$KERNEL_FILE" ]; then
                cp "$KERNEL_FILE" "$KERNEL_PATH"
                log "Extracted kernel: $KERNEL_PATH"
            fi
        fi
    else
        # Try to find kernel in the image
        KERNEL_FILE=$(ls "$MOUNT_POINT/boot/vmlinux"* 2>/dev/null | head -1)
        if [ -z "$KERNEL_FILE" ]; then
            KERNEL_FILE=$(ls "$MOUNT_POINT/boot/vmlinuz"* 2>/dev/null | head -1)
        fi
        if [ -n "$KERNEL_FILE" ]; then
            cp "$KERNEL_FILE" "$KERNEL_PATH"
            log "Extracted kernel: $KERNEL_PATH"
        else
            warn "Kernel not found in /boot/"
        fi
    fi

    # Install jq if needed (chroot)
    if [ ! -f "$MOUNT_POINT/usr/bin/jq" ]; then
        log "Installing jq in guest image..."
        # Need to mount /proc, /sys, /dev for chroot to work properly
        mount --bind /proc "$MOUNT_POINT/proc" 2>/dev/null || true
        mount --bind /sys "$MOUNT_POINT/sys" 2>/dev/null || true
        mount --bind /dev "$MOUNT_POINT/dev" 2>/dev/null || true

        chroot "$MOUNT_POINT" /bin/bash -c "apt-get update -qq && apt-get install -y -qq jq curl" 2>/dev/null || \
            warn "Failed to install jq - you may need to install it manually"

        umount "$MOUNT_POINT/proc" 2>/dev/null || true
        umount "$MOUNT_POINT/sys" 2>/dev/null || true
        umount "$MOUNT_POINT/dev" 2>/dev/null || true
    fi

    umount "$MOUNT_POINT"
    losetup -d "$LOOP_DEV"
    rmdir "$MOUNT_POINT"
    trap - EXIT
fi

# Step 3: Verify kernel exists
if [ ! -f "$KERNEL_PATH" ]; then
    warn "Kernel was not extracted. You may need to extract it manually:"
    warn "  1. Mount the image: sudo mount -o loop $RAW_PATH /mnt"
    warn "  2. Copy kernel: sudo cp /mnt/boot/vmlinuz* $KERNEL_PATH"
    warn "  3. Unmount: sudo umount /mnt"
fi

# Done
echo ""
echo "=== Preparation Complete ==="
echo ""
echo "Firecracker image files:"
echo "  Root filesystem: $RAW_PATH"
if [ -f "$KERNEL_PATH" ]; then
    echo "  Kernel: $KERNEL_PATH"
else
    echo "  Kernel: NOT FOUND (extract manually)"
fi
echo ""
echo "To use this image with Firecracker:"
echo "  Create VM with: { \"hypervisor\": \"firecracker\", \"baseImage\": \"$IMAGE_NAME\" }"
echo ""
