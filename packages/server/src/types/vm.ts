/**
 * Virtual Machine Types for Cloud-Hypervisor Integration
 */

import { z } from 'zod';

export type VmStatus = 'creating' | 'booting' | 'running' | 'paused' | 'stopped' | 'error';

export type NetworkMode = 'tap' | 'bridge' | 'user' | 'none';

export interface PortMapping {
  container: number;
  host: number;
  protocol?: 'tcp' | 'udp';
}

export interface VolumeMount {
  name: string;
  hostPath: string;
  mountPath: string;
  readOnly?: boolean;
}

export interface ResourceConfig {
  vcpus: number; // 1-32 vCPUs
  memoryMb: number; // Memory in MB (512-65536)
  diskGb: number; // Virtual disk size in GB (1-1000)
}

export interface NetworkConfig {
  mode: NetworkMode;
  tapDevice?: string;
  bridgeName?: string;
  macAddress?: string;
  guestIp?: string;
  gateway?: string;
  dns?: string[];
}

export interface VmState {
  id: string;
  name: string;
  status: VmStatus;

  // Process info
  pid?: number;
  apiSocket?: string;

  // Network
  sshPort: number;
  guestIp?: string;
  networkConfig: NetworkConfig;
  portMappings: PortMapping[];

  // Resources
  baseImage: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;

  // Storage
  volumes: VolumeMount[];
  overlayPath?: string;

  // Timestamps
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;

  // Error handling
  error?: string;
}

export interface VmConfig {
  name: string;
  baseImage?: string;
  vcpus?: number;
  memoryMb?: number;
  diskGb?: number;
  portMappings?: PortMapping[];
  volumes?: VolumeMount[];
  networkMode?: NetworkMode;
  autoStart?: boolean;
}

export interface VmInfo {
  id: string;
  name: string;
  status: VmStatus;
  state: VmStatus; // Alias for UI compatibility

  // SSH access
  sshHost: string;
  sshPort: number;
  sshUser?: string;
  sshCommand?: string;

  // Network
  guestIp?: string;
  networkMode?: NetworkMode;
  ports: PortMapping[];
  volumes: VolumeMount[];

  // Resources
  image: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;

  // Timestamps
  createdAt: string;
  startedAt?: string;

  // Error
  error?: string;
}

export interface SnapshotInfo {
  id: string;
  vmId: string;
  baseImage: string;
  configPath: string;
  snapshotFile: string;
  memoryRanges: string[];
  createdAt: string;
  sizeBytes?: number;
}

export interface BaseImageInfo {
  name: string;
  virtualSizeGb: number;
  actualSizeMb: number;
  hasKernel: boolean;
  hasInitrd: boolean;
  hasWarmupSnapshot: boolean;
  createdAt: string;
  description?: string;
  parentImage?: string;
}

export interface VmStats {
  cpuUsage: number; // 0-100%
  memoryUsed: number; // MB
  memoryTotal: number; // MB
  diskUsed: number; // GB
  diskTotal: number; // GB
  networkRxBytes: number;
  networkTxBytes: number;
}

export interface HypervisorConfig {
  dataDir: string; // Base directory for VM data
  baseImagesDir: string; // Directory for base images
  sshKeysDir: string; // SSH keys directory
  hypervisorBinary: string; // Path to cloud-hypervisor binary
  kernelPath?: string; // Default kernel path
  initrdPath?: string; // Default initrd path
  sshPortRangeStart: number; // Start of SSH port range
  sshPortRangeEnd: number; // End of SSH port range
  defaultVcpus: number;
  defaultMemoryMb: number;
  defaultDiskGb: number;
  defaultBaseImage: string;
}

// Default configuration
export const DEFAULT_HYPERVISOR_CONFIG: HypervisorConfig = {
  dataDir: `${process.env.HOME}/.local/share/agentcontainers/vms`,
  baseImagesDir: `${process.env.HOME}/.local/share/agentcontainers/base-images`,
  sshKeysDir: `${process.env.HOME}/.local/share/agentcontainers/ssh-keys`,
  hypervisorBinary: '/usr/bin/cloud-hypervisor',
  sshPortRangeStart: 10022,
  sshPortRangeEnd: 10122,
  defaultVcpus: 1,
  defaultMemoryMb: 1024,
  defaultDiskGb: 5,
  defaultBaseImage: 'ubuntu-24.04',
};

// Zod schemas for validation
export const CreateVmSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'VM name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen'),
  baseImage: z.string().optional(),
  vcpus: z.number().min(1).max(32).optional(),
  memoryMb: z.number().min(512).max(65536).optional(),
  diskGb: z.number().min(1).max(1000).optional(),
  ports: z.array(z.object({
    container: z.number().min(1).max(65535),
    host: z.number().min(1).max(65535),
    protocol: z.enum(['tcp', 'udp']).optional(),
  })).optional(),
  volumes: z.array(z.object({
    name: z.string(),
    hostPath: z.string(),
    mountPath: z.string(),
    readOnly: z.boolean().optional(),
  })).optional(),
  autoStart: z.boolean().optional(),
});

export type CreateVmRequest = z.infer<typeof CreateVmSchema>;

// Warmup feature types
export type WarmupPhase =
  | 'idle'
  | 'starting'
  | 'booting'
  | 'waiting_for_boot'
  | 'pausing'
  | 'snapshotting'
  | 'complete'
  | 'error';

export interface WarmupStatus {
  baseImage: string;
  phase: WarmupPhase;
  progress: number; // 0-100
  message: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
