/**
 * FirecrackerService - Firecracker MicroVM Management
 * Manages virtual machines using Firecracker for the Agent Containers platform.
 *
 * Key difference from cloud-hypervisor: Uses MMDS (MicroVM Metadata Service) for
 * guest identity, enabling fast snapshot restore with dynamic network configuration.
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as crypto from 'crypto';
import * as http from 'http';
import {
  FirecrackerConfig,
  DEFAULT_FIRECRACKER_CONFIG,
  FirecrackerVmState,
  FirecrackerSnapshotInfo,
  MmdsMetadata,
  MmdsConfig,
  BootSource,
  Drive,
  NetworkInterface,
  MachineConfig,
  SnapshotCreateParams,
  SnapshotLoadParams,
} from '../types/firecracker.js';
import { VmConfig, VmInfo, VmState, SnapshotInfo } from '../types/vm.js';
import { NetworkPool, TapAllocation } from './network-pool.js';

export class FirecrackerService extends EventEmitter {
  private config: FirecrackerConfig;
  private vms: Map<string, FirecrackerVmState> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private allocatedPorts: Set<number> = new Set();
  private initialized: boolean = false;
  private networkPool: NetworkPool;

  constructor(config: Partial<FirecrackerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_FIRECRACKER_CONFIG, ...config };

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
   * Initialize the Firecracker service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[FirecrackerService] Initializing...');

    // Create required directories
    await this.ensureDirectories();

    // Check for firecracker binary
    await this.checkFirecrackerBinary();

    // Ensure SSH keys exist (shared with cloud-hypervisor)
    await this.ensureSshKeys();

    // Load existing VM states from disk
    await this.loadVmStates();

    // Sync VM states with running processes
    await this.syncVmStates();

    // Initialize network pool (detects helper vs pool mode)
    await this.networkPool.initialize();

    this.initialized = true;
    console.log(`[FirecrackerService] Initialized with ${this.vms.size} VMs`);

    this.emit('firecracker:initialized');
  }

  /**
   * Create necessary directories
   */
  private async ensureDirectories(): Promise<void> {
    const dirs = [this.config.dataDir, this.config.baseImagesDir, this.config.sshKeysDir];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        console.log(`[FirecrackerService] Created directory: ${dir}`);
      }
    }
  }

  /**
   * Check if firecracker binary exists
   */
  private async checkFirecrackerBinary(): Promise<void> {
    if (!fs.existsSync(this.config.firecrackerBinary)) {
      console.warn(`[FirecrackerService] Firecracker not found at ${this.config.firecrackerBinary}`);
      try {
        const whichResult = execSync('which firecracker', { encoding: 'utf-8' }).trim();
        if (whichResult) {
          this.config.firecrackerBinary = whichResult;
          console.log(`[FirecrackerService] Found firecracker at: ${whichResult}`);
        }
      } catch {
        console.warn('[FirecrackerService] Firecracker not found in PATH. VMs will fail to start.');
        console.warn('[FirecrackerService] Run: sudo ./scripts/install-firecracker.sh');
      }
    }
  }

  /**
   * Ensure SSH keys exist (shared with cloud-hypervisor)
   */
  private async ensureSshKeys(): Promise<void> {
    const privateKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519');

    if (!fs.existsSync(privateKeyPath)) {
      console.log('[FirecrackerService] Generating SSH keys');
      try {
        execSync(`ssh-keygen -t ed25519 -f ${privateKeyPath} -N "" -q`, {
          encoding: 'utf-8',
        });
        fs.chmodSync(privateKeyPath, 0o600);
        console.log('[FirecrackerService] SSH keys generated');
      } catch (error) {
        console.error('[FirecrackerService] Failed to generate SSH keys:', error);
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
            const state = JSON.parse(stateJson) as FirecrackerVmState;
            this.vms.set(state.id, state);
            if (state.sshPort) {
              this.allocatedPorts.add(state.sshPort);
            }
          } catch (error) {
            console.error(`[FirecrackerService] Failed to load VM state from ${statePath}:`, error);
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
          console.warn(`[FirecrackerService] VM ${id} was running but process ${vm.pid} is gone`);
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
  private async saveVmState(vm: FirecrackerVmState): Promise<void> {
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
    return 'fc-' + crypto.randomUUID().slice(0, 8);
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
    console.log(`[FirecrackerService] Creating VM: ${config.name}`);

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
        tapAllocation = await this.networkPool.allocateAsync(id);
        networkMode = 'tap';
        console.log(`[FirecrackerService] Allocated TAP ${tapAllocation.tapName} for VM ${id}`);
      } else {
        console.warn(`[FirecrackerService] No TAP available for VM ${id}: ${status.message}`);
      }
    } catch (error) {
      console.warn(`[FirecrackerService] Failed to allocate TAP for VM ${id}:`, error);
    }

    // Get resource configuration
    const baseImage = config.baseImage || this.config.defaultBaseImage;
    const vcpus = config.vcpus || this.config.defaultVcpus;
    const memoryMb = config.memoryMb || this.config.defaultMemoryMb;
    const diskGb = config.diskGb || this.config.defaultDiskGb;

    // Build MMDS metadata
    const sshPubKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519.pub');
    const sshPublicKey = fs.existsSync(sshPubKeyPath)
      ? fs.readFileSync(sshPubKeyPath, 'utf-8').trim()
      : '';

    const mmdsMetadata: MmdsMetadata = {
      instance: {
        id,
        name: config.name,
        hostname: config.name,
      },
      network: {
        interfaces: {
          eth0: {
            mac: tapAllocation?.macAddress || this.generateMacAddress(),
            ipv4: {
              address: tapAllocation?.guestIp || '0.0.0.0',
              netmask: '255.255.255.0',
              gateway: tapAllocation?.gateway || '0.0.0.0',
            },
          },
        },
        dns: ['8.8.8.8', '8.8.4.4'],
      },
      ssh: {
        authorized_keys: sshPublicKey ? [sshPublicKey] : [],
      },
    };

    // Create initial state
    const vm: FirecrackerVmState = {
      id,
      name: config.name,
      status: 'creating',
      sshPort,
      guestIp: tapAllocation?.guestIp,
      networkConfig: {
        mode: networkMode,
        tapDevice: tapAllocation?.tapName,
        bridgeName: tapAllocation?.bridgeName,
        macAddress: tapAllocation?.macAddress || mmdsMetadata.network.interfaces.eth0.mac,
        guestIp: tapAllocation?.guestIp,
        gateway: tapAllocation?.gateway,
      },
      portMappings: config.portMappings || [],
      baseImage,
      vcpus,
      memoryMb,
      diskGb,
      volumes: config.volumes || [],
      mmdsMetadata,
      createdAt: new Date().toISOString(),
    };

    this.vms.set(id, vm);
    await this.saveVmState(vm);

    this.emit('vm:created', vm);
    console.log(`[FirecrackerService] VM ${id} created`);

    // Auto-start if requested
    if (config.autoStart !== false) {
      try {
        await this.startVm(id);
      } catch (error) {
        console.error(`[FirecrackerService] Failed to auto-start VM ${id}:`, error);
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
      console.warn(`[FirecrackerService] VM ${id} is already running`);
      return this.vmToInfo(vm);
    }

    console.log(`[FirecrackerService] Starting VM ${id} (${vm.name})`);

    const vmDir = path.join(this.config.dataDir, id);
    const apiSocket = path.join(vmDir, 'api.sock');
    const logFile = path.join(vmDir, 'firecracker.log');

    try {
      // Remove old socket if exists
      if (fs.existsSync(apiSocket)) {
        fs.unlinkSync(apiSocket);
      }

      // Prepare disk image (copy or create overlay)
      await this.prepareDiskImage(vm, vmDir);

      // Spawn Firecracker process
      const logFd = fs.openSync(logFile, 'a');

      const proc = spawn('sg', ['kvm', '-c', `${this.config.firecrackerBinary} --api-sock ${apiSocket}`], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });

      fs.closeSync(logFd);
      proc.unref();
      this.processes.set(id, proc);

      vm.pid = proc.pid;
      vm.apiSocket = apiSocket;
      vm.status = 'creating';
      vm.startedAt = new Date().toISOString();
      vm.error = undefined;

      await this.saveVmState(vm);

      // Configure and start VM in background
      this.configureAndStartVm(id, vmDir, apiSocket);

      console.log(`[FirecrackerService] VM ${id} starting with PID ${proc.pid}`);

      return this.vmToInfo(vm);
    } catch (error) {
      vm.status = 'error';
      vm.error = String(error);
      await this.saveVmState(vm);
      throw error;
    }
  }

  /**
   * Prepare disk image for the VM
   */
  private async prepareDiskImage(vm: FirecrackerVmState, vmDir: string): Promise<string> {
    const baseImageDir = path.join(this.config.baseImagesDir, vm.baseImage);
    const baseImagePath = path.join(baseImageDir, 'rootfs.ext4');
    const vmDiskPath = path.join(vmDir, 'rootfs.ext4');

    // Check for Firecracker-specific image first
    if (fs.existsSync(baseImagePath)) {
      // Copy base image (Firecracker needs writable disk)
      if (!fs.existsSync(vmDiskPath)) {
        console.log(`[FirecrackerService] Copying base image to ${vmDiskPath}`);
        fs.copyFileSync(baseImagePath, vmDiskPath);
      }
    } else {
      // Check for QCOW2 image and convert
      const qcow2Path = path.join(baseImageDir, 'image.qcow2');
      if (fs.existsSync(qcow2Path)) {
        console.log(`[FirecrackerService] Converting QCOW2 to raw for Firecracker`);
        execSync(`qemu-img convert -f qcow2 -O raw "${qcow2Path}" "${vmDiskPath}"`, {
          stdio: 'pipe',
        });
      } else {
        throw new Error(`Base image not found: ${vm.baseImage}. Run scripts/prepare-fc-image.sh first.`);
      }
    }

    return vmDiskPath;
  }

  /**
   * Configure and start the VM via Firecracker API
   */
  private async configureAndStartVm(id: string, vmDir: string, apiSocket: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) return;

    const startTime = Date.now();

    try {
      // Wait for API socket to be ready
      await this.waitForApiSocket(apiSocket, 10000);
      console.log(`[FirecrackerService] API socket ready in ${Date.now() - startTime}ms`);

      // Get kernel path
      const baseImageDir = path.join(this.config.baseImagesDir, vm.baseImage);
      const kernelPath = path.join(baseImageDir, 'vmlinux');
      const diskPath = path.join(vmDir, 'rootfs.ext4');

      if (!fs.existsSync(kernelPath)) {
        throw new Error(`Kernel not found: ${kernelPath}. Run scripts/prepare-fc-image.sh first.`);
      }

      // 1. Configure boot source
      await this.sendApiRequest(apiSocket, 'PUT', '/boot-source', {
        kernel_image_path: kernelPath,
        boot_args: 'console=ttyS0 reboot=k panic=1 pci=off init=/sbin/init',
      } as BootSource);

      // 2. Configure root drive
      await this.sendApiRequest(apiSocket, 'PUT', '/drives/rootfs', {
        drive_id: 'rootfs',
        path_on_host: diskPath,
        is_root_device: true,
        is_read_only: false,
      } as Drive);

      // 3. Configure network interface (if TAP available)
      if (vm.networkConfig.mode === 'tap' && vm.networkConfig.tapDevice) {
        await this.sendApiRequest(apiSocket, 'PUT', '/network-interfaces/eth0', {
          iface_id: 'eth0',
          host_dev_name: vm.networkConfig.tapDevice,
          guest_mac: vm.networkConfig.macAddress,
        } as NetworkInterface);
      }

      // 4. Configure machine
      await this.sendApiRequest(apiSocket, 'PUT', '/machine-config', {
        vcpu_count: vm.vcpus,
        mem_size_mib: vm.memoryMb,
      } as MachineConfig);

      // 5. Configure MMDS
      if (vm.networkConfig.mode === 'tap') {
        await this.sendApiRequest(apiSocket, 'PUT', '/mmds/config', {
          network_interfaces: ['eth0'],
          version: 'V2',
          ipv4_address: '169.254.169.254',
        } as MmdsConfig);

        // 6. Set MMDS metadata
        if (vm.mmdsMetadata) {
          await this.sendApiRequest(apiSocket, 'PUT', '/mmds', vm.mmdsMetadata);
        }
      }

      // 7. Start the VM
      await this.sendApiRequest(apiSocket, 'PUT', '/actions', {
        action_type: 'InstanceStart',
      });

      vm.status = 'booting';
      await this.saveVmState(vm);
      this.emit('vm:booting', vm);
      console.log(`[FirecrackerService] VM ${id} is booting`);

      // Wait for SSH to be reachable
      await this.waitForSshReady(id);

      vm.status = 'running';
      await this.saveVmState(vm);
      this.emit('vm:started', vm);
      console.log(`[FirecrackerService] VM ${id} is running in ${Date.now() - startTime}ms`);

    } catch (error) {
      console.error(`[FirecrackerService] VM ${id} failed to start:`, error);
      vm.status = 'error';
      vm.error = `Failed to start: ${error}`;
      await this.saveVmState(vm);
      this.emit('vm:error', { vm, error });
    }
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

        setTimeout(check, 50);
      };

      check();
    });
  }

  /**
   * Send a request to the Firecracker API socket
   */
  private async sendApiRequest(
    socketPath: string,
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      let response = '';
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          reject(new Error(`API request timeout: ${method} ${endpoint}`));
        }
      }, 10000);

      socket.on('connect', () => {
        const bodyStr = body ? JSON.stringify(body) : '';
        const request = [
          `${method} ${endpoint} HTTP/1.1`,
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
   * Stop a VM
   */
  async stopVm(id: string): Promise<VmInfo> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status !== 'running' && vm.status !== 'booting' && vm.status !== 'paused') {
      console.warn(`[FirecrackerService] VM ${id} is not running (status: ${vm.status})`);
      return this.vmToInfo(vm);
    }

    console.log(`[FirecrackerService] Stopping VM ${id}`);

    try {
      // Try graceful shutdown via API
      if (vm.apiSocket && fs.existsSync(vm.apiSocket)) {
        try {
          await this.sendApiRequest(vm.apiSocket, 'PUT', '/actions', {
            action_type: 'SendCtrlAltDel',
          });
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch {
          // Guest may already be stopped
        }
      }

      // Kill process if still running
      if (vm.pid && this.isProcessRunning(vm.pid)) {
        process.kill(vm.pid, 'SIGTERM');
        await this.waitForProcessExit(vm.pid, 3000);
      }
    } catch (error) {
      console.warn(`[FirecrackerService] Graceful shutdown failed for VM ${id}, forcing kill`);
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
    console.log(`[FirecrackerService] VM ${id} stopped`);

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

    console.log(`[FirecrackerService] Deleting VM ${id}`);

    // Stop if running
    if (vm.status === 'running' || vm.status === 'booting' || vm.status === 'creating') {
      await this.stopVm(id);
    }

    // Release SSH port
    this.releaseSshPort(vm.sshPort);

    // Release TAP device
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
    console.log(`[FirecrackerService] VM ${id} deleted`);
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

    await this.sendApiRequest(vm.apiSocket, 'PATCH', '/vm', { state: 'Paused' });

    vm.status = 'paused';
    await this.saveVmState(vm);
    console.log(`[FirecrackerService] VM ${id} paused`);
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

    await this.sendApiRequest(vm.apiSocket, 'PATCH', '/vm', { state: 'Resumed' });

    vm.status = 'running';
    await this.saveVmState(vm);
    console.log(`[FirecrackerService] VM ${id} resumed`);
  }

  /**
   * Update MMDS metadata for a VM
   * This is the key feature for golden image restore - update identity before resuming
   */
  async setMmdsMetadata(id: string, metadata: MmdsMetadata): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (!vm.apiSocket || !fs.existsSync(vm.apiSocket)) {
      throw new Error(`VM ${id} has no API socket`);
    }

    await this.sendApiRequest(vm.apiSocket, 'PUT', '/mmds', metadata);
    vm.mmdsMetadata = metadata;
    await this.saveVmState(vm);
    console.log(`[FirecrackerService] Updated MMDS for VM ${id}`);
  }

  /**
   * Create a snapshot of a VM
   */
  async createSnapshot(id: string, name: string): Promise<FirecrackerSnapshotInfo> {
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

      const snapshotPath = path.join(snapshotDir, 'snapshot.bin');
      const memFilePath = path.join(snapshotDir, 'mem.bin');
      const diskPath = path.join(snapshotDir, 'rootfs.ext4');

      // Create snapshot via Firecracker API
      await this.sendApiRequest(vm.apiSocket!, 'PUT', '/snapshot/create', {
        snapshot_type: 'Full',
        snapshot_path: snapshotPath,
        mem_file_path: memFilePath,
      } as SnapshotCreateParams);

      // Copy disk image
      const vmDiskPath = path.join(vmDir, 'rootfs.ext4');
      if (fs.existsSync(vmDiskPath)) {
        fs.copyFileSync(vmDiskPath, diskPath);
      }

      // Save metadata
      const snapshotInfo: FirecrackerSnapshotInfo = {
        id: snapshotId,
        vmId: id,
        name,
        baseImage: vm.baseImage,
        snapshotPath,
        memFilePath,
        diskPath,
        mmdsMetadata: vm.mmdsMetadata!,
        vcpus: vm.vcpus,
        memoryMb: vm.memoryMb,
        diskGb: vm.diskGb,
        createdAt: new Date().toISOString(),
      };

      const metadataPath = path.join(snapshotDir, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(snapshotInfo, null, 2));

      console.log(`[FirecrackerService] Created snapshot ${snapshotId} for VM ${id}`);
      return snapshotInfo;

    } finally {
      // Resume VM if it was running
      if (wasRunning) {
        await this.resumeVm(id);
      }
    }
  }

  /**
   * Restore a VM from snapshot with new identity
   * This is the KEY FEATURE - updates MMDS before resuming so guest reconfigures network
   */
  async restoreFromSnapshot(
    snapshotDir: string,
    newConfig: { name: string; id?: string }
  ): Promise<VmInfo> {
    console.log(`[FirecrackerService] Restoring VM from snapshot: ${snapshotDir}`);

    const metadataPath = path.join(snapshotDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error('Snapshot metadata not found');
    }

    const snapshotMeta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as FirecrackerSnapshotInfo;

    // Create new VM identity
    const id = newConfig.id || this.generateVmId();
    const sshPort = this.allocateSshPort();
    const vmDir = path.join(this.config.dataDir, id);

    fs.mkdirSync(vmDir, { recursive: true });

    // Allocate new TAP device
    let tapAllocation: TapAllocation | null = null;
    let networkMode: 'tap' | 'none' = 'none';

    try {
      const status = this.networkPool.checkHealth();
      const poolMode = this.networkPool.getMode();

      if (poolMode === 'helper' || (status.healthy && status.availableTaps > 0)) {
        tapAllocation = await this.networkPool.allocateAsync(id);
        networkMode = 'tap';
        console.log(`[FirecrackerService] Allocated TAP ${tapAllocation.tapName} for restored VM ${id}`);
      }
    } catch (error) {
      console.warn(`[FirecrackerService] Failed to allocate TAP for restored VM ${id}:`, error);
    }

    // Copy snapshot files
    const snapshotPath = path.join(vmDir, 'snapshot.bin');
    const memFilePath = path.join(vmDir, 'mem.bin');
    const diskPath = path.join(vmDir, 'rootfs.ext4');
    const apiSocket = path.join(vmDir, 'api.sock');
    const logFile = path.join(vmDir, 'firecracker.log');

    fs.copyFileSync(snapshotMeta.snapshotPath, snapshotPath);
    fs.copyFileSync(snapshotMeta.memFilePath, memFilePath);
    fs.copyFileSync(snapshotMeta.diskPath, diskPath);

    // Build new MMDS metadata with new identity
    const sshPubKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519.pub');
    const sshPublicKey = fs.existsSync(sshPubKeyPath)
      ? fs.readFileSync(sshPubKeyPath, 'utf-8').trim()
      : '';

    const newMmdsMetadata: MmdsMetadata = {
      instance: {
        id,
        name: newConfig.name,
        hostname: newConfig.name,
      },
      network: {
        interfaces: {
          eth0: {
            mac: tapAllocation?.macAddress || this.generateMacAddress(),
            ipv4: {
              address: tapAllocation?.guestIp || '0.0.0.0',
              netmask: '255.255.255.0',
              gateway: tapAllocation?.gateway || '0.0.0.0',
            },
          },
        },
        dns: ['8.8.8.8', '8.8.4.4'],
      },
      ssh: {
        authorized_keys: sshPublicKey ? [sshPublicKey] : [],
      },
    };

    // Create VM state
    const vm: FirecrackerVmState = {
      id,
      name: newConfig.name,
      status: 'creating',
      sshPort,
      guestIp: tapAllocation?.guestIp,
      networkConfig: {
        mode: networkMode,
        tapDevice: tapAllocation?.tapName,
        bridgeName: tapAllocation?.bridgeName,
        macAddress: newMmdsMetadata.network.interfaces.eth0.mac,
        guestIp: tapAllocation?.guestIp,
        gateway: tapAllocation?.gateway,
      },
      portMappings: [],
      baseImage: snapshotMeta.baseImage,
      vcpus: snapshotMeta.vcpus,
      memoryMb: snapshotMeta.memoryMb,
      diskGb: snapshotMeta.diskGb,
      volumes: [],
      mmdsMetadata: newMmdsMetadata,
      sourceSnapshot: {
        vmId: snapshotMeta.vmId,
        snapshotId: snapshotMeta.id,
        snapshotDir,
      },
      createdAt: new Date().toISOString(),
    };

    this.vms.set(id, vm);
    await this.saveVmState(vm);

    // Start Firecracker process
    const logFd = fs.openSync(logFile, 'a');
    const proc = spawn('sg', ['kvm', '-c', `${this.config.firecrackerBinary} --api-sock ${apiSocket}`], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    fs.closeSync(logFd);
    proc.unref();
    this.processes.set(id, proc);

    vm.pid = proc.pid;
    vm.apiSocket = apiSocket;
    vm.startedAt = new Date().toISOString();
    await this.saveVmState(vm);

    const startTime = Date.now();

    try {
      // Wait for API socket
      await this.waitForApiSocket(apiSocket, 5000);
      console.log(`[FirecrackerService] API socket ready in ${Date.now() - startTime}ms`);

      // Load snapshot (don't resume yet!)
      await this.sendApiRequest(apiSocket, 'PUT', '/snapshot/load', {
        snapshot_path: snapshotPath,
        mem_backend: {
          backend_type: 'File',
          backend_path: memFilePath,
        },
        enable_diff_snapshots: false,
        resume_vm: false,  // DON'T RESUME YET - need to update MMDS first
      } as SnapshotLoadParams);

      console.log(`[FirecrackerService] Snapshot loaded in ${Date.now() - startTime}ms`);

      // Update MMDS with new identity BEFORE resuming
      // This is THE KEY - guest will query MMDS after resume and reconfigure
      if (networkMode === 'tap') {
        await this.sendApiRequest(apiSocket, 'PUT', '/mmds', newMmdsMetadata);
        console.log(`[FirecrackerService] MMDS updated with new identity`);
      }

      // NOW resume - guest will query MMDS and reconfigure network
      await this.sendApiRequest(apiSocket, 'PATCH', '/vm', { state: 'Resumed' });
      console.log(`[FirecrackerService] VM resumed in ${Date.now() - startTime}ms`);

      vm.status = 'running';
      await this.saveVmState(vm);
      this.emit('vm:started', vm);

      // Quick SSH check (should be very fast for snapshot restore)
      await this.waitForSshReady(id, 10000);
      console.log(`[FirecrackerService] VM ${id} restored and running in ${Date.now() - startTime}ms`);

    } catch (error) {
      console.error(`[FirecrackerService] Failed to restore VM ${id}:`, error);
      vm.status = 'error';
      vm.error = String(error);
      await this.saveVmState(vm);
      throw error;
    }

    return this.vmToInfo(vm);
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
    return Array.from(this.vms.values()).map(vm => this.vmToInfo(vm));
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
   * List snapshots for a VM
   */
  listVmSnapshots(id: string): FirecrackerSnapshotInfo[] {
    const vm = this.vms.get(id);
    if (!vm) return [];

    const vmDir = path.join(this.config.dataDir, id);
    const snapshotsDir = path.join(vmDir, 'snapshots');

    if (!fs.existsSync(snapshotsDir)) return [];

    const snapshots: FirecrackerSnapshotInfo[] = [];
    const snapshotDirs = fs.readdirSync(snapshotsDir);

    for (const snapshotId of snapshotDirs) {
      const snapshotDir = path.join(snapshotsDir, snapshotId);
      const metadataPath = path.join(snapshotDir, 'metadata.json');

      if (!fs.existsSync(metadataPath)) continue;

      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as FirecrackerSnapshotInfo;
        snapshots.push(metadata);
      } catch (e) {
        console.error(`[FirecrackerService] Failed to read snapshot ${snapshotId}:`, e);
      }
    }

    return snapshots.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Convert internal state to API VmInfo
   */
  private vmToInfo(vm: FirecrackerVmState): VmInfo {
    const sshInfo = this.getSshInfo(vm.id);

    return {
      id: vm.id,
      name: vm.name,
      status: vm.status,
      state: vm.status,
      hypervisor: 'firecracker',
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
    console.log('[FirecrackerService] Shutting down...');

    for (const [id, vm] of this.vms) {
      if (vm.status === 'running') {
        try {
          await this.stopVm(id);
        } catch (error) {
          console.error(`[FirecrackerService] Failed to stop VM ${id}:`, error);
        }
      }
    }

    this.emit('firecracker:shutdown');
    console.log('[FirecrackerService] Shutdown complete');
  }

  /**
   * Get network status
   */
  getNetworkStatus() {
    return this.networkPool.checkHealth();
  }

  /**
   * List available base images (shared with cloud-hypervisor)
   */
  listBaseImages(): { name: string; hasFirecrackerImage: boolean }[] {
    const baseImagesDir = this.config.baseImagesDir;
    if (!fs.existsSync(baseImagesDir)) {
      return [];
    }

    const images: { name: string; hasFirecrackerImage: boolean }[] = [];
    const entries = fs.readdirSync(baseImagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const imageDir = path.join(baseImagesDir, entry.name);
      const hasFirecrackerImage = fs.existsSync(path.join(imageDir, 'rootfs.ext4')) &&
                                   fs.existsSync(path.join(imageDir, 'vmlinux'));

      images.push({
        name: entry.name,
        hasFirecrackerImage,
      });
    }

    return images;
  }
}

// Singleton instance
let firecrackerService: FirecrackerService | null = null;

export function getFirecrackerService(): FirecrackerService {
  if (!firecrackerService) {
    firecrackerService = new FirecrackerService();
  }
  return firecrackerService;
}

export async function initializeFirecrackerService(): Promise<FirecrackerService> {
  const service = getFirecrackerService();
  await service.initialize();
  return service;
}
