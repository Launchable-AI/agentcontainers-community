#!/bin/bash
# Agent Containers VM Setup Script
# Run with: sudo ./scripts/setup-vm-network.sh
#
# This script sets up everything needed for VM support:
# - Installs cloud-hypervisor binary
# - Installs required tools (qemu-img, genisoimage)
# - Downloads Ubuntu 24.04 base image with kernel/initrd
# - Creates network infrastructure (bridge, TAP devices, DHCP)

set -e

# Configuration
BRIDGE_NAME="${BRIDGE_NAME:-agentc-br0}"
SUBNET="${SUBNET:-172.31.0.0/24}"
GATEWAY="${GATEWAY:-172.31.0.1}"
TAP_COUNT="${TAP_COUNT:-16}"
DATA_DIR="${DATA_DIR:-$HOME/.local/share/agentcontainers}"
CONFIG_FILE="$DATA_DIR/network.json"
CLOUD_HYPERVISOR_VERSION="${CLOUD_HYPERVISOR_VERSION:-v43.0}"
BASE_IMAGE_NAME="${BASE_IMAGE_NAME:-ubuntu-24.04}"

# Flags
SKIP_HYPERVISOR=false
SKIP_IMAGE=false
SKIP_NETWORK=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-hypervisor)
            SKIP_HYPERVISOR=true
            shift
            ;;
        --skip-image)
            SKIP_IMAGE=true
            shift
            ;;
        --skip-network)
            SKIP_NETWORK=true
            shift
            ;;
        -h|--help)
            echo "Agent Containers VM Setup Script"
            echo ""
            echo "Usage: sudo $0 [options]"
            echo ""
            echo "Options:"
            echo "  --skip-hypervisor   Skip cloud-hypervisor installation"
            echo "  --skip-image        Skip base image download"
            echo "  --skip-network      Skip network setup"
            echo "  -h, --help          Show this help message"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get real user (not root when running with sudo)
if [ -n "$SUDO_USER" ]; then
    REAL_USER="$SUDO_USER"
    REAL_UID=$(id -u "$SUDO_USER")
    REAL_GID=$(id -g "$SUDO_USER")
    REAL_HOME=$(eval echo "~$SUDO_USER")
else
    REAL_USER="$USER"
    REAL_UID=$(id -u)
    REAL_GID=$(id -g)
    REAL_HOME="$HOME"
fi

# Update DATA_DIR with real home
DATA_DIR="$REAL_HOME/.local/share/agentcontainers"
CONFIG_FILE="$DATA_DIR/network.json"
BASE_IMAGES_DIR="$DATA_DIR/base-images"

echo -e "${CYAN}"
echo "=============================================="
echo "  Agent Containers VM Setup"
echo "=============================================="
echo -e "${NC}"
echo "User:       $REAL_USER (UID=$REAL_UID, GID=$REAL_GID)"
echo "Data Dir:   $DATA_DIR"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run with sudo${NC}"
    echo "Usage: sudo $0"
    exit 1
fi

# Create data directories
echo -e "${CYAN}Creating data directories...${NC}"
mkdir -p "$DATA_DIR"
mkdir -p "$DATA_DIR/vms"
mkdir -p "$DATA_DIR/ssh-keys"
mkdir -p "$BASE_IMAGES_DIR"
chown -R "$REAL_UID:$REAL_GID" "$DATA_DIR"
echo -e "${GREEN}✓ Data directories created${NC}"

# ============================================
# SECTION 1: Install cloud-hypervisor
# ============================================
install_cloud_hypervisor() {
    if [ "$SKIP_HYPERVISOR" = true ]; then
        echo -e "${YELLOW}Skipping cloud-hypervisor installation${NC}"
        return
    fi

    echo ""
    echo -e "${CYAN}--- Installing cloud-hypervisor ---${NC}"

    # Check if already installed
    if command -v cloud-hypervisor &> /dev/null; then
        INSTALLED_VERSION=$(cloud-hypervisor --version 2>/dev/null | head -1 || echo "unknown")
        echo -e "${GREEN}✓ cloud-hypervisor already installed: $INSTALLED_VERSION${NC}"
        return
    fi

    echo "Downloading cloud-hypervisor $CLOUD_HYPERVISOR_VERSION..."

    # Detect architecture
    ARCH=$(uname -m)
    case $ARCH in
        x86_64)
            CH_ARCH="x86_64"
            ;;
        aarch64)
            CH_ARCH="aarch64"
            ;;
        *)
            echo -e "${RED}Unsupported architecture: $ARCH${NC}"
            exit 1
            ;;
    esac

    CH_URL="https://github.com/cloud-hypervisor/cloud-hypervisor/releases/download/${CLOUD_HYPERVISOR_VERSION}/cloud-hypervisor-static"

    wget -q --show-progress -O /tmp/cloud-hypervisor "$CH_URL"
    chmod +x /tmp/cloud-hypervisor
    mv /tmp/cloud-hypervisor /usr/local/bin/cloud-hypervisor

    echo -e "${GREEN}✓ cloud-hypervisor installed to /usr/local/bin/cloud-hypervisor${NC}"
}

