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
   * Get the data directory path
   */
  getDataDir(): string {
    return path.dirname(this.config.dataDir);
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

    // Initialize network pool (detects helper vs pool mode)
    await this.networkPool.initialize();

    // Check network health
    await this.checkNetworkHealth();

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
  private async checkNetworkHealth(): Promise<void> {
    this.networkStatus = this.networkPool.checkHealth();
    const mode = this.networkPool.getMode();

    if (mode === 'helper') {
      console.log('[HypervisorService] Network: Using helper mode (on-demand TAP creation)');
      return;
    }

    if (!this.networkStatus.configured) {
      console.warn('\n' + '='.repeat(60));
      console.warn('WARNING: VM networking is not configured!');
      console.warn('VMs will boot but will not have network connectivity.');
      console.warn('\nTo enable networking, run:');
      console.warn('  sudo ./scripts/install-tap-helper.sh --setup-bridge');
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
   * Clear warmup status (dismiss error)
   */
  clearWarmupStatus(baseImage: string): void {
    this.warmupStatus.delete(baseImage);
  }

  /**
   * Update warmup status and emit event
   */
  private updateWarmupStatus(
    baseImage: string,
    phase: WarmupPhase,
    progress: number,
    message: string,
    error?: string,
    vmId?: string
  ): void {
    const existing = this.warmupStatus.get(baseImage);
    const status: WarmupStatus = {
      baseImage,
      phase,
      progress,
      message,
      startedAt: existing?.startedAt,
      completedAt: phase === 'complete' || phase === 'error' ? new Date().toISOString() : undefined,
      error,
      vmId: vmId || existing?.vmId, // Preserve vmId across status updates
    };

    if (phase === 'starting') {
      status.startedAt = new Date().toISOString();
    }

    this.warmupStatus.set(baseImage, status);
    this.emit('warmup:progress', status);
  }

  /**
   * Get warmup logs for a base image (finds the warmup VM by name)
   */
  getWarmupLogs(baseImage: string, lines: number = 100): string | null {
    const warmupVmName = `warmup-${baseImage}`;

    // Find warmup VM by name
    for (const [id, vm] of this.vms) {
      if (vm.name === warmupVmName) {
        return this.getVmBootLogs(id, lines);
      }
    }

    return null;
  }

  /**
   * Pre-emptively warmup default base image
   * Note: Disabled - warmup snapshots (cross-VM) are not supported
   * Fresh boot is used instead, with per-VM snapshots for resume
   */
  private async preemptiveWarmup(): Promise<void> {
    // Warmup disabled - fresh boot is fast enough (~10-30s)
    // Per-VM snapshots are used for resume instead
    return;
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
    // First, check if tracked VMs are still running
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

    // Then, clean up any orphaned cloud-hypervisor processes
    await this.cleanupOrphanedProcesses();
  }

  /**
   * Find and kill orphaned cloud-hypervisor processes that reference our data directory
   */
  private async cleanupOrphanedProcesses(): Promise<void> {
    try {
      const { execSync } = await import('child_process');
      const result = execSync('pgrep -af cloud-hypervisor 2>/dev/null || true', { encoding: 'utf-8' });

      // Check for orphaned VMs in the main data directory
      const vmLines = result.split('\n').filter(line => line.includes(this.config.dataDir));
      for (const line of vmLines) {
        const vmIdMatch = line.match(new RegExp(`${this.config.dataDir}/([^/]+)/`));
        if (vmIdMatch) {
          const vmId = vmIdMatch[1];
          if (!this.vms.has(vmId)) {
            const pidMatch = line.match(/^(\d+)/);
            if (pidMatch) {
              const pid = parseInt(pidMatch[1], 10);
              console.warn(`[HypervisorService] Killing orphaned VM process: PID ${pid}, VM ID ${vmId}`);
              try {
                process.kill(pid, 'SIGTERM');
              } catch (e) {
                // Process may have already exited
              }
            }
          }
        }
      }

      // Check for orphaned warmup VMs in base-images directory
      const warmupLines = result.split('\n').filter(line => line.includes(this.config.baseImagesDir) && line.includes('warmup-vm'));
      for (const line of warmupLines) {
        const pidMatch = line.match(/^(\d+)/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          // Check if there's a tracked warmup VM with this name
          const baseImageMatch = line.match(new RegExp(`${this.config.baseImagesDir}/([^/]+)/warmup-vm/`));
          const baseImage = baseImageMatch ? baseImageMatch[1] : 'unknown';
          const warmupVmName = `warmup-${baseImage}`;

          // Check if this warmup VM is currently tracked
          let isTracked = false;
          for (const [, vm] of this.vms) {
            if (vm.name === warmupVmName) {
              isTracked = true;
              break;
            }
          }

          if (!isTracked) {
            console.warn(`[HypervisorService] Killing orphaned warmup VM process: PID ${pid}, base image ${baseImage}`);
            try {
              process.kill(pid, 'SIGTERM');
            } catch (e) {
              // Process may have already exited
            }
          }
        }
      }
    } catch (error) {
      console.error('[HypervisorService] Failed to cleanup orphaned processes:', error);
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
      const poolMode = this.networkPool.getMode();

      if (poolMode === 'helper' || (status.healthy && status.availableTaps > 0)) {
        // Use async allocation (supports both helper and pool modes)
        tapAllocation = await this.networkPool.allocateAsync(id);
        networkMode = 'tap';
        console.log(`[HypervisorService] Allocated TAP ${tapAllocation.tapName} for VM ${id} (${poolMode} mode)`);
      } else {
        console.warn(`[HypervisorService] No TAP available for VM ${id}: ${status.message}`);
      }
    } catch (error) {
      console.warn(`[HypervisorService] Failed to allocate TAP for VM ${id}:`, error);
    }

    // Handle snapshot-based launch
    let sourceSnapshot: VmState['sourceSnapshot'];
    let baseImage = config.baseImage || this.config.defaultBaseImage;
    let vcpus = config.vcpus || this.config.defaultVcpus;
    let memoryMb = config.memoryMb || this.config.defaultMemoryMb;
    let diskGb = config.diskGb || this.config.defaultDiskGb;

    if (config.fromSnapshot) {
      const { vmId: sourceVmId, snapshotId } = config.fromSnapshot;
      const sourceVmDir = path.join(this.config.dataDir, sourceVmId);
      const snapshotDir = path.join(sourceVmDir, 'snapshots', snapshotId);

      if (!fs.existsSync(snapshotDir)) {
        throw new Error(`Snapshot ${snapshotId} not found for VM ${sourceVmId}`);
      }

      // Read snapshot metadata
      const metadataPath = path.join(snapshotDir, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        baseImage = metadata.baseImage || baseImage;
        // Use snapshot's resource settings unless overridden
        vcpus = config.vcpus || metadata.vcpus || vcpus;
        memoryMb = config.memoryMb || metadata.memoryMb || memoryMb;
        diskGb = config.diskGb || metadata.diskGb || diskGb;
      }

      // Copy snapshot files to new VM directory (for restore)
      const snapshotCopyDir = path.join(vmDir, 'snapshot-restore');
      fs.mkdirSync(snapshotCopyDir, { recursive: true });

      // Copy state and config files
      for (const file of ['state.json', 'config.json']) {
        const src = path.join(snapshotDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(snapshotCopyDir, file));
        }
      }

      // Copy memory range files
      const memoryFiles = fs.readdirSync(snapshotDir).filter(f => f.startsWith('memory-ranges-'));
      for (const file of memoryFiles) {
        fs.copyFileSync(path.join(snapshotDir, file), path.join(snapshotCopyDir, file));
      }

      // Create CoW overlay disk from snapshot's disk
      const snapshotDiskPath = path.join(snapshotDir, 'disk.qcow2');
      const newDiskPath = path.join(vmDir, 'disk.qcow2');

      if (fs.existsSync(snapshotDiskPath)) {
        console.log(`[HypervisorService] Creating CoW overlay from snapshot disk`);
        execSync(`qemu-img create -f qcow2 -b ${snapshotDiskPath} -F qcow2 ${newDiskPath}`);
      }

      sourceSnapshot = {
        vmId: sourceVmId,
        snapshotId,
        snapshotDir: snapshotCopyDir,
      };

      console.log(`[HypervisorService] VM ${id} will be created from snapshot ${snapshotId}`);
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
      baseImage,
      vcpus,
      memoryMb,
      diskGb,
      volumes: config.volumes || [],
      sourceSnapshot,
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

    // Handle paused VM - resume via API instead of spawning new process
    if (vm.status === 'paused' && vm.apiSocket && fs.existsSync(vm.apiSocket)) {
      console.log(`[HypervisorService] Resuming paused VM ${id} (${vm.name})`);
      await this.sendVmApiRequest(vm.apiSocket, 'PUT', '/api/v1/vm.resume');
      vm.status = 'running';
      await this.saveVmState(vm);
      this.emit('vm:started', vm);
      return this.vmToInfo(vm);
    }

    console.log(`[HypervisorService] Starting VM ${id} (${vm.name})`);

    const vmDir = path.join(this.config.dataDir, id);
    const apiSocket = path.join(vmDir, 'api.sock');
    const logFile = path.join(vmDir, 'vm.log');

    // Check if we can use fast boot (restore from warmup snapshot)
    const canUseFastBoot = this.canUseFastBoot(vm, vmDir);

    let fullCommand: string;

    if (canUseFastBoot) {
      console.log(`[HypervisorService] Using fast boot for VM ${id}`);
      fullCommand = this.buildRestoreCommand(vm, vmDir, apiSocket, logFile);
    } else {
      // Build normal cloud-hypervisor command
      const args = this.buildHypervisorArgs(vm, vmDir, apiSocket, logFile);
      fullCommand = `${this.config.hypervisorBinary} ${args.join(' ')}`;
    }

    try {
      // Remove old socket if exists
      if (fs.existsSync(apiSocket)) {
        fs.unlinkSync(apiSocket);
      }

      // Spawn cloud-hypervisor process with kvm group permissions
      const logFd = fs.openSync(logFile, 'a');

      // Use sg to run with kvm group (required for /dev/kvm access)
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

      // Monitor VM startup in background (skip for warmup VMs which have their own monitoring)
      if (!vm.name.startsWith('warmup-')) {
        this.monitorVmStartup(id, apiSocket, canUseFastBoot);
      }

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
  private async monitorVmStartup(id: string, apiSocket: string, isFastBoot: boolean = false): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) return;

    const vmDir = path.join(this.config.dataDir, id);
    const startTime = Date.now();

    try {
      // Wait for API socket to be ready
      // Fast boot: should be instant (< 2s), normal boot: up to 60s
      const socketTimeout = isFastBoot ? 5000 : 60000;
      console.log(`[HypervisorService] Waiting for API socket (timeout: ${socketTimeout}ms)`);
      await this.waitForApiSocket(apiSocket, socketTimeout);
      console.log(`[HypervisorService] API socket ready in ${Date.now() - startTime}ms`);

      // For snapshot restore (per-VM snapshots), the VM is in paused state
      // We need to explicitly resume it via the API
      // Note: Only per-VM snapshots are supported (same MAC/IP), no network reconfiguration needed
      if (isFastBoot) {
        const resumeStart = Date.now();
        console.log(`[HypervisorService] Resuming restored VM ${id}`);
        await this.sendVmApiRequest(apiSocket, 'PUT', '/api/v1/vm.resume');
        console.log(`[HypervisorService] VM resumed in ${Date.now() - resumeStart}ms`);

        // Per-VM snapshot restore - same MAC/IP, no network reconfiguration needed
        // Just do a quick SSH verification
        vm.status = 'booting';
        await this.saveVmState(vm);
        this.emit('vm:booting', vm);

        const sshStart = Date.now();
        console.log(`[HypervisorService] Quick SSH check for snapshot restore`);
        await this.waitForSshReadyFast(id, 10000); // 10s max for restore
        console.log(`[HypervisorService] SSH ready in ${Date.now() - sshStart}ms`);

        // Update status to running
        vm.status = 'running';
        await this.saveVmState(vm);
        this.emit('vm:started', vm);
        console.log(`[HypervisorService] VM ${id} restored in ${Date.now() - startTime}ms total`);
        return;
      }

      // Normal boot path (not fast boot)
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
      console.log(`[HypervisorService] VM ${id} is now running in ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error(`[HypervisorService] VM ${id} failed to start:`, error);
      vm.status = 'error';
      vm.error = `Failed to start: ${error}`;
      await this.saveVmState(vm);
      this.emit('vm:error', { vm, error });
    }
  }

  /**
   * Send a command to the guest via vsock and return the response
   * Uses cloud-hypervisor's vsock socket protocol: CONNECT <port>\n<data>
   */
  private async sendVsockCommand(vmDir: string, command: string, port: number = 5000, timeoutMs: number = 30000): Promise<string> {
    const vsockPath = path.join(vmDir, 'vsock.sock');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Vsock command timeout'));
      }, timeoutMs);

      const client = net.createConnection(vsockPath, () => {
        // Send CONNECT command followed by the actual command
        client.write(`CONNECT ${port}\n${command}`);
      });

      let data = '';
      client.on('data', (chunk) => {
        data += chunk.toString();
      });

      client.on('end', () => {
        clearTimeout(timeout);
        resolve(data);
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      // Close after receiving data (vsock is request-response)
      client.setTimeout(timeoutMs, () => {
        client.end();
        clearTimeout(timeout);
        resolve(data);
      });
    });
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
   * Fast SSH check for fast boot - SSH should already be running
   * Uses shorter timeout and fewer retries
   */
  private async waitForSshReadyFast(vmId: string, timeoutMs: number = 10000): Promise<void> {
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
          // Use shorter connect timeout for fast boot
          const sshCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2 agent@${host} -p ${port} 'echo ready'`;
          execSync(sshCmd, { stdio: 'pipe', timeout: 5000 });
          resolve();
          return;
        } catch {
          if (Date.now() - startTime > timeoutMs) {
            reject(new Error('Timeout waiting for SSH (fast boot)'));
            return;
          }
          // Shorter retry interval for fast boot
          setTimeout(check, 500);
        }
      };

      check();
    });
  }

  /**
   * Wait for packages to be installed (checks for marker file via SSH)
   */
  private async waitForPackagesInstalled(vmId: string, timeoutMs: number = 300000): Promise<void> {
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
          // Check for the marker file that indicates packages are installed
          const sshCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 agent@${host} -p ${port} 'test -f /var/lib/cloud/instance/packages-installed && echo done'`;
          const result = execSync(sshCmd, { stdio: 'pipe', timeout: 10000, encoding: 'utf-8' });
          if (result.trim() === 'done') {
            console.log(`[HypervisorService] Packages installed for VM ${vmId}`);
            resolve();
            return;
          }
        } catch {
          // Not ready yet
        }

        if (Date.now() - startTime > timeoutMs) {
          // Timeout - but don't fail, packages might still be installing
          console.warn(`[HypervisorService] Package installation timeout for VM ${vmId}, proceeding anyway`);
          resolve();
          return;
        }

        setTimeout(check, 5000); // Check every 5 seconds
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
    // Includes vsock listener for host-to-guest commands (used for network reconfiguration on restore)
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
write_files:
  # Script to reconfigure networking and hostname (for snapshot restore)
  - path: /usr/local/bin/reconfigure-network.sh
    permissions: '0755'
    content: |
      #!/bin/bash
      # Reconfigure networking and hostname after VM resume from snapshot
      # This handles the case where the VM was restored with a different MAC address
      # Usage: reconfigure-network.sh [NEW_MAC] [NEW_HOSTNAME]
      NEW_MAC="$1"
      NEW_HOSTNAME="$2"
      LOG="/var/log/network-reconfigure.log"
      echo "[$(date)] Network reconfigure triggered, new MAC: $NEW_MAC, hostname: $NEW_HOSTNAME" >> $LOG
      # Set hostname if provided
      if [ -n "$NEW_HOSTNAME" ]; then
        echo "[$(date)] Setting hostname to: $NEW_HOSTNAME" >> $LOG
        hostnamectl set-hostname "$NEW_HOSTNAME" 2>> $LOG || true
        # Update /etc/hosts
        sed -i "s/127.0.1.1.*/127.0.1.1 $NEW_HOSTNAME/" /etc/hosts 2>> $LOG || true
        echo "[$(date)] Hostname set to: $(hostname)" >> $LOG
      fi
      # Auto-detect the virtio network interface
      IFACE=$(ip -o link show | grep -E 'ens|enp|eth' | grep -v lo | head -1 | awk -F': ' '{print $2}')
      if [ -z "$IFACE" ]; then
        echo "[$(date)] ERROR: Could not detect network interface" >> $LOG
        echo "ERROR: No interface"
        exit 1
      fi
      echo "[$(date)] Detected interface: $IFACE" >> $LOG
      CURRENT_MAC=$(cat /sys/class/net/$IFACE/address 2>/dev/null)
      echo "[$(date)] Current MAC: $CURRENT_MAC" >> $LOG
      # If new MAC provided and different, change it
      if [ -n "$NEW_MAC" ] && [ "$NEW_MAC" != "$CURRENT_MAC" ]; then
        echo "[$(date)] Changing MAC from $CURRENT_MAC to $NEW_MAC" >> $LOG
        ip link set $IFACE down 2>> $LOG
        ip link set $IFACE address $NEW_MAC 2>> $LOG
        ip link set $IFACE up 2>> $LOG
        sleep 0.2
      fi
      # Release old DHCP lease and get new one
      if command -v dhclient &> /dev/null; then
        dhclient -r $IFACE 2>> $LOG || true
        dhclient $IFACE 2>> $LOG || true
      else
        networkctl reconfigure $IFACE 2>> $LOG || true
      fi
      # Wait briefly for IP assignment (dnsmasq static leases are fast)
      for i in 1 2 3 4 5; do
        NEW_IP=$(ip -4 addr show $IFACE | grep -oP '(?<=inet )\\d+(\\.\\d+){3}' | head -1)
        if [ -n "$NEW_IP" ]; then
          break
        fi
        sleep 0.2
      done
      echo "[$(date)] New IP: $NEW_IP" >> $LOG
      echo "$NEW_IP"
  # Vsock listener service - listens for commands from host
  - path: /usr/local/bin/vsock-agent.py
    permissions: '0755'
    content: |
      #!/usr/bin/env python3
      """VSOCK agent that listens for commands from the host."""
      import socket
      import subprocess
      import sys
      VSOCK_PORT = 5000
      CID_HOST = 2  # Host CID
      def handle_command(cmd):
          cmd = cmd.strip()
          # RECONFIGURE_NETWORK [MAC] [HOSTNAME] - reconfigure network with optional new MAC and hostname
          if cmd.startswith("RECONFIGURE_NETWORK"):
              parts = cmd.split(" ")
              mac = parts[1] if len(parts) > 1 else ""
              hostname = parts[2] if len(parts) > 2 else ""
              try:
                  args = ["/usr/local/bin/reconfigure-network.sh", mac, hostname]
                  result = subprocess.run(
                      args, capture_output=True, text=True, timeout=30
                  )
                  new_ip = result.stdout.strip().split("\\n")[-1]
                  return f"OK:{new_ip}"
              except Exception as e:
                  return f"ERROR:{e}"
          elif cmd == "PING":
              return "PONG"
          else:
              return "UNKNOWN_COMMAND"
      def main():
          sock = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
          sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
          sock.bind((socket.VMADDR_CID_ANY, VSOCK_PORT))
          sock.listen(5)
          print(f"VSOCK agent listening on port {VSOCK_PORT}")
          while True:
              try:
                  conn, addr = sock.accept()
                  data = conn.recv(1024).decode('utf-8')
                  if data:
                      response = handle_command(data)
                      conn.send(response.encode('utf-8'))
                  conn.close()
              except Exception as e:
                  print(f"Error: {e}", file=sys.stderr)
      if __name__ == "__main__":
          main()
  # Systemd service for vsock agent
  - path: /etc/systemd/system/vsock-agent.service
    content: |
      [Unit]
      Description=VSOCK Agent for host-guest communication
      After=network.target
      [Service]
      Type=simple
      ExecStart=/usr/bin/python3 /usr/local/bin/vsock-agent.py
      Restart=always
      RestartSec=5
      [Install]
      WantedBy=multi-user.target
  # Package installation script (runs in background, output to console)
  - path: /usr/local/bin/install-packages.sh
    permissions: '0755'
    content: |
      #!/bin/bash
      exec > >(tee -a /dev/console /var/log/package-install.log) 2>&1
      echo "[packages] Starting package installation..."
      apt-get update -qq
      echo "[packages] Installing: curl git build-essential python3 nodejs npm..."
      DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Use-Pty=0 curl git build-essential python3 python3-pip nodejs npm 2>&1 | \
        grep -E "^(Unpacking|Setting up|Preparing)" | while read line; do echo "[apt] $line"; done
      echo "[packages] Installing npm global packages..."
      npm install -g --silent typescript tsx @types/node 2>&1 | tail -3
      echo "[packages] Installation complete!"
      touch /var/lib/cloud/instance/packages-installed
runcmd:
  - systemctl enable ssh
  - systemctl start ssh
  - systemctl daemon-reload
  - systemctl enable vsock-agent.service
  - systemctl start vsock-agent.service
  # Run package installation in background (output goes to console via script)
  - nohup /usr/local/bin/install-packages.sh &
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

    // Add vsock for host-guest communication (used for network reconfiguration on restore)
    const vsockPath = path.join(vmDir, 'vsock.sock');
    args.push('--vsock', `cid=3,socket=${vsockPath}`);

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

    // If this is a warmup VM being deleted, clear the warmup status (unless it's an error)
    if (vm.name.startsWith('warmup-')) {
      const baseImage = vm.name.replace('warmup-', '');
      const status = this.warmupStatus.get(baseImage);
      // Only clear if not in error state - preserve error for user visibility
      if (!status || status.phase !== 'error') {
        this.clearWarmupStatus(baseImage);
        console.log(`[HypervisorService] Cleared warmup status for ${baseImage}`);
      }
    }

    // Stop if running
    if (vm.status === 'running' || vm.status === 'booting' || vm.status === 'creating') {
      await this.stopVm(id);
    }

    // Release SSH port
    this.releaseSshPort(vm.sshPort);

    // Release TAP device (async for helper mode)
    if (vm.networkConfig.tapDevice) {
      await this.networkPool.releaseAsync(vm.networkConfig.tapDevice, id);
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
    const diskPath = path.join(snapshotDir, 'disk.qcow2');
    if (!fs.existsSync(snapshotDir)) return false;
    const files = fs.readdirSync(snapshotDir);
    const hasMemoryRanges = files.some(f => f.startsWith('memory-ranges'));
    return fs.existsSync(configPath) && fs.existsSync(statePath) && fs.existsSync(diskPath) && hasMemoryRanges;
  }

  /**
   * Check if fast boot can be used for a VM (restore from user snapshot only)
   * Note: Warmup snapshots (cross-VM) are disabled - only per-VM snapshots are supported
   */
  private canUseFastBoot(vm: VmState, _vmDir: string): boolean {
    // Only use fast boot for VMs created from a user snapshot (same VM restore)
    // Warmup snapshots (cross-VM) are disabled due to network identity issues
    return !!vm.sourceSnapshot;
  }

  /**
   * Build restore command for fast boot (from per-VM snapshot)
   * Note: Only per-VM snapshots are supported (same VM pause/resume)
   */
  private buildRestoreCommand(vm: VmState, vmDir: string, apiSocket: string, logFile: string): string {
    const restoreDir = path.join(vmDir, 'restore');
    const vmDiskPath = path.join(vmDir, 'disk.qcow2');

    // Per-VM snapshot - files already copied by createVm
    if (!vm.sourceSnapshot) {
      throw new Error('buildRestoreCommand called without sourceSnapshot - this should not happen');
    }
    const snapshotSourceDir = vm.sourceSnapshot.snapshotDir;
    console.log(`[HypervisorService] Restoring from per-VM snapshot: ${vm.sourceSnapshot.snapshotId}`);

    // Create restore directory and copy snapshot files
    if (!fs.existsSync(restoreDir)) {
      fs.mkdirSync(restoreDir, { recursive: true });
    }

    // Copy snapshot files to VM's restore directory
    const snapshotFiles = fs.readdirSync(snapshotSourceDir);
    for (const file of snapshotFiles) {
      if (file.startsWith('memory-ranges') || file === 'state.json') {
        fs.copyFileSync(path.join(snapshotSourceDir, file), path.join(restoreDir, file));
      }
    }

    // Update config.json with correct paths for this VM
    // The snapshot config has paths to the old VM which no longer exists
    const snapshotConfig = JSON.parse(fs.readFileSync(path.join(snapshotSourceDir, 'config.json'), 'utf-8'));

    // Update disk paths
    if (snapshotConfig.disks && Array.isArray(snapshotConfig.disks)) {
      for (const disk of snapshotConfig.disks) {
        if (disk.path && disk.path.includes('/disk.qcow2')) {
          disk.path = vmDiskPath;
        }
        // Remove cloudinit disk - not needed after boot
        if (disk.path && disk.path.includes('cloudinit.iso')) {
          disk.path = null; // Will be filtered out
        }
      }
      // Filter out disks with null paths
      snapshotConfig.disks = snapshotConfig.disks.filter((d: { path: string | null }) => d.path !== null);
    }

    // Update network config with new TAP device and MAC address
    // This ensures the restored VM uses the correct network configuration
    if (snapshotConfig.net && Array.isArray(snapshotConfig.net) && vm.networkConfig.mode === 'tap') {
      for (const net of snapshotConfig.net) {
        net.tap = vm.networkConfig.tapDevice;
        net.mac = vm.networkConfig.macAddress;
        // Remove host_mac to prevent cloud-hypervisor from trying to set it on the new TAP
        // (requires CAP_NET_ADMIN which we don't have)
        delete net.host_mac;
      }
    }

    // Update serial console path to point to new VM's console.log
    if (snapshotConfig.serial && snapshotConfig.serial.file) {
      snapshotConfig.serial.file = path.join(vmDir, 'console.log');
    }

    // Update vsock socket path to point to new VM's vsock.sock
    if (snapshotConfig.vsock && snapshotConfig.vsock.socket) {
      snapshotConfig.vsock.socket = path.join(vmDir, 'vsock.sock');
    }

    fs.writeFileSync(path.join(restoreDir, 'config.json'), JSON.stringify(snapshotConfig));

    // Restore command - according to cloud-hypervisor docs, only api-socket and restore are needed
    // All device configuration comes from the snapshot's config.json
    const args = [
      `--api-socket ${apiSocket}`,
      `--restore source_url=file://${restoreDir}`,
      `--log-file ${logFile}`,
      '-v',
    ];

    return `${this.config.hypervisorBinary} ${args.join(' ')}`;
  }

  /**
   * Create fast boot cache for a base image
   * Note: Warmup snapshots (cross-VM) are disabled. Fresh boot is used instead.
   * Per-VM snapshots are used for resume functionality.
   */
  async warmupBaseImage(_baseImage: string): Promise<SnapshotInfo | null> {
    // Warmup disabled - cross-VM snapshots are not supported due to network identity issues
    // (each VM needs a unique MAC address, but snapshot state.json contains baked-in MAC)
    // Fresh boot (~10-30s) is used for new VMs instead
    // Per-VM snapshots are used for pause/resume functionality
    console.log('[HypervisorService] Warmup disabled - fresh boot used instead');
    return null;
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

  /**
   * Download a base image and its kernel/initrd from URLs
   */
  async downloadBaseImage(
    name: string,
    imageUrl: string,
    kernelUrl: string,
    initrdUrl: string,
    onProgress: (phase: string, progress: number, message: string) => void
  ): Promise<void> {
    const imageDir = path.join(this.config.baseImagesDir, name);
    const imagePath = path.join(imageDir, 'image.qcow2');
    const kernelPath = path.join(imageDir, 'kernel');
    const initrdPath = path.join(imageDir, 'initrd');

    // Check if image already exists
    if (fs.existsSync(imageDir)) {
      throw new Error(`Base image "${name}" already exists`);
    }

    // Create image directory
    fs.mkdirSync(imageDir, { recursive: true });
    console.log(`[Hypervisor] Downloading base image ${name}`);

    try {
      // Phase 1: Download the disk image (largest file, takes most time)
      onProgress('downloading', 0, 'Downloading disk image...');

      await this.downloadFile(imageUrl, imagePath, (percent) => {
        onProgress('downloading', Math.round(percent * 0.7), `Downloading disk image... ${Math.round(percent)}%`);
      });

      console.log(`[Hypervisor] Downloaded disk image to ${imagePath}`);

      // Phase 2: Download kernel
      onProgress('downloading', 70, 'Downloading kernel...');

      await this.downloadFile(kernelUrl, kernelPath, (percent) => {
        onProgress('downloading', 70 + Math.round(percent * 0.1), `Downloading kernel... ${Math.round(percent)}%`);
      });

      console.log(`[Hypervisor] Downloaded kernel to ${kernelPath}`);

      // Phase 3: Download initrd
      onProgress('downloading', 80, 'Downloading initrd...');

      await this.downloadFile(initrdUrl, initrdPath, (percent) => {
        onProgress('downloading', 80 + Math.round(percent * 0.1), `Downloading initrd... ${Math.round(percent)}%`);
      });

      console.log(`[Hypervisor] Downloaded initrd to ${initrdPath}`);

      // Verify downloads
      if (!fs.existsSync(kernelPath) || !fs.existsSync(initrdPath)) {
        throw new Error('Failed to download kernel or initrd');
      }

      // Phase 4: Resize image if needed
      onProgress('finalizing', 90, 'Finalizing image...');

      const MIN_SIZE_GB = 25;
      const output = execSync(`qemu-img info --output=json "${imagePath}"`, { encoding: 'utf-8' });
      const info = JSON.parse(output);
      const currentSizeGB = info['virtual-size'] / (1024 * 1024 * 1024);

      if (currentSizeGB < MIN_SIZE_GB) {
        onProgress('finalizing', 95, `Resizing image to ${MIN_SIZE_GB}GB...`);
        execSync(`qemu-img resize "${imagePath}" ${MIN_SIZE_GB}G`);
      }

      onProgress('complete', 100, 'Base image ready');
      console.log(`[Hypervisor] Base image ${name} is ready`);

    } catch (error) {
      // Clean up on failure
      if (fs.existsSync(imageDir)) {
        fs.rmSync(imageDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * Download a file with progress tracking
   */
  private async downloadFile(
    url: string,
    destPath: string,
    onProgress: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tempPath = `${destPath}.tmp`;

      // Use wget for robust downloading with progress
      const wget = spawn('wget', [
        '-q', '--show-progress', '--progress=dot:giga',
        '-O', tempPath,
        url
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let lastPercent = 0;

      // wget outputs progress to stderr
      wget.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        // Parse wget progress output (e.g., "50%" or dots)
        const percentMatch = output.match(/(\d+)%/);
        if (percentMatch) {
          const percent = parseInt(percentMatch[1], 10);
          if (percent > lastPercent) {
            lastPercent = percent;
            onProgress(percent);
          }
        }
      });

      wget.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempPath)) {
          fs.renameSync(tempPath, destPath);
          resolve();
        } else {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
          reject(new Error(`Download failed with code ${code}`));
        }
      });

      wget.on('error', (err) => {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        reject(err);
      });
    });
  }

  /**
   * Create a user snapshot of a VM
   * The VM must be paused first
   */
  async createUserVmSnapshot(id: string, name: string): Promise<SnapshotInfo> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    // Pause the VM if running
    const wasRunning = vm.status === 'running';
    if (wasRunning) {
      await this.pauseVm(id);
    }

    try {
      const vmDir = path.join(this.config.dataDir, id);
      const snapshotsDir = path.join(vmDir, 'snapshots');
      const snapshotId = `snap-${Date.now()}`;
      const snapshotDir = path.join(snapshotsDir, snapshotId);

      fs.mkdirSync(snapshotDir, { recursive: true });

      // Create the snapshot
      const snapshotInfo = await this.createVmSnapshot(id, snapshotDir);
      snapshotInfo.id = snapshotId;

      // Copy the VM's disk to the snapshot directory
      // This allows creating new VMs from this snapshot with CoW overlays
      const vmDiskPath = path.join(vmDir, 'disk.qcow2');
      const snapshotDiskPath = path.join(snapshotDir, 'disk.qcow2');
      if (fs.existsSync(vmDiskPath)) {
        fs.copyFileSync(vmDiskPath, snapshotDiskPath);
        console.log(`[Hypervisor] Copied disk to snapshot`);
      }

      // Save snapshot metadata with resource config for restoring
      const metadataPath = path.join(snapshotDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify({
        id: snapshotId,
        name,
        vmId: id,
        vmName: vm.name,
        baseImage: vm.baseImage,
        vcpus: vm.vcpus,
        memoryMb: vm.memoryMb,
        diskGb: vm.diskGb,
        createdAt: snapshotInfo.createdAt,
      }, null, 2));

      console.log(`[Hypervisor] Created snapshot ${snapshotId} for VM ${id}`);
      return snapshotInfo;
    } finally {
      // Resume VM if it was running before
      if (wasRunning) {
        await this.resumeVm(id);
      }
    }
  }

  /**
   * Resume a paused VM
   */
  async resumeVm(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status !== 'paused') {
      throw new Error(`VM ${id} is not paused (status: ${vm.status})`);
    }

    if (!vm.apiSocket || !fs.existsSync(vm.apiSocket)) {
      throw new Error(`VM ${id} has no API socket`);
    }

    await this.sendVmApiRequest(vm.apiSocket, 'PUT', '/api/v1/vm.resume');

    vm.status = 'running';
    await this.saveVmState(vm);
    console.log(`[Hypervisor] Resumed VM ${id}`);
  }

  /**
   * List all snapshots for a VM
   */
  listVmSnapshots(id: string): SnapshotInfo[] {
    const vm = this.vms.get(id);
    if (!vm) {
      // Return empty array for non-existent VMs (graceful handling for deleted VMs)
      return [];
    }

    const vmDir = path.join(this.config.dataDir, id);
    const snapshotsDir = path.join(vmDir, 'snapshots');

    if (!fs.existsSync(snapshotsDir)) {
      return [];
    }

    const snapshots: SnapshotInfo[] = [];
    const snapshotDirs = fs.readdirSync(snapshotsDir);
    const quickLaunchDefault = this.getQuickLaunchDefault();

    for (const snapshotId of snapshotDirs) {
      const snapshotDir = path.join(snapshotsDir, snapshotId);
      const metadataPath = path.join(snapshotDir, 'metadata.json');
      const configPath = path.join(snapshotDir, 'config.json');
      const statePath = path.join(snapshotDir, 'state.json');

      if (!fs.existsSync(metadataPath)) continue;

      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        const isQuickLaunchDefault = quickLaunchDefault?.vmId === id && quickLaunchDefault?.snapshotId === snapshotId;
        snapshots.push({
          id: snapshotId,
          vmId: id,
          baseImage: metadata.baseImage || vm.baseImage,
          configPath,
          snapshotFile: statePath,
          memoryRanges: this.findMemoryRangeFiles(snapshotDir),
          createdAt: metadata.createdAt,
          name: metadata.name,
          isQuickLaunchDefault,
        });
      } catch (e) {
        console.error(`[Hypervisor] Failed to read snapshot ${snapshotId}:`, e);
      }
    }

    return snapshots.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * List all snapshots from all VMs (includes isQuickLaunchDefault flag)
   */
  listAllSnapshots(): (SnapshotInfo & { vmName: string })[] {
    const allSnapshots: (SnapshotInfo & { vmName: string })[] = [];

    for (const [vmId, vm] of this.vms) {
      // Skip warmup VMs
      if (vm.name.startsWith('warmup-')) continue;

      try {
        const vmSnapshots = this.listVmSnapshots(vmId);
        for (const snapshot of vmSnapshots) {
          allSnapshots.push({
            ...snapshot,
            vmName: vm.name,
          });
        }
      } catch (e) {
        console.error(`[Hypervisor] Failed to list snapshots for VM ${vmId}:`, e);
      }
    }

    return allSnapshots.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Delete a VM snapshot
   */
  deleteVmSnapshot(vmId: string, snapshotId: string): void {
    const vm = this.vms.get(vmId);
    if (!vm) {
      // VM doesn't exist, snapshot also doesn't exist - silently succeed
      return;
    }

    const vmDir = path.join(this.config.dataDir, vmId);
    const snapshotDir = path.join(vmDir, 'snapshots', snapshotId);

    if (!fs.existsSync(snapshotDir)) {
      // Snapshot doesn't exist - silently succeed (idempotent delete)
      return;
    }

    // Clear quick launch default if this snapshot was the default
    const quickLaunchDefault = this.getQuickLaunchDefault();
    if (quickLaunchDefault?.vmId === vmId && quickLaunchDefault?.snapshotId === snapshotId) {
      this.clearQuickLaunchDefault();
    }

    fs.rmSync(snapshotDir, { recursive: true, force: true });
    console.log(`[Hypervisor] Deleted snapshot ${snapshotId} for VM ${vmId}`);
  }

  /**
   * Get quick launch default settings file path
   */
  private getQuickLaunchSettingsPath(): string {
    return path.join(path.dirname(this.config.dataDir), 'quick-launch-default.json');
  }

  /**
   * Get the default snapshot for quick launch
   */
  getQuickLaunchDefault(): { vmId: string; snapshotId: string } | null {
    const settingsPath = this.getQuickLaunchSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return null;
    }

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.vmId && settings.snapshotId) {
        // Verify the snapshot still exists
        const vmDir = path.join(this.config.dataDir, settings.vmId);
        const snapshotDir = path.join(vmDir, 'snapshots', settings.snapshotId);
        if (fs.existsSync(snapshotDir)) {
          return { vmId: settings.vmId, snapshotId: settings.snapshotId };
        }
      }
      return null;
    } catch (e) {
      console.error('[Hypervisor] Failed to read quick launch default:', e);
      return null;
    }
  }

  /**
   * Set a snapshot as the default for quick launch
   */
  setQuickLaunchDefault(vmId: string, snapshotId: string): void {
    // Verify the snapshot exists
    const vmDir = path.join(this.config.dataDir, vmId);
    const snapshotDir = path.join(vmDir, 'snapshots', snapshotId);
    if (!fs.existsSync(snapshotDir)) {
      throw new Error(`Snapshot ${snapshotId} not found for VM ${vmId}`);
    }

    const settingsPath = this.getQuickLaunchSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify({ vmId, snapshotId }, null, 2));
    console.log(`[Hypervisor] Set quick launch default to snapshot ${snapshotId} from VM ${vmId}`);
  }

  /**
   * Clear the quick launch default
   */
  clearQuickLaunchDefault(): void {
    const settingsPath = this.getQuickLaunchSettingsPath();
    if (fs.existsSync(settingsPath)) {
      fs.unlinkSync(settingsPath);
      console.log('[Hypervisor] Cleared quick launch default');
    }
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
