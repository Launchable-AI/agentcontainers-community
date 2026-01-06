/**
 * Firecracker Type Definitions
 * Types for the Firecracker microVM hypervisor integration
 */

import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Firecracker service configuration
 */
export interface FirecrackerConfig {
  /** Directory for Firecracker VM data */
  dataDir: string;
  /** Directory for base images (shared with cloud-hypervisor) */
  baseImagesDir: string;
  /** Directory for SSH keys (shared with cloud-hypervisor) */
  sshKeysDir: string;
  /** Path to firecracker binary */
  firecrackerBinary: string;
  /** Path to jailer binary (optional, for production) */
  jailerBinary?: string;
  /** SSH port range start */
  sshPortRangeStart: number;
  /** SSH port range end */
  sshPortRangeEnd: number;
  /** Default vCPUs for new VMs */
  defaultVcpus: number;
  /** Default memory in MB for new VMs */
  defaultMemoryMb: number;
  /** Default disk size in GB for new VMs */
  defaultDiskGb: number;
  /** Default base image name */
  defaultBaseImage: string;
}

/**
 * Default Firecracker configuration
 */
export const DEFAULT_FIRECRACKER_CONFIG: FirecrackerConfig = {
  dataDir: path.join(os.homedir(), '.local/share/agentcontainers/firecracker-vms'),
  baseImagesDir: path.join(os.homedir(), '.local/share/agentcontainers/base-images'),
  sshKeysDir: path.join(os.homedir(), '.local/share/agentcontainers/ssh-keys'),
  firecrackerBinary: '/usr/local/bin/firecracker',
  jailerBinary: '/usr/local/bin/jailer',
  sshPortRangeStart: 10122,  // Different range from cloud-hypervisor (10022-10122)
  sshPortRangeEnd: 10222,
  defaultVcpus: 1,
  defaultMemoryMb: 1024,
  defaultDiskGb: 5,
  defaultBaseImage: 'ubuntu-minimal-24.04',
};

// ============================================================================
// MMDS (MicroVM Metadata Service) Types
// ============================================================================

/**
 * MMDS network interface configuration
 */
export interface MmdsNetworkInterface {
  mac: string;
  ipv4: {
    address: string;
    netmask: string;
    gateway: string;
  };
  mtu?: number;
}

/**
 * MMDS metadata structure
 * This is what the guest queries from http://169.254.169.254
 */
export interface MmdsMetadata {
  /** Instance identity */
  instance: {
    id: string;
    name: string;
    hostname: string;
  };
  /** Network configuration */
  network: {
    interfaces: {
      [key: string]: MmdsNetworkInterface;  // e.g., "eth0"
    };
    dns?: string[];
  };
  /** SSH configuration */
  ssh: {
    authorized_keys: string[];
  };
  /** Custom user data (optional) */
  userData?: Record<string, unknown>;
}

/**
 * MMDS configuration for Firecracker API
 */
export interface MmdsConfig {
  /** Network interfaces that can access MMDS */
  network_interfaces: string[];
  /** MMDS version (V1 or V2) */
  version: 'V1' | 'V2';
  /** IPv4 address for MMDS (typically 169.254.169.254) */
  ipv4_address: string;
}

// ============================================================================
// Firecracker API Types
// ============================================================================

/**
 * Boot source configuration
 */
export interface BootSource {
  kernel_image_path: string;
  boot_args?: string;
  initrd_path?: string;
}

/**
 * Drive configuration
 */
export interface Drive {
  drive_id: string;
  path_on_host: string;
  is_root_device: boolean;
  is_read_only: boolean;
  partuuid?: string;
  rate_limiter?: RateLimiter;
  io_engine?: 'Sync' | 'Async';
}

/**
 * Network interface configuration
 */
export interface NetworkInterface {
  iface_id: string;
  host_dev_name: string;
  guest_mac?: string;
  rx_rate_limiter?: RateLimiter;
  tx_rate_limiter?: RateLimiter;
}

/**
 * Machine configuration
 */
export interface MachineConfig {
  vcpu_count: number;
  mem_size_mib: number;
  smt?: boolean;
  track_dirty_pages?: boolean;
  huge_pages?: 'None' | '2M' | '1G';
}

/**
 * Rate limiter configuration
 */
export interface RateLimiter {
  bandwidth?: TokenBucket;
  ops?: TokenBucket;
}

/**
 * Token bucket for rate limiting
 */