# ============================================
# SECTION 2: Install required tools
# ============================================
install_tools() {
    echo ""
    echo -e "${CYAN}--- Installing required tools ---${NC}"

    MISSING_PKGS=""

    # Check for required commands
    if ! command -v qemu-img &> /dev/null; then
        MISSING_PKGS="$MISSING_PKGS qemu-utils"
    fi
    if ! command -v genisoimage &> /dev/null; then
        MISSING_PKGS="$MISSING_PKGS genisoimage"
    fi
    if ! command -v ip &> /dev/null; then
        MISSING_PKGS="$MISSING_PKGS iproute2"
    fi
    if ! command -v nft &> /dev/null; then
        MISSING_PKGS="$MISSING_PKGS nftables"
    fi
    if ! command -v dnsmasq &> /dev/null; then
        MISSING_PKGS="$MISSING_PKGS dnsmasq"
    fi
    if ! command -v jq &> /dev/null; then
        MISSING_PKGS="$MISSING_PKGS jq"
    fi
    if ! command -v wget &> /dev/null; then
        MISSING_PKGS="$MISSING_PKGS wget"
    fi
    if ! command -v virt-copy-out &> /dev/null; then
        MISSING_PKGS="$MISSING_PKGS libguestfs-tools"
    fi

    if [ -n "$MISSING_PKGS" ]; then
        echo "Installing:$MISSING_PKGS"
        apt-get update -qq
        apt-get install -y -qq $MISSING_PKGS
    fi

    echo -e "${GREEN}✓ All required tools installed${NC}"
}

