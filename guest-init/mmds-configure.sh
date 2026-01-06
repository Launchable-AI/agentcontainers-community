#!/bin/bash
# MMDS Network Configuration Script for Firecracker VMs
# Runs on every boot via systemd (Before=network-pre.target)
#
# This script queries the MMDS (MicroVM Metadata Service) at 169.254.169.254
# and configures the network interface based on the metadata.
#
# This is the KEY feature that enables golden snapshot restore - on restore,
# the host updates MMDS with new identity before resuming, and this script
# automatically reconfigures the guest's network.

set -e

LOG="/var/log/mmds-configure.log"
MMDS_IP="169.254.169.254"
MMDS_TOKEN_TTL=300
INTERFACE="eth0"
MAX_RETRIES=30
RETRY_DELAY=0.5

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

# Get MMDS token (v2 authentication)
get_token() {
    local token
    for i in $(seq 1 $MAX_RETRIES); do
        token=$(curl -s -X PUT "http://${MMDS_IP}/latest/api/token" \
            -H "X-metadata-token-ttl-seconds: ${MMDS_TOKEN_TTL}" 2>/dev/null || true)
        if [ -n "$token" ]; then
            echo "$token"
            return 0
        fi
        sleep "$RETRY_DELAY"
    done
    return 1
}

# Fetch metadata from MMDS
get_metadata() {
    local path="$1"
    local token="$2"
    curl -s "http://${MMDS_IP}${path}" -H "X-metadata-token: ${token}" 2>/dev/null
}

log "Starting MMDS network configuration"

# Wait for MMDS to be available and get token
log "Waiting for MMDS..."
TOKEN=$(get_token)
if [ -z "$TOKEN" ]; then
    log "ERROR: Failed to get MMDS token after $MAX_RETRIES retries"
    exit 1
fi
log "Got MMDS token"

# Fetch network configuration
NET_JSON=$(get_metadata "/network/interfaces/${INTERFACE}" "$TOKEN")
if [ -z "$NET_JSON" ] || [ "$NET_JSON" = "null" ]; then
    log "ERROR: Failed to fetch network config from MMDS"
    exit 1
fi

log "Network config: $NET_JSON"

# Parse network configuration
MAC=$(echo "$NET_JSON" | jq -r '.mac // empty')
IP=$(echo "$NET_JSON" | jq -r '.ipv4.address // empty')
NETMASK=$(echo "$NET_JSON" | jq -r '.ipv4.netmask // "255.255.255.0"')
GATEWAY=$(echo "$NET_JSON" | jq -r '.ipv4.gateway // empty')

if [ -z "$IP" ] || [ -z "$GATEWAY" ]; then
    log "ERROR: Missing IP or gateway in MMDS config"
    exit 1
fi

# Convert netmask to CIDR prefix length
netmask_to_cidr() {
    local netmask="$1"
    case "$netmask" in
        "255.255.255.0") echo "24" ;;
        "255.255.0.0") echo "16" ;;
        "255.0.0.0") echo "8" ;;
        "255.255.255.128") echo "25" ;;
        "255.255.255.192") echo "26" ;;
        "255.255.255.224") echo "27" ;;
        "255.255.255.240") echo "28" ;;
        *) echo "24" ;;  # Default to /24
    esac
}

CIDR=$(netmask_to_cidr "$NETMASK")

log "Configuring interface $INTERFACE: MAC=$MAC, IP=$IP/$CIDR, GW=$GATEWAY"

# Bring interface down
ip link set "$INTERFACE" down 2>/dev/null || true

# Set MAC address if provided and different from current
if [ -n "$MAC" ]; then
    CURRENT_MAC=$(cat /sys/class/net/${INTERFACE}/address 2>/dev/null || true)
    if [ "$MAC" != "$CURRENT_MAC" ]; then
        log "Setting MAC from $CURRENT_MAC to $MAC"
        ip link set "$INTERFACE" address "$MAC"
    fi
fi

# Flush existing IP configuration
ip addr flush dev "$INTERFACE" 2>/dev/null || true

# Add new IP address
ip addr add "${IP}/${CIDR}" dev "$INTERFACE"

# Bring interface up
ip link set "$INTERFACE" up

# Wait briefly for interface to be ready
sleep 0.2

# Remove default route if exists
ip route del default 2>/dev/null || true

# Add default route
ip route add default via "$GATEWAY"

log "Network configured successfully"

# Fetch and set hostname
HOSTNAME_JSON=$(get_metadata "/instance/hostname" "$TOKEN")
if [ -n "$HOSTNAME_JSON" ] && [ "$HOSTNAME_JSON" != "null" ]; then
    # Remove quotes if present
    NEW_HOSTNAME=$(echo "$HOSTNAME_JSON" | tr -d '"')
    if [ -n "$NEW_HOSTNAME" ]; then
        CURRENT_HOSTNAME=$(hostname)
        if [ "$NEW_HOSTNAME" != "$CURRENT_HOSTNAME" ]; then
            log "Setting hostname from $CURRENT_HOSTNAME to $NEW_HOSTNAME"
            hostnamectl set-hostname "$NEW_HOSTNAME" 2>/dev/null || hostname "$NEW_HOSTNAME"

            # Update /etc/hosts
            sed -i "s/127.0.1.1.*/127.0.1.1 $NEW_HOSTNAME/" /etc/hosts 2>/dev/null || true
        fi
    fi
fi

# Fetch and update SSH keys
SSH_KEYS=$(get_metadata "/ssh/authorized_keys" "$TOKEN")
if [ -n "$SSH_KEYS" ] && [ "$SSH_KEYS" != "null" ]; then
    log "Updating SSH authorized_keys"

    # Create agent user if doesn't exist
    if ! id -u agent >/dev/null 2>&1; then
        useradd -m -s /bin/bash agent
        echo "agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/agent
    fi

    # Set up SSH directory
    mkdir -p /home/agent/.ssh
    chmod 700 /home/agent/.ssh

    # Write authorized_keys (parse JSON array)
    echo "$SSH_KEYS" | jq -r '.[]' > /home/agent/.ssh/authorized_keys 2>/dev/null || \
        echo "$SSH_KEYS" > /home/agent/.ssh/authorized_keys

    chmod 600 /home/agent/.ssh/authorized_keys
    chown -R agent:agent /home/agent/.ssh
fi

# Fetch DNS configuration
DNS_JSON=$(get_metadata "/network/dns" "$TOKEN")
if [ -n "$DNS_JSON" ] && [ "$DNS_JSON" != "null" ] && [ "$DNS_JSON" != "[]" ]; then
    log "Configuring DNS"

    # Parse DNS servers and write to resolv.conf
    echo "# Generated by MMDS configure script" > /etc/resolv.conf.new
    echo "$DNS_JSON" | jq -r '.[]' 2>/dev/null | while read -r dns; do
        echo "nameserver $dns" >> /etc/resolv.conf.new
    done

    if [ -s /etc/resolv.conf.new ]; then
        mv /etc/resolv.conf.new /etc/resolv.conf
    else
        rm -f /etc/resolv.conf.new
    fi
fi

log "MMDS configuration complete"

# Verify connectivity
if ping -c 1 -W 2 "$GATEWAY" >/dev/null 2>&1; then
    log "Gateway reachable - network is working"
else
    log "WARNING: Gateway not reachable - network may have issues"
fi

exit 0
