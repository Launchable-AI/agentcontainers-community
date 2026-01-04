/**
 * HypervisorService - Cloud-Hypervisor VM Management
 * Manages virtual machines using cloud-hypervisor for the Agent Containers platform.
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as crypto from 'crypto';
import {
  VmState,
  VmStatus,
  VmConfig,
  VmInfo,
  SnapshotInfo,
  HypervisorConfig,
  DEFAULT_HYPERVISOR_CONFIG,
  WarmupPhase,
  WarmupStatus,
} from '../types/vm.js';
import { NetworkPool, TapAllocation, NetworkStatus } from './network-pool.js';
import { getConfig } from './config.js';

export class HypervisorService extends EventEmitter {
  private config: HypervisorConfig;
  private vms: Map<string, VmState> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private allocatedPorts: Set<number> = new Set();
  private initialized: boolean = false;
  private networkPool: NetworkPool;
  private networkStatus: NetworkStatus | null = null;
  private warmupStatus: Map<string, WarmupStatus> = new Map();

  constructor(config: Partial<HypervisorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_HYPERVISOR_CONFIG, ...config };

    // Initialize network pool with parent data directory
    const dataDir = path.dirname(this.config.dataDir);
    this.networkPool = new NetworkPool(dataDir);
  }

  /**
   * Initialize the hypervisor service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[HypervisorService] Initializing...');

    // Create required directories
    await this.ensureDirectories();

    // Check for cloud-hypervisor binary
    await this.checkHypervisorBinary();

    // Generate SSH keys if needed
    await this.ensureSshKeys();

    // Load existing VM states from disk
    await this.loadVmStates();

    // Sync VM states with running processes
    await this.syncVmStates();

    // Check network health
    this.checkNetworkHealth();

    // Ensure base images are properly sized for QCOW2 overlays
    await this.ensureBaseImageSizes();

    this.initialized = true;
    console.log(`[HypervisorService] Initialized with ${this.vms.size} VMs`);

    this.emit('hypervisor:initialized', { networkStatus: this.networkStatus });

    // Pre-emptively warmup default base image in background if not already done
    this.preemptiveWarmup();
  }

  /**
   * Check network health and warn if not configured
   */
  private checkNetworkHealth(): void {
    this.networkStatus = this.networkPool.checkHealth();

    if (!this.networkStatus.configured) {
      console.warn('\n' + '='.repeat(60));
      console.warn('WARNING: VM networking is not configured!');
      console.warn('VMs will boot but will not have network connectivity.');
      console.warn('\nTo enable networking, run:');
      console.warn('  sudo ./scripts/setup-vm-network.sh');
      console.warn('='.repeat(60) + '\n');
    } else if (!this.networkStatus.healthy) {
      console.warn('\n' + '='.repeat(60));
      console.warn('WARNING: VM network devices are missing!');
      console.warn('This can happen after a system reboot.');
      console.warn('\nTo restore networking, run:');
      console.warn('  sudo ./scripts/setup-vm-network.sh');
      console.warn('='.repeat(60) + '\n');
    } else {
      console.log(`[HypervisorService] Network health: ${this.networkStatus.availableTaps} TAPs available`);

      // Clean up stale allocations
      const activeVmIds = Array.from(this.vms.keys());
      this.networkPool.cleanupStale(activeVmIds);
    }
  }

  /**
   * Ensure base images are sized for QCOW2 overlays
   */
  private async ensureBaseImageSizes(): Promise<void> {
    const MIN_BASE_SIZE_GB = 25;
    const baseImagesDir = this.config.baseImagesDir;

    if (!fs.existsSync(baseImagesDir)) {
      return;
    }

    const entries = fs.readdirSync(baseImagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const imagePath = path.join(baseImagesDir, entry.name, 'image.qcow2');
      if (!fs.existsSync(imagePath)) continue;

      try {
        // Get current virtual size using qemu-img info
        const output = execSync(`qemu-img info --output=json ${imagePath}`, { encoding: 'utf-8' });
        const info = JSON.parse(output);
        const currentSizeGB = info['virtual-size'] / (1024 * 1024 * 1024);

        if (currentSizeGB < MIN_BASE_SIZE_GB) {
          console.log(`[HypervisorService] Resizing base image ${entry.name} to ${MIN_BASE_SIZE_GB}GB`);
          execSync(`qemu-img resize ${imagePath} ${MIN_BASE_SIZE_GB}G`);
        }
      } catch (error) {
        console.warn(`[HypervisorService] Failed to check/resize base image ${entry.name}:`, error);
      }
    }
  }

  /**
   * Get current network status
   */
  getNetworkStatus(): NetworkStatus {
    if (!this.networkStatus) {
      this.networkStatus = this.networkPool.checkHealth();
    }
    return this.networkStatus;
  }

  /**
   * Get warmup status for a base image
   */
  getWarmupStatus(baseImage: string): WarmupStatus {
    const status = this.warmupStatus.get(baseImage);
    if (status) {
      return status;
    }

    if (this.hasWarmupSnapshot(baseImage)) {
      return {
        baseImage,
        phase: 'complete',
        progress: 100,
        message: 'Warmup snapshot ready',
      };
    }

    return {
      baseImage,
      phase: 'idle',
      progress: 0,
      message: 'Not warmed up',
    };
  }

  /**
   * Update warmup status and emit event
   */
  private updateWarmupStatus(
    baseImage: string,
    phase: WarmupPhase,
    progress: number,
    message: string,
    error?: string
  ): void {
    const status: WarmupStatus = {
      baseImage,
      phase,
      progress,
      message,
      startedAt: this.warmupStatus.get(baseImage)?.startedAt,
      completedAt: phase === 'complete' || phase === 'error' ? new Date().toISOString() : undefined,
      error,
    };

    if (phase === 'starting') {
      status.startedAt = new Date().toISOString();
    }

    this.warmupStatus.set(baseImage, status);
    this.emit('warmup:progress', status);
  }

  /**
   * Pre-emptively warmup default base image
   */
  private async preemptiveWarmup(): Promise<void> {
    const baseImage = this.config.defaultBaseImage;
    const baseImageDir = path.join(this.config.baseImagesDir, baseImage);
    const baseImagePath = path.join(baseImageDir, 'image.qcow2');

    if (!fs.existsSync(baseImagePath)) {
      console.log(`[HypervisorService] No base image found at ${baseImagePath}, skipping warmup`);
      return;
    }

    if (this.hasWarmupSnapshot(baseImage)) {
      console.log(`[HypervisorService] Warmup snapshot already exists for ${baseImage}`);
      return;
    }

    console.log(`[HypervisorService] Starting preemptive warmup for ${baseImage}`);
    this.emit('warmup:started', { baseImage });

    // Run warmup in background
    this.warmupBaseImage(baseImage)
      .then(snapshotInfo => {
        console.log(`[HypervisorService] Preemptive warmup completed for ${baseImage}`);
      })
      .catch(error => {
        console.error(`[HypervisorService] Preemptive warmup failed:`, error);
        this.emit('warmup:error', { baseImage, error: String(error) });
      });
  }

  /**
   * Create necessary directories
   */
  private async ensureDirectories(): Promise<void> {
    const dirs = [this.config.dataDir, this.config.baseImagesDir, this.config.sshKeysDir];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        console.log(`[HypervisorService] Created directory: ${dir}`);
      }
    }
  }

  /**
   * Check if cloud-hypervisor binary exists
   */
  private async checkHypervisorBinary(): Promise<void> {
    if (!fs.existsSync(this.config.hypervisorBinary)) {
      console.warn(`[HypervisorService] cloud-hypervisor not found at ${this.config.hypervisorBinary}`);
      try {
        const whichResult = execSync('which cloud-hypervisor', { encoding: 'utf-8' }).trim();
        if (whichResult) {
          this.config.hypervisorBinary = whichResult;
          console.log(`[HypervisorService] Found cloud-hypervisor at: ${whichResult}`);
        }
      } catch {
        console.warn('[HypervisorService] cloud-hypervisor not found in PATH. VMs will fail to start.');
      }
    }
  }

  /**
   * Generate SSH keys if they don't exist
   */
  private async ensureSshKeys(): Promise<void> {
    const privateKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519');
    const publicKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519.pub');

    if (!fs.existsSync(privateKeyPath)) {
      console.log('[HypervisorService] Generating SSH keys');
      try {
        execSync(`ssh-keygen -t ed25519 -f ${privateKeyPath} -N "" -q`, {
          encoding: 'utf-8',
        });
        fs.chmodSync(privateKeyPath, 0o600);
        console.log('[HypervisorService] SSH keys generated');
      } catch (error) {
        console.error('[HypervisorService] Failed to generate SSH keys:', error);
      }
    }
  }

  /**
   * Load existing VM states from disk
   */
  private async loadVmStates(): Promise<void> {
    const vmsDir = this.config.dataDir;
    if (!fs.existsSync(vmsDir)) return;

    const entries = fs.readdirSync(vmsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const statePath = path.join(vmsDir, entry.name, 'state.json');
        if (fs.existsSync(statePath)) {
          try {
            const stateJson = fs.readFileSync(statePath, 'utf-8');
            const state = JSON.parse(stateJson) as VmState;
            this.vms.set(state.id, state);
            if (state.sshPort) {
              this.allocatedPorts.add(state.sshPort);
            }
          } catch (error) {
            console.error(`[HypervisorService] Failed to load VM state from ${statePath}:`, error);
          }
        }
      }
    }
  }

  /**
   * Sync VM states with actual running processes
   */
  private async syncVmStates(): Promise<void> {
    for (const [id, vm] of this.vms) {
      if (vm.status === 'running' && vm.pid) {
        if (!this.isProcessRunning(vm.pid)) {
          console.warn(`[HypervisorService] VM ${id} was running but process ${vm.pid} is gone`);
          vm.status = 'stopped';
          vm.pid = undefined;
          vm.stoppedAt = new Date().toISOString();
          await this.saveVmState(vm);
        }
      }
    }
  }

  /**
   * Check if a process is running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save VM state to disk
   */
  private async saveVmState(vm: VmState): Promise<void> {
    const vmDir = path.join(this.config.dataDir, vm.id);
    if (!fs.existsSync(vmDir)) {
      fs.mkdirSync(vmDir, { recursive: true });
    }

    const statePath = path.join(vmDir, 'state.json');
    fs.writeFileSync(statePath, JSON.stringify(vm, null, 2));
  }

  /**
   * Allocate an available SSH port
   */
  private allocateSshPort(): number {
    for (let port = this.config.sshPortRangeStart; port <= this.config.sshPortRangeEnd; port++) {
      if (!this.allocatedPorts.has(port)) {
        this.allocatedPorts.add(port);
        return port;
      }
    }
    throw new Error('No available SSH ports');
  }

  /**
   * Release an SSH port
   */
  private releaseSshPort(port: number): void {
    this.allocatedPorts.delete(port);
  }

  /**
   * Generate a unique VM ID
   */
  private generateVmId(): string {
    return crypto.randomUUID().slice(0, 8);
  }

  /**
   * Generate a MAC address
   */
  private generateMacAddress(): string {
    const bytes = crypto.randomBytes(6);
    bytes[0] = (bytes[0] & 0xfe) | 0x02; // Set locally administered bit
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(':');
  }

  /**
   * Create a new VM
   */
  async createVm(config: VmConfig): Promise<VmInfo> {
    console.log(`[HypervisorService] Creating VM: ${config.name}`);

    // Check for name uniqueness
    for (const vm of this.vms.values()) {
      if (vm.name === config.name) {
        throw new Error(`VM with name '${config.name}' already exists`);
      }
    }

    const id = this.generateVmId();
    const sshPort = this.allocateSshPort();
    const vmDir = path.join(this.config.dataDir, id);

    // Create VM directory
    fs.mkdirSync(vmDir, { recursive: true });

    // Try to allocate TAP device for networking
    let tapAllocation: TapAllocation | null = null;
    let networkMode: 'tap' | 'none' = 'none';

    try {
      const status = this.networkPool.checkHealth();
      if (status.healthy && status.availableTaps > 0) {
        tapAllocation = this.networkPool.allocate(id);
        networkMode = 'tap';
        console.log(`[HypervisorService] Allocated TAP ${tapAllocation.tapName} for VM ${id}`);
      } else {
        console.warn(`[HypervisorService] No TAP available for VM ${id}: ${status.message}`);
      }
    } catch (error) {
      console.warn(`[HypervisorService] Failed to allocate TAP for VM ${id}:`, error);
    }

    // Create initial state
    const vm: VmState = {
      id,
      name: config.name,
      status: 'creating',
      sshPort,
      guestIp: tapAllocation?.guestIp,
      networkConfig: {
        mode: networkMode,
        tapDevice: tapAllocation?.tapName,
        bridgeName: tapAllocation?.bridgeName,
        macAddress: tapAllocation?.macAddress || this.generateMacAddress(),
        guestIp: tapAllocation?.guestIp,
        gateway: tapAllocation?.gateway,
      },
      portMappings: config.portMappings || [],
      baseImage: config.baseImage || this.config.defaultBaseImage,
      vcpus: config.vcpus || this.config.defaultVcpus,
      memoryMb: config.memoryMb || this.config.defaultMemoryMb,
      diskGb: config.diskGb || this.config.defaultDiskGb,
      volumes: config.volumes || [],
      createdAt: new Date().toISOString(),
    };

    this.vms.set(id, vm);
    await this.saveVmState(vm);

    this.emit('vm:created', vm);
    console.log(`[HypervisorService] VM ${id} created`);

    // Auto-start if requested
    if (config.autoStart !== false) {
      try {
        await this.startVm(id);
      } catch (error) {
        console.error(`[HypervisorService] Failed to auto-start VM ${id}:`, error);
        vm.status = 'error';
        vm.error = String(error);
        await this.saveVmState(vm);
      }
    }

    return this.vmToInfo(vm);
  }

  /**
   * Start a VM
   */
  async startVm(id: string): Promise<VmInfo> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status === 'running') {
      console.warn(`[HypervisorService] VM ${id} is already running`);
      return this.vmToInfo(vm);
    }

    if (vm.status === 'creating' && vm.startedAt) {
      console.warn(`[HypervisorService] VM ${id} is already starting`);
      return this.vmToInfo(vm);
    }

    console.log(`[HypervisorService] Starting VM ${id} (${vm.name})`);

    const vmDir = path.join(this.config.dataDir, id);
    const apiSocket = path.join(vmDir, 'api.sock');
    const logFile = path.join(vmDir, 'vm.log');

    // Build cloud-hypervisor command
    const args = this.buildHypervisorArgs(vm, vmDir, apiSocket, logFile);

    try {
      // Remove old socket if exists
      if (fs.existsSync(apiSocket)) {
        fs.unlinkSync(apiSocket);
      }

      // Spawn cloud-hypervisor process with kvm group permissions
      const logFd = fs.openSync(logFile, 'a');

      // Use sg to run with kvm group (required for /dev/kvm access)
      const fullCommand = `${this.config.hypervisorBinary} ${args.join(' ')}`;
      const proc = spawn('sg', ['kvm', '-c', fullCommand], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });

      // Close the fd in the parent process after spawn
      fs.closeSync(logFd);

      proc.unref();
      this.processes.set(id, proc);

      vm.pid = proc.pid;
      vm.apiSocket = apiSocket;
      vm.status = 'creating';
      vm.startedAt = new Date().toISOString();
      vm.error = undefined;

      await this.saveVmState(vm);

      // Monitor VM startup in background
      this.monitorVmStartup(id, apiSocket);

      console.log(`[HypervisorService] VM ${id} starting with PID ${proc.pid}`);

      return this.vmToInfo(vm);
    } catch (error) {
      vm.status = 'error';
      vm.error = String(error);
      await this.saveVmState(vm);
      throw error;
    }
  }

  /**
   * Monitor VM startup in background
   */
  private async monitorVmStartup(id: string, apiSocket: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) return;

    try {
      // Wait for API socket to be ready (up to 60 seconds)
      await this.waitForApiSocket(apiSocket, 60000);

      // Update status to booting
      vm.status = 'booting';
      await this.saveVmState(vm);
      this.emit('vm:booting', vm);
      console.log(`[HypervisorService] VM ${id} is booting`);

      // Wait for SSH to be reachable (up to 120 seconds)
      await this.waitForSshReady(id);

      // Update status to running
      vm.status = 'running';
      await this.saveVmState(vm);

      this.emit('vm:started', vm);
      console.log(`[HypervisorService] VM ${id} is now running`);
    } catch (error) {
      console.error(`[HypervisorService] VM ${id} failed to start:`, error);
      vm.status = 'error';
      vm.error = `Failed to start: ${error}`;
      await this.saveVmState(vm);
      this.emit('vm:error', { vm, error });
    }
  }

  /**
   * Wait for SSH to be reachable
   */
  private async waitForSshReady(vmId: string, timeoutMs: number = 120000): Promise<void> {
    const startTime = Date.now();
    const sshKeyPath = this.getSshKeyPath();
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM ${vmId} not found`);
    }

    const port = vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort;
    const host = vm.networkConfig.mode === 'tap' ? vm.networkConfig.guestIp : '127.0.0.1';

    return new Promise((resolve, reject) => {
      const check = async () => {
        try {
          const sshCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 agent@${host} -p ${port} 'echo ready'`;
          execSync(sshCmd, { stdio: 'pipe', timeout: 10000 });
          resolve();
          return;
        } catch {
          if (Date.now() - startTime > timeoutMs) {
            reject(new Error('Timeout waiting for SSH'));
            return;
          }
          setTimeout(check, 2000);
        }
      };

      check();
    });
  }

  /**
   * Create cloud-init ISO for VM configuration
   */
  private createCloudInitIso(vm: VmState, vmDir: string): string {
    const cloudinitDir = path.join(vmDir, 'cloudinit');
    const isoPath = path.join(vmDir, 'cloudinit.iso');

    if (!fs.existsSync(cloudinitDir)) {
      fs.mkdirSync(cloudinitDir, { recursive: true });
    }

    // Read SSH public key
    const sshPubKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519.pub');
    const sshPublicKey = fs.existsSync(sshPubKeyPath)
      ? fs.readFileSync(sshPubKeyPath, 'utf-8').trim()
      : '';

    // Create meta-data
    const metaData = `instance-id: ${vm.id}
local-hostname: ${vm.name}
`;
    fs.writeFileSync(path.join(cloudinitDir, 'meta-data'), metaData);

    // Create user-data with SSH key and user setup
    const userData = `#cloud-config
hostname: ${vm.name}
manage_etc_hosts: true
users:
  - name: agent
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ${sshPublicKey}
  - name: root
    ssh_authorized_keys:
      - ${sshPublicKey}
ssh_pwauth: false
disable_root: false
chpasswd:
  expire: false
runcmd:
  - systemctl enable ssh
  - systemctl start ssh
  - apt-get update
  - apt-get install -y curl git build-essential python3 python3-pip nodejs npm
  - npm install -g typescript tsx @types/node
`;
    fs.writeFileSync(path.join(cloudinitDir, 'user-data'), userData);

    // Create network-config for DHCP
    const networkConfig = `version: 2
ethernets:
  all-en:
    match:
      driver: virtio_net
    dhcp4: true
    dhcp-identifier: mac
`;
    fs.writeFileSync(path.join(cloudinitDir, 'network-config'), networkConfig);

    // Create ISO using genisoimage
    try {
      execSync(
        `genisoimage -output ${isoPath} -volid cidata -joliet -rock ` +
          `${path.join(cloudinitDir, 'user-data')} ` +
          `${path.join(cloudinitDir, 'meta-data')} ` +
          `${path.join(cloudinitDir, 'network-config')}`,
        { stdio: 'pipe' }
      );
    } catch (error) {
      throw new Error(`Failed to create cloud-init ISO: ${error}`);
    }

    return isoPath;
  }

  /**
   * Build cloud-hypervisor command arguments
   */
  private buildHypervisorArgs(
    vm: VmState,
    vmDir: string,
    apiSocket: string,
    logFile: string
  ): string[] {
    const baseImageDir = path.join(this.config.baseImagesDir, vm.baseImage);
    const kernelPath = this.config.kernelPath || path.join(baseImageDir, 'kernel');
    const diskPath = path.join(vmDir, 'disk.qcow2');

    // Create QCOW2 overlay with backing file
    if (!fs.existsSync(diskPath)) {
      const baseImagePath = path.join(baseImageDir, 'image.qcow2');
      if (fs.existsSync(baseImagePath)) {
        console.log(`[HypervisorService] Creating QCOW2 overlay: ${diskPath}`);
        execSync(`qemu-img create -f qcow2 -b ${baseImagePath} -F qcow2 ${diskPath} ${vm.diskGb}G`);
      } else {
        execSync(`qemu-img create -f qcow2 ${diskPath} ${vm.diskGb}G`);
      }
    }

    // Create cloud-init ISO
    const cloudinitIsoPath = this.createCloudInitIso(vm, vmDir);

    const args: string[] = [
      '--api-socket',
      apiSocket,
      '--cpus',
      `boot=${vm.vcpus}`,
      '--memory',
      `size=${vm.memoryMb}M`,
    ];

    // Add kernel if exists
    if (fs.existsSync(kernelPath)) {
      args.push('--kernel', kernelPath);

      const initrdPath = this.config.initrdPath || path.join(baseImageDir, 'initrd');
      if (fs.existsSync(initrdPath)) {
        args.push('--initramfs', initrdPath);
      }

      args.push('--cmdline', '"console=ttyS0 root=LABEL=cloudimg-rootfs rw"');
    }

    // Add disks
    args.push('--disk');
    args.push(`path=${diskPath},direct=false`);
    args.push(`path=${cloudinitIsoPath},readonly=on,direct=false`);

    // Network: Use TAP device if available
    if (vm.networkConfig.mode === 'tap' && vm.networkConfig.tapDevice) {
      args.push('--net', `tap=${vm.networkConfig.tapDevice},mac=${vm.networkConfig.macAddress}`);
    }

    // Serial console to file
    const consoleLog = path.join(vmDir, 'console.log');
    args.push('--serial', `file=${consoleLog}`);
    args.push('--console', 'null');
    args.push('--log-file', logFile);
    args.push('-v');

    return args;
  }

  /**
   * Wait for API socket to become available
   */
  private waitForApiSocket(socketPath: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const check = () => {
        if (fs.existsSync(socketPath)) {
          resolve();
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error('Timeout waiting for API socket'));
          return;
        }

        setTimeout(check, 100);
      };

      check();
    });
  }

  /**
   * Stop a VM
   */
  async stopVm(id: string): Promise<VmInfo> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status !== 'running' && vm.status !== 'booting') {
      console.warn(`[HypervisorService] VM ${id} is not running (status: ${vm.status})`);
      return this.vmToInfo(vm);
    }

    console.log(`[HypervisorService] Stopping VM ${id}`);

    try {
      // Try graceful shutdown via API socket
      if (vm.apiSocket && fs.existsSync(vm.apiSocket)) {
        try {
          await this.sendVmApiRequest(vm.apiSocket, 'PUT', '/api/v1/vm.shutdown');
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch {
          // Guest may already be stopped
        }

        try {
          await this.sendVmApiRequest(vm.apiSocket, 'PUT', '/api/v1/vmm.shutdown');
          if (vm.pid) {
            await this.waitForProcessExit(vm.pid, 5000);
          }
        } catch {
          // If delete fails, fall through to kill
        }
      }

      // If process still running, kill it
      if (vm.pid && this.isProcessRunning(vm.pid)) {
        process.kill(vm.pid, 'SIGTERM');
        await this.waitForProcessExit(vm.pid, 3000);
      }
    } catch (error) {
      console.warn(`[HypervisorService] Graceful shutdown failed for VM ${id}, forcing kill`);
      if (vm.pid) {
        try {
          process.kill(vm.pid, 'SIGKILL');
        } catch {
          // Process may already be dead
        }
      }
    }

    vm.status = 'stopped';
    vm.pid = undefined;
    vm.stoppedAt = new Date().toISOString();
    await this.saveVmState(vm);

    this.processes.delete(id);
    this.emit('vm:stopped', vm);
    console.log(`[HypervisorService] VM ${id} stopped`);

    return this.vmToInfo(vm);
  }

  /**
   * Wait for a process to exit
   */
  private waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      const startTime = Date.now();

      const check = () => {
        if (!this.isProcessRunning(pid)) {
          resolve();
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          resolve();
          return;
        }

        setTimeout(check, 100);
      };

      check();
    });
  }

  /**
   * Delete a VM
   */
  async deleteVm(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    console.log(`[HypervisorService] Deleting VM ${id}`);

    // Stop if running
    if (vm.status === 'running' || vm.status === 'booting') {
      await this.stopVm(id);
    }

    // Release SSH port
    this.releaseSshPort(vm.sshPort);

    // Release TAP device
    if (vm.networkConfig.tapDevice) {
      this.networkPool.release(vm.networkConfig.tapDevice);
    }

    // Delete VM directory
    const vmDir = path.join(this.config.dataDir, id);
    if (fs.existsSync(vmDir)) {
      fs.rmSync(vmDir, { recursive: true, force: true });
    }

    this.vms.delete(id);
    this.emit('vm:deleted', { id });
    console.log(`[HypervisorService] VM ${id} deleted`);
  }

  /**
   * Get a VM by ID
   */
  getVm(id: string): VmInfo | null {
    const vm = this.vms.get(id);
    return vm ? this.vmToInfo(vm) : null;
  }

  /**
   * List all VMs
   */
  listVms(): VmInfo[] {
    return Array.from(this.vms.values())
      .filter(vm => !vm.id.startsWith('warmup-'))
      .map(vm => this.vmToInfo(vm));
  }

  /**
   * Send a request to the VM's API socket
   */
  private async sendVmApiRequest(
    socketPath: string,
    method: string,
    path: string,
    body?: any,
    timeoutMs: number = 5000
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      let response = '';
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          if (path.includes('shutdown') || path.includes('delete')) {
            resolve(null);
          } else {
            reject(new Error(`API request timeout after ${timeoutMs}ms`));
          }
        }
      }, timeoutMs);

      socket.on('connect', () => {
        const bodyStr = body ? JSON.stringify(body) : '';
        const request = [
          `${method} ${path} HTTP/1.1`,
          'Host: localhost',
          'Accept: application/json',
          'Content-Type: application/json',
          `Content-Length: ${bodyStr.length}`,
          '',
          bodyStr,
        ].join('\r\n');

        socket.write(request);
      });

      socket.on('data', data => {
        response += data.toString();
        if (response.includes('\r\n\r\n')) {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            socket.end();
            try {
              const [headers, respBody] = response.split('\r\n\r\n');
              const statusLine = headers.split('\r\n')[0];
              const statusCode = parseInt(statusLine.split(' ')[1], 10);
              if (statusCode >= 200 && statusCode < 300) {
                resolve(respBody ? JSON.parse(respBody) : null);
              } else {
                reject(new Error(`API request failed: ${statusLine} - ${respBody}`));
              }
            } catch (error) {
              reject(error);
            }
          }
        }
      });

      socket.on('error', err => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });
  }

  /**
   * Get SSH connection info for a VM
   */
  getSshInfo(id: string): { host: string; port: number; user: string; command: string } | null {
    const vm = this.vms.get(id);
    if (!vm) return null;

    const privateKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519');
    const user = 'agent';

    if (vm.networkConfig.guestIp && vm.networkConfig.mode === 'tap') {
      const host = vm.networkConfig.guestIp;
      const port = 22;
      return {
        host,
        port,
        user,
        command: `ssh -i ${privateKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${user}@${host}`,
      };
    }

    const host = '127.0.0.1';
    const port = vm.sshPort;
    return {
      host,
      port,
      user,
      command: `ssh -i ${privateKeyPath} -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${user}@${host}`,
    };
  }

  /**
   * Get SSH private key path
   */
  getSshKeyPath(): string {
    return path.join(this.config.sshKeysDir, 'id_ed25519');
  }

  /**
   * Get SSH private key content
   */
  getSshPrivateKey(): string | null {
    const keyPath = this.getSshKeyPath();
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf-8');
    }
    return null;
  }

  /**
   * Get VM boot logs
   */
  getVmBootLogs(vmId: string, lines: number = 100): string | null {
    const vm = this.vms.get(vmId);
    if (!vm) {
      return null;
    }

    const vmDir = path.join(this.config.dataDir, vmId);
    const consoleLog = path.join(vmDir, 'console.log');

    if (!fs.existsSync(consoleLog)) {
      return '';
    }

    try {
      const content = fs.readFileSync(consoleLog, 'utf-8');
      const logLines = content.split('\n');
      return logLines.slice(-lines).join('\n');
    } catch (error) {
      return null;
    }
  }

  /**
   * Convert internal VmState to API VmInfo
   */
  private vmToInfo(vm: VmState): VmInfo {
    const sshInfo = this.getSshInfo(vm.id);

    return {
      id: vm.id,
      name: vm.name,
      status: vm.status,
      state: vm.status,
      sshHost: sshInfo?.host || '127.0.0.1',
      sshPort: sshInfo?.port || vm.sshPort,
      sshUser: sshInfo?.user || 'agent',
      sshCommand: sshInfo?.command,
      guestIp: vm.networkConfig.guestIp,
      networkMode: vm.networkConfig.mode,
      ports: vm.portMappings,
      volumes: vm.volumes,
      image: vm.baseImage,
      vcpus: vm.vcpus,
      memoryMb: vm.memoryMb,
      diskGb: vm.diskGb,
      createdAt: vm.createdAt,
      startedAt: vm.startedAt,
      error: vm.error,
    };
  }

  /**
   * Get service stats
   */
  getStats(): { total: number; running: number; stopped: number; error: number } {
    let total = 0;
    let running = 0;
    let stopped = 0;
    let error = 0;

    for (const vm of this.vms.values()) {
      if (vm.id.startsWith('warmup-')) continue;

      total++;
      switch (vm.status) {
        case 'running':
          running++;
          break;
        case 'stopped':
        case 'creating':
          stopped++;
          break;
        case 'error':
          error++;
          break;
      }
    }

    return { total, running, stopped, error };
  }

  /**
   * Shutdown all VMs and cleanup
   */
  async shutdown(): Promise<void> {
    console.log('[HypervisorService] Shutting down...');

    for (const [id, vm] of this.vms) {
      if (vm.status === 'running') {
        try {
          await this.stopVm(id);
        } catch (error) {
          console.error(`[HypervisorService] Failed to stop VM ${id}:`, error);
        }
      }
    }

    this.emit('hypervisor:shutdown');
    console.log('[HypervisorService] Shutdown complete');
  }

  /**
   * Check if a warmed-up snapshot exists for a base image
   */
  hasWarmupSnapshot(baseImage: string): boolean {
    const snapshotDir = path.join(this.config.baseImagesDir, baseImage, 'warmup-snapshot');
    const configPath = path.join(snapshotDir, 'config.json');
    const statePath = path.join(snapshotDir, 'state.json');
    if (!fs.existsSync(snapshotDir)) return false;
    const files = fs.readdirSync(snapshotDir);
    const hasMemoryRanges = files.some(f => f.startsWith('memory-ranges'));
    return fs.existsSync(configPath) && fs.existsSync(statePath) && hasMemoryRanges;
  }

  /**
   * Warmup a base image (create a snapshot for fast boot)
   */
  async warmupBaseImage(baseImage: string): Promise<SnapshotInfo | null> {
    this.updateWarmupStatus(baseImage, 'starting', 5, 'Starting warmup process');

    const vmId = `warmup-${baseImage}`;
    const vmDir = path.join(this.config.dataDir, vmId);
    const snapshotDir = path.join(this.config.baseImagesDir, baseImage, 'warmup-snapshot');

    try {
      // Create temporary VM
      this.updateWarmupStatus(baseImage, 'booting', 20, 'Creating temporary VM');

      const vmConfig: VmConfig = {
        name: vmId,
        baseImage,
        autoStart: false,
      };

      const vm = await this.createVm(vmConfig);

      // Start the VM
      this.updateWarmupStatus(baseImage, 'waiting_for_boot', 40, 'Waiting for VM to boot');
      await this.startVm(vm.id);

      // Wait for boot completion
      const consoleLogPath = path.join(vmDir, 'console.log');
      await this.waitForBootComplete(consoleLogPath, 120000);

      // Pause the VM
      this.updateWarmupStatus(baseImage, 'pausing', 60, 'Pausing VM');
      await this.pauseVm(vm.id);

      // Create snapshot
      this.updateWarmupStatus(baseImage, 'snapshotting', 80, 'Creating snapshot');
      const snapshotInfo = await this.createVmSnapshot(vm.id, snapshotDir);

      // Cleanup - delete temporary VM
      await this.deleteVm(vm.id);

      this.updateWarmupStatus(baseImage, 'complete', 100, 'Warmup complete');
      return snapshotInfo;
    } catch (error) {
      this.updateWarmupStatus(baseImage, 'error', 0, 'Warmup failed', String(error));

      // Cleanup on failure
      try {
        if (this.vms.has(vmId)) {
          await this.deleteVm(vmId);
        }
      } catch {}

      throw error;
    }
  }

  /**
   * Pause a running VM
   */
  async pauseVm(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status !== 'running') {
      throw new Error(`VM ${id} is not running (status: ${vm.status})`);
    }

    if (!vm.apiSocket || !fs.existsSync(vm.apiSocket)) {
      throw new Error(`VM ${id} has no API socket`);
    }

    await this.sendVmApiRequest(vm.apiSocket, 'PUT', '/api/v1/vm.pause');

    vm.status = 'paused';
    await this.saveVmState(vm);
  }

  /**
   * Create a snapshot of a paused VM
   */
  async createVmSnapshot(id: string, snapshotDir: string): Promise<SnapshotInfo> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status !== 'paused') {
      throw new Error(`VM ${id} must be paused to create snapshot`);
    }

    if (!vm.apiSocket || !fs.existsSync(vm.apiSocket)) {
      throw new Error(`VM ${id} has no API socket`);
    }

    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    const configPath = path.join(snapshotDir, 'config.json');
    const statePath = path.join(snapshotDir, 'state.json');

    await this.sendVmApiRequest(vm.apiSocket, 'PUT', '/api/v1/vm.snapshot', {
      destination_url: `file://${snapshotDir}`,
    });

    // Wait for snapshot files
    await this.waitForSnapshotFiles(configPath, statePath, 30000);

    const snapshotInfo: SnapshotInfo = {
      id: `snap-${vm.id}`,
      vmId: vm.id,
      baseImage: vm.baseImage,
      configPath,
      snapshotFile: statePath,
      memoryRanges: this.findMemoryRangeFiles(snapshotDir),
      createdAt: new Date().toISOString(),
    };

    return snapshotInfo;
  }

  private findMemoryRangeFiles(snapshotDir: string): string[] {
    try {
      const files = fs.readdirSync(snapshotDir);
      return files.filter(f => f.startsWith('memory-ranges-')).map(f => path.join(snapshotDir, f));
    } catch {
      return [];
    }
  }

  private waitForSnapshotFiles(configPath: string, snapshotFile: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = () => {
        if (fs.existsSync(configPath) && fs.existsSync(snapshotFile)) {
          setTimeout(resolve, 100);
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error('Timeout waiting for snapshot files'));
          return;
        }

        setTimeout(check, 500);
      };

      check();
    });
  }

  private async waitForBootComplete(consoleLogPath: string, timeoutMs: number = 120000): Promise<void> {
    const startTime = Date.now();
    const bootMarkers = ['login:', 'reached target cloud-init.target', 'Cloud-init target'];

    return new Promise((resolve, reject) => {
      const check = () => {
        try {
          if (fs.existsSync(consoleLogPath)) {
            const content = fs.readFileSync(consoleLogPath, 'utf-8');
            for (const marker of bootMarkers) {
              if (content.toLowerCase().includes(marker.toLowerCase())) {
                resolve();
                return;
              }
            }
          }

          if (Date.now() - startTime > timeoutMs) {
            reject(new Error('Timeout waiting for boot completion'));
            return;
          }

          setTimeout(check, 500);
        } catch (error) {
          if (Date.now() - startTime > timeoutMs) {
            reject(error);
          } else {
            setTimeout(check, 500);
          }
        }
      };

      check();
    });
  }

  /**
   * List available base images
   */
  listBaseImages(): { name: string; hasKernel: boolean; hasWarmupSnapshot: boolean }[] {
    const baseImagesDir = this.config.baseImagesDir;
    if (!fs.existsSync(baseImagesDir)) {
      return [];
    }

    const images: { name: string; hasKernel: boolean; hasWarmupSnapshot: boolean }[] = [];
    const entries = fs.readdirSync(baseImagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const imageDir = path.join(baseImagesDir, entry.name);
      const hasKernel = fs.existsSync(path.join(imageDir, 'kernel'));
      const hasWarmupSnapshot = this.hasWarmupSnapshot(entry.name);

      images.push({
        name: entry.name,
        hasKernel,
        hasWarmupSnapshot,
      });
    }

    return images;
  }

  /**
   * Delete a base image and all associated files
   */
  async deleteBaseImage(name: string): Promise<void> {
    const imageDir = path.join(this.config.baseImagesDir, name);

    // Check if image exists
    if (!fs.existsSync(imageDir)) {
      throw new Error(`Base image "${name}" not found`);
    }

    // Check if any VMs are using this image
    for (const vm of this.vms.values()) {
      if (vm.baseImage === name) {
        throw new Error(`Cannot delete: VM "${vm.name}" is using this base image`);
      }
    }

    // Delete the image directory
    fs.rmSync(imageDir, { recursive: true, force: true });
    console.log(`[Hypervisor] Deleted base image: ${name}`);
  }
}

// Singleton instance
let hypervisorService: HypervisorService | null = null;

export function getHypervisorService(): HypervisorService {
  if (!hypervisorService) {
    hypervisorService = new HypervisorService();
  }
  return hypervisorService;
}

export async function initializeHypervisorService(): Promise<HypervisorService> {
  const service = getHypervisorService();
  await service.initialize();
  return service;
}