# ============================================
# SECTION 3: Download base image
# ============================================
download_base_image() {
    if [ "$SKIP_IMAGE" = true ]; then
        echo -e "${YELLOW}Skipping base image download${NC}"
        return
    fi

    echo ""
    echo -e "${CYAN}--- Downloading Ubuntu 24.04 base image ---${NC}"

    IMAGE_DIR="$BASE_IMAGES_DIR/$BASE_IMAGE_NAME"
    mkdir -p "$IMAGE_DIR"

    # Check if image already exists
    if [ -f "$IMAGE_DIR/image.qcow2" ] && [ -f "$IMAGE_DIR/kernel" ] && [ -f "$IMAGE_DIR/initrd" ]; then
        echo -e "${GREEN}✓ Base image already exists at $IMAGE_DIR${NC}"
        chown -R "$REAL_UID:$REAL_GID" "$IMAGE_DIR"
        return
    fi

    # Download Ubuntu 24.04 cloud image
    UBUNTU_URL="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"

    if [ ! -f "$IMAGE_DIR/image.qcow2" ]; then
        echo "Downloading Ubuntu 24.04 cloud image..."
        wget -q --show-progress -O "$IMAGE_DIR/ubuntu-cloud.img" "$UBUNTU_URL"

        echo "Converting to QCOW2 format..."
        qemu-img convert -f qcow2 -O qcow2 "$IMAGE_DIR/ubuntu-cloud.img" "$IMAGE_DIR/image.qcow2"

        # Resize to 10GB minimum for cloud-hypervisor
        qemu-img resize "$IMAGE_DIR/image.qcow2" 10G

        rm -f "$IMAGE_DIR/ubuntu-cloud.img"
        echo -e "${GREEN}✓ Base image downloaded${NC}"
    fi

    # Extract kernel and initrd from the image
    if [ ! -f "$IMAGE_DIR/kernel" ] || [ ! -f "$IMAGE_DIR/initrd" ]; then
        echo "Extracting kernel and initrd from image..."

        # Create a temporary directory for extraction
        EXTRACT_DIR=$(mktemp -d)

        # Use libguestfs to extract kernel and initrd
        # The kernel is typically at /boot/vmlinuz-* and initrd at /boot/initrd.img-*
        virt-copy-out -a "$IMAGE_DIR/image.qcow2" /boot "$EXTRACT_DIR" 2>/dev/null || {
            echo -e "${RED}Failed to extract /boot from image${NC}"
            echo "Trying alternative extraction method..."

            # Alternative: mount the image and copy files
            MOUNT_DIR=$(mktemp -d)
            LOOP_DEV=$(losetup --find --show -P "$IMAGE_DIR/image.qcow2" 2>/dev/null) || {
                # For qcow2, we need to use qemu-nbd
                modprobe nbd max_part=8
                qemu-nbd --connect=/dev/nbd0 "$IMAGE_DIR/image.qcow2"
                sleep 2
                LOOP_DEV="/dev/nbd0p1"
            }

            mount "$LOOP_DEV" "$MOUNT_DIR" 2>/dev/null || mount "${LOOP_DEV}p1" "$MOUNT_DIR" 2>/dev/null || {
                echo -e "${RED}Failed to mount image for kernel extraction${NC}"
                echo "You may need to manually provide kernel and initrd files."
                rm -rf "$EXTRACT_DIR" "$MOUNT_DIR"
                if [[ "$LOOP_DEV" == /dev/nbd* ]]; then
                    qemu-nbd --disconnect /dev/nbd0
                else
                    losetup -d "$LOOP_DEV" 2>/dev/null || true
                fi
                return
            }

            cp -r "$MOUNT_DIR/boot" "$EXTRACT_DIR/"
            umount "$MOUNT_DIR"
            if [[ "$LOOP_DEV" == /dev/nbd* ]]; then
                qemu-nbd --disconnect /dev/nbd0
            else
                losetup -d "$LOOP_DEV" 2>/dev/null || true
            fi
            rm -rf "$MOUNT_DIR"
        }

        # Find and copy the latest kernel
        KERNEL_FILE=$(ls -t "$EXTRACT_DIR/boot"/vmlinuz-* 2>/dev/null | head -1)
        INITRD_FILE=$(ls -t "$EXTRACT_DIR/boot"/initrd.img-* 2>/dev/null | head -1)

        if [ -n "$KERNEL_FILE" ] && [ -f "$KERNEL_FILE" ]; then
            cp "$KERNEL_FILE" "$IMAGE_DIR/kernel"
            echo -e "${GREEN}✓ Kernel extracted: $(basename $KERNEL_FILE)${NC}"
        else
            echo -e "${RED}Could not find kernel in image${NC}"
        fi

        if [ -n "$INITRD_FILE" ] && [ -f "$INITRD_FILE" ]; then
            cp "$INITRD_FILE" "$IMAGE_DIR/initrd"
            echo -e "${GREEN}✓ Initrd extracted: $(basename $INITRD_FILE)${NC}"
        else
            echo -e "${RED}Could not find initrd in image${NC}"
        fi

        rm -rf "$EXTRACT_DIR"
    fi

    # Set ownership
    chown -R "$REAL_UID:$REAL_GID" "$IMAGE_DIR"

    echo -e "${GREEN}✓ Base image ready at $IMAGE_DIR${NC}"
}