export interface TokenBucket {
  size: number;
  one_time_burst?: number;
  refill_time: number;
}

/**
 * VM state (for pause/resume)
 */
export type VmStateRequest = 'Paused' | 'Resumed';

/**
 * Instance action types
 */
export type InstanceActionType = 'InstanceStart' | 'SendCtrlAltDel' | 'FlushMetrics';

/**
 * Instance action request
 */
export interface InstanceAction {
  action_type: InstanceActionType;
}

/**
 * Snapshot creation request
 */
export interface SnapshotCreateParams {
  snapshot_type: 'Full' | 'Diff';
  snapshot_path: string;
  mem_file_path: string;
  version?: string;
}

/**
 * Memory backend for snapshot loading
 */
export interface MemoryBackend {
  backend_type: 'File' | 'Uffd';
  backend_path: string;
}

/**
 * Snapshot load request
 */
export interface SnapshotLoadParams {
  snapshot_path: string;
  mem_backend: MemoryBackend;
  enable_diff_snapshots?: boolean;
  resume_vm?: boolean;
}

/**
 * Vsock device configuration
 */
export interface Vsock {
  vsock_id: string;
  guest_cid: number;
  uds_path: string;
}

/**
 * Logger configuration
 */
export interface Logger {
  log_path: string;
  level?: 'Error' | 'Warning' | 'Info' | 'Debug';
  show_level?: boolean;
  show_log_origin?: boolean;
  module?: string;
}

/**
 * Metrics configuration
 */
export interface Metrics {
  metrics_path: string;
}

// ============================================================================
// Firecracker VM State (internal tracking)
// ============================================================================

/**
 * Firecracker VM runtime state
 */
export interface FirecrackerVmState {
  /** Unique VM identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Current status */
  status: 'creating' | 'booting' | 'running' | 'paused' | 'stopped' | 'error';
  /** Process ID of the Firecracker process */
  pid?: number;
  /** Path to API socket */
  apiSocket?: string;
  /** SSH port (for port forwarding mode) */
  sshPort: number;
  /** Guest IP address (for TAP mode) */
  guestIp?: string;
  /** Network configuration */
  networkConfig: {
    mode: 'tap' | 'none';
    tapDevice?: string;
    bridgeName?: string;
    macAddress?: string;
    guestIp?: string;
    gateway?: string;
  };
  /** Port mappings (for future use) */
  portMappings: Array<{ container: number; host: number; protocol?: 'tcp' | 'udp' }>;
  /** Base image name */
  baseImage: string;
  /** Number of vCPUs */
  vcpus: number;
  /** Memory in MB */
  memoryMb: number;
  /** Disk size in GB */
  diskGb: number;
  /** Volume mounts (for future use) */
  volumes: Array<{ name: string; hostPath: string; mountPath: string; readOnly?: boolean }>;
  /** Current MMDS metadata */
  mmdsMetadata?: MmdsMetadata;
  /** Source snapshot (if restored from snapshot) */
  sourceSnapshot?: {
    vmId: string;
    snapshotId: string;
    snapshotDir: string;
  };
  /** Timestamps */
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  /** Error message if status is 'error' */
  error?: string;
}

/**
 * Firecracker snapshot metadata
 */
export interface FirecrackerSnapshotInfo {
  id: string;
  vmId: string;
  name?: string;
  baseImage: string;
  /** Path to snapshot state file */
  snapshotPath: string;
  /** Path to memory file */
  memFilePath: string;
  /** Path to disk image */
  diskPath: string;
  /** MMDS metadata at snapshot time */
  mmdsMetadata: MmdsMetadata;
  /** Resource configuration */
  vcpus: number;
  memoryMb: number;
  diskGb: number;
  /** Creation timestamp */
  createdAt: string;
  /** Snapshot size in bytes */
  sizeBytes?: number;
  /** Whether this is the quick launch default */
  isQuickLaunchDefault?: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Firecracker API error response
 */
export interface FirecrackerError {
  fault_message: string;
}

/**
 * Instance info response
 */
export interface InstanceInfo {
  id: string;
  state: 'Not started' | 'Running' | 'Paused';
  vmm_version: string;
  app_name: string;
}

/**
 * Full VM description response
 */
export interface FullVmDescription {
  balloon?: unknown;
  drives: Drive[];
  machine_config: MachineConfig;
  mmds?: unknown;
  net_devices: NetworkInterface[];
  vsock?: Vsock;
}
