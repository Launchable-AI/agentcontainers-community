#!/bin/bash
# Install Firecracker for VM management
# Downloads the latest stable Firecracker binary from GitHub releases

set -e

# Configuration
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
FC_VERSION="${FC_VERSION:-v1.10.1}"
ARCH=$(uname -m)

# Map architecture names
case "$ARCH" in
    x86_64)
        FC_ARCH="x86_64"
        ;;
    aarch64)
        FC_ARCH="aarch64"
        ;;
    *)
        echo "Error: Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

echo "=== Firecracker Installation Script ==="
echo "Version: $FC_VERSION"
echo "Architecture: $FC_ARCH"
echo "Install directory: $INSTALL_DIR"
echo ""

# Check if running as root for installation
if [ "$EUID" -ne 0 ] && [ ! -w "$INSTALL_DIR" ]; then
    echo "Error: Need root privileges to install to $INSTALL_DIR"
    echo "Run: sudo $0"
    exit 1
fi

# Check KVM access
echo "Checking KVM access..."
if [ ! -e /dev/kvm ]; then
    echo "Warning: /dev/kvm not found. KVM may not be enabled."
    echo "Firecracker requires KVM to run VMs."
fi

# Download URL
RELEASE_URL="https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${FC_ARCH}.tgz"

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Downloading Firecracker ${FC_VERSION}..."
cd "$TEMP_DIR"

if command -v wget &> /dev/null; then
    wget -q --show-progress "$RELEASE_URL" -O firecracker.tgz
elif command -v curl &> /dev/null; then
    curl -L --progress-bar "$RELEASE_URL" -o firecracker.tgz
else
    echo "Error: wget or curl required"
    exit 1
fi

echo "Extracting..."
tar -xzf firecracker.tgz

# Find the extracted directory
FC_DIR=$(find . -maxdepth 1 -type d -name "release-*" | head -1)
if [ -z "$FC_DIR" ]; then
    echo "Error: Could not find extracted release directory"
    exit 1
fi

# Install binaries
echo "Installing to $INSTALL_DIR..."

# Firecracker binary
if [ -f "$FC_DIR/firecracker-${FC_VERSION}-${FC_ARCH}" ]; then
    cp "$FC_DIR/firecracker-${FC_VERSION}-${FC_ARCH}" "$INSTALL_DIR/firecracker"
    chmod +x "$INSTALL_DIR/firecracker"
    echo "  Installed: firecracker"
fi

# Jailer binary (for production security)
if [ -f "$FC_DIR/jailer-${FC_VERSION}-${FC_ARCH}" ]; then
    cp "$FC_DIR/jailer-${FC_VERSION}-${FC_ARCH}" "$INSTALL_DIR/jailer"
    chmod +x "$INSTALL_DIR/jailer"
    echo "  Installed: jailer"
fi

# Verify installation
echo ""
echo "Verifying installation..."
if "$INSTALL_DIR/firecracker" --version &> /dev/null; then
    FC_INSTALLED_VERSION=$("$INSTALL_DIR/firecracker" --version 2>&1 | head -1)
    echo "Firecracker installed successfully: $FC_INSTALLED_VERSION"
else
    echo "Warning: Could not verify Firecracker installation"
fi

# Check KVM permissions
echo ""
echo "Checking KVM permissions..."
if [ -e /dev/kvm ]; then
    KVM_GROUP=$(stat -c '%G' /dev/kvm)
    if groups | grep -qw "$KVM_GROUP"; then
        echo "Current user has KVM access (group: $KVM_GROUP)"
    else
        echo "Warning: Current user is not in the '$KVM_GROUP' group"
        echo "Run: sudo usermod -aG $KVM_GROUP \$USER"
        echo "Then log out and back in"
    fi
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Firecracker binary: $INSTALL_DIR/firecracker"
echo "Jailer binary: $INSTALL_DIR/jailer"
echo ""
echo "Next steps:"
echo "1. Ensure you have KVM access: ls -la /dev/kvm"
echo "2. Prepare a guest image: ./scripts/prepare-fc-image.sh"
echo "3. Start using Firecracker VMs via the API"