# ============================================
# SECTION 4: Network setup
# ============================================
setup_network() {
    if [ "$SKIP_NETWORK" = true ]; then
        echo -e "${YELLOW}Skipping network setup${NC}"
        return
    fi

    echo ""
    echo -e "${CYAN}--- Setting up VM network ---${NC}"
    echo "Bridge:     $BRIDGE_NAME"
    echo "Subnet:     $SUBNET"
    echo "Gateway:    $GATEWAY"
    echo "TAP Count:  $TAP_COUNT"

    # Create or recreate bridge
    echo "Setting up bridge $BRIDGE_NAME..."
    if ip link show "$BRIDGE_NAME" &> /dev/null; then
        echo "  Bridge exists, reconfiguring..."
        ip addr flush dev "$BRIDGE_NAME" 2>/dev/null || true
    else
        echo "  Creating bridge..."
        ip link add "$BRIDGE_NAME" type bridge
    fi
    ip addr add "$GATEWAY/24" dev "$BRIDGE_NAME" 2>/dev/null || true
    ip link set "$BRIDGE_NAME" up
    echo -e "${GREEN}✓ Bridge configured${NC}"

    # Create TAP devices
    echo "Creating $TAP_COUNT TAP devices..."
    TAP_JSON="["
    for i in $(seq 0 $((TAP_COUNT - 1))); do
        TAP_NAME="agentc-tap$i"
        GUEST_IP="172.31.0.$((i + 2))"
        MAC_ADDR=$(printf "52:54:00:01:00:%02x" $i)

        # Delete if exists
        ip link delete "$TAP_NAME" 2>/dev/null || true

        # Create TAP owned by user
        ip tuntap add dev "$TAP_NAME" mode tap user "$REAL_UID" group "$REAL_GID"
        ip link set "$TAP_NAME" master "$BRIDGE_NAME"
        ip link set "$TAP_NAME" up

        echo "  Created $TAP_NAME (IP: $GUEST_IP, MAC: $MAC_ADDR)"

        # Build JSON
        if [ $i -gt 0 ]; then
            TAP_JSON="$TAP_JSON,"
        fi
        TAP_JSON="$TAP_JSON
        {
          \"name\": \"$TAP_NAME\",
          \"allocated\": false,
          \"allocatedTo\": null,
          \"guestIp\": \"$GUEST_IP\",
          \"macAddress\": \"$MAC_ADDR\"
        }"
    done
    TAP_JSON="$TAP_JSON
      ]"
    echo -e "${GREEN}✓ TAP devices created${NC}"

    # Enable IP forwarding
    echo "Enabling IP forwarding..."
    sysctl -w net.ipv4.ip_forward=1 > /dev/null
    if ! grep -q "net.ipv4.ip_forward=1" /etc/sysctl.conf 2>/dev/null; then
        echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
    fi
    echo -e "${GREEN}✓ IP forwarding enabled${NC}"

    # Setup nftables rules
    echo "Configuring firewall (nftables)..."
    nft delete table ip agentcontainers 2>/dev/null || true

    nft add table ip agentcontainers
    nft add chain ip agentcontainers postrouting "{ type nat hook postrouting priority 100 ; }"
    nft add rule ip agentcontainers postrouting ip saddr "$SUBNET" oifname != "$BRIDGE_NAME" masquerade

    nft add chain ip agentcontainers forward "{ type filter hook forward priority 0 ; policy drop ; }"
    # Allow VM bridge traffic
    nft add rule ip agentcontainers forward iifname "$BRIDGE_NAME" ct state established,related accept
    nft add rule ip agentcontainers forward iifname "$BRIDGE_NAME" oifname != "$BRIDGE_NAME" accept
    nft add rule ip agentcontainers forward oifname "$BRIDGE_NAME" ct state established,related accept
    nft add rule ip agentcontainers forward iifname "$BRIDGE_NAME" accept
    # Allow Docker bridge traffic (docker0)
    nft add rule ip agentcontainers forward iifname "docker0" accept
    nft add rule ip agentcontainers forward oifname "docker0" ct state established,related accept
    echo -e "${GREEN}✓ Firewall configured${NC}"

    # Setup dnsmasq for DHCP
    echo "Configuring DHCP (dnsmasq)..."
    DNSMASQ_CONF="$DATA_DIR/dnsmasq.conf"
    DHCP_START="172.31.0.2"
    DHCP_END="172.31.0.$((TAP_COUNT + 1))"

    cat > "$DNSMASQ_CONF" << EOF
# Agent Containers VM network - auto-generated
# Do not edit manually

# Only listen on the bridge interface
interface=$BRIDGE_NAME
bind-interfaces

# Disable DNS (we only need DHCP)
port=0

# DHCP configuration
dhcp-range=$DHCP_START,$DHCP_END,255.255.255.0,12h
dhcp-option=option:router,$GATEWAY
dhcp-option=option:dns-server,8.8.8.8,8.8.4.4

# Static DHCP reservations (MAC -> IP mappings)
EOF

    for i in $(seq 0 $((TAP_COUNT - 1))); do
        MAC_ADDR=$(printf "52:54:00:01:00:%02x" $i)
        GUEST_IP="172.31.0.$((i + 2))"
        echo "dhcp-host=$MAC_ADDR,$GUEST_IP" >> "$DNSMASQ_CONF"
    done

    cat >> "$DNSMASQ_CONF" << EOF

# Lease settings
dhcp-lease-max=$((TAP_COUNT + 10))

# PID file
pid-file=/run/agentcontainers-dnsmasq.pid

# Log file
log-facility=$DATA_DIR/dnsmasq.log
EOF

    chown "$REAL_UID:$REAL_GID" "$DNSMASQ_CONF"

    # Stop any existing agentcontainers dnsmasq
    pkill -f "agentcontainers.*dnsmasq" 2>/dev/null || true
    pkill -f "dnsmasq.*agentc-br0" 2>/dev/null || true
    sleep 1

    # Start dnsmasq
    dnsmasq --conf-file="$DNSMASQ_CONF"
    echo -e "${GREEN}✓ DHCP server started${NC}"

    # Save network configuration
    echo "Saving network configuration..."

    # Get absolute path to this script for restoration
    SETUP_SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

    cat > "$CONFIG_FILE" << EOF
{
  "bridgeName": "$BRIDGE_NAME",
  "subnet": "$SUBNET",
  "gateway": "$GATEWAY",
  "tapDevices": $TAP_JSON,
  "ownerUid": $REAL_UID,
  "ownerGid": $REAL_GID,
  "setupScriptPath": "$SETUP_SCRIPT_PATH",
  "createdAt": "$(date -Iseconds)"
}
EOF

    chown "$REAL_UID:$REAL_GID" "$CONFIG_FILE"
    echo -e "${GREEN}✓ Configuration saved${NC}"

    # Create systemd service for auto-restore on boot
    echo "Creating systemd service for auto-restore on boot..."
    cat > /etc/systemd/system/agentcontainers-network.service << EOF
[Unit]
Description=Agent Containers VM Network and DHCP Server
After=network-online.target
Wants=network-online.target
Before=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$DATA_DIR/restore-network.sh
ExecStop=/bin/bash -c 'pkill -f "dnsmasq.*agentc" || true; ip link delete $BRIDGE_NAME 2>/dev/null || true'
WorkingDirectory=$DATA_DIR
Restart=on-failure
RestartSec=5s
TimeoutStartSec=60s

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd and enable service
    systemctl daemon-reload
    systemctl enable agentcontainers-network.service
    echo -e "${GREEN}✓ Systemd service created and enabled${NC}"

    # Create a restore script
    cat > "$DATA_DIR/restore-network.sh" << 'RESTORE_EOF'
#!/bin/bash
# Restore network after reboot
# Run with: sudo ./restore-network.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/network.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: No network config found at $CONFIG_FILE"
    exit 1
fi

# Check for jq
if ! command -v jq &> /dev/null; then
    echo "ERROR: jq is required. Install with: sudo apt-get install jq"
    exit 1
fi

# Read configuration
BRIDGE_NAME=$(jq -r '.bridgeName' "$CONFIG_FILE")
SUBNET=$(jq -r '.subnet' "$CONFIG_FILE")
GATEWAY=$(jq -r '.gateway' "$CONFIG_FILE")
TAP_COUNT=$(jq '.tapDevices | length' "$CONFIG_FILE")
SETUP_SCRIPT=$(jq -r '.setupScriptPath // empty' "$CONFIG_FILE")

# Fallback for backward compatibility
if [ -z "$SETUP_SCRIPT" ]; then
    SETUP_SCRIPT="$(dirname "$SCRIPT_DIR")/scripts/setup-vm-network.sh"
fi

if [ ! -f "$SETUP_SCRIPT" ]; then
    echo "ERROR: Setup script not found at $SETUP_SCRIPT"
    exit 1
fi

# Export variables and run setup (network only on restore)
export BRIDGE_NAME SUBNET GATEWAY TAP_COUNT DATA_DIR="$SCRIPT_DIR"
exec "$SETUP_SCRIPT" --skip-hypervisor --skip-image
RESTORE_EOF

    chmod +x "$DATA_DIR/restore-network.sh"
    chown "$REAL_UID:$REAL_GID" "$DATA_DIR/restore-network.sh"
}

# ============================================
# Main execution
# ============================================
install_cloud_hypervisor
install_tools
download_base_image
setup_network

echo ""
echo -e "${GREEN}=============================================="
echo "  VM Setup Complete!"
echo "==============================================${NC}"
echo ""
echo "Components installed:"
if [ "$SKIP_HYPERVISOR" != true ]; then
    echo "  ✓ cloud-hypervisor: $(cloud-hypervisor --version 2>/dev/null | head -1 || echo 'installed')"
fi
if [ "$SKIP_IMAGE" != true ]; then
    echo "  ✓ Base image: $BASE_IMAGES_DIR/$BASE_IMAGE_NAME"
fi
if [ "$SKIP_NETWORK" != true ]; then
    echo "  ✓ Network bridge: $BRIDGE_NAME"
    echo "  ✓ TAP devices: $TAP_COUNT available"
    echo "  ✓ DHCP server: running"
fi
echo ""
echo "Network will automatically restore on boot via systemd."
echo ""
echo "To manually restore network:"
echo "  sudo $DATA_DIR/restore-network.sh"
echo ""
echo "To check service status:"
echo "  sudo systemctl status agentcontainers-network"
echo ""
echo "To disable auto-restore:"
echo "  sudo systemctl disable agentcontainers-network"
echo ""
