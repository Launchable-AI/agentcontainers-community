/**
 * NetworkPool - TAP Device Pool Manager
 *
 * Supports two modes of operation:
 *
 * 1. Pool Mode (legacy): Uses pre-allocated TAP devices from setup script
 *    - Requires: sudo ./scripts/setup-vm-network.sh
 *    - TAPs are pre-created and managed via network.json
 *
 * 2. Helper Mode (recommended): Creates TAP devices on-demand using helper
 *    - Requires: sudo ./scripts/install-tap-helper.sh --setup-bridge
 *    - TAPs are created/deleted per VM lifecycle
 *    - No root required at runtime
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { TapHelper, TapInfo, HelperStatus } from './tap-helper';

/** TAP device configuration */
export interface TapDevice {
  name: string;
  allocated: boolean;
  allocatedTo: string | null;
  guestIp: string;
  macAddress: string;
}

/** Network pool configuration (stored on disk) */
export interface NetworkPoolConfig {
  bridgeName: string;
  subnet: string;
  gateway: string;
  tapDevices: TapDevice[];
  ownerUid: number;
  ownerGid: number;
  createdAt: string;
}

/** Result of TAP allocation */
export interface TapAllocation {
  tapName: string;
  guestIp: string;
  gateway: string;
  macAddress: string;
  bridgeName: string;
}

/** Network status check result */
export interface NetworkStatus {
  configured: boolean;
  healthy: boolean;
  bridgeExists: boolean;
  tapDevicesExist: boolean;
  availableTaps: number;
  totalTaps: number;
  message: string;
}

/** Network mode */
export type NetworkMode = 'pool' | 'helper' | 'none';

export class NetworkPool extends EventEmitter {
  private configPath: string;
  private config: NetworkPoolConfig | null = null;
  private tapHelper: TapHelper;
  private mode: NetworkMode = 'none';

  constructor(dataDir: string) {
    super();
    this.configPath = path.join(dataDir, 'network.json');
    this.tapHelper = new TapHelper();
  }

  /**
   * Get the current network mode
   */
  getMode(): NetworkMode {
    return this.mode;
  }

  /**
   * Initialize and detect the best available mode
   */
  async initialize(): Promise<NetworkMode> {
    // Check helper mode first (preferred)
    const helperStatus = await this.tapHelper.checkStatus();
    if (helperStatus.installed && helperStatus.hasCapability && helperStatus.bridgeExists) {
      this.mode = 'helper';
      console.log('[NetworkPool] Using helper mode (on-demand TAP creation)');
      return this.mode;
    }

    // Fall back to pool mode
    if (this.isConfigured()) {
      const config = this.load();
      if (config && this.deviceExists(config.bridgeName)) {
        this.mode = 'pool';
        console.log('[NetworkPool] Using pool mode (pre-allocated TAPs)');
        return this.mode;
      }
    }

    this.mode = 'none';
    console.log('[NetworkPool] No network mode available');
    return this.mode;
  }

  /**
   * Get helper status (for diagnostics)
   */
  async getHelperStatus(): Promise<HelperStatus> {
    return this.tapHelper.checkStatus();
  }

  /**
   * Check if network is configured
   */
  isConfigured(): boolean {
    return fs.existsSync(this.configPath);
  }

  /**
   * Load network configuration from disk
   */
  load(): NetworkPoolConfig | null {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(content) as NetworkPoolConfig;
      return this.config;
    } catch (error) {
      console.error('[NetworkPool] Failed to load network config:', error);
      return null;
    }
  }

  /**
   * Save network configuration to disk
   */
  private save(): void {
    if (!this.config) return;

    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('[NetworkPool] Failed to save network config:', error);
    }
  }

  /**
   * Check if a network device exists
   */
  private deviceExists(name: string): boolean {
    return fs.existsSync(`/sys/class/net/${name}`);
  }

  /**
   * Check network health and return status
   * Checks both helper mode and pool mode
   */
  checkHealth(): NetworkStatus {
    // If in helper mode, report based on helper status
    if (this.mode === 'helper') {
      // Note: This is sync but helper check is async
      // For sync check, we assume helper is healthy if mode is set
      return {
        configured: true,
        healthy: true,
        bridgeExists: true,
        tapDevicesExist: true,
        availableTaps: -1, // Not applicable in helper mode (on-demand)
        totalTaps: -1,
        message: 'Network ready (on-demand TAP creation)',
      };
    }

    // Pool mode checks
    if (!this.isConfigured()) {
      return {
        configured: false,
        healthy: false,
        bridgeExists: false,
        tapDevicesExist: false,
        availableTaps: 0,
        totalTaps: 0,
        message: 'Network not configured. Run: sudo ./scripts/install-tap-helper.sh --setup-bridge',
      };
    }

    const config = this.load();
    if (!config) {
      return {
        configured: false,
        healthy: false,
        bridgeExists: false,
        tapDevicesExist: false,
        availableTaps: 0,
        totalTaps: 0,
        message: 'Failed to load network configuration',
      };
    }

    // Check bridge exists
    const bridgeExists = this.deviceExists(config.bridgeName);

    // Check TAP devices exist
    let tapsExisting = 0;
    let tapsAvailable = 0;
    for (const tap of config.tapDevices) {
      if (this.deviceExists(tap.name)) {
        tapsExisting++;
        if (!tap.allocated) {
          tapsAvailable++;
        }
      }
    }
    const tapDevicesExist = tapsExisting === config.tapDevices.length;

    const healthy = bridgeExists && tapDevicesExist;

    let message = '';
    if (!bridgeExists) {
      message = `Bridge ${config.bridgeName} not found. Run: sudo ./scripts/install-tap-helper.sh --setup-bridge`;
    } else if (!tapDevicesExist) {
      message = `Only ${tapsExisting}/${config.tapDevices.length} TAP devices exist. Run: sudo ./scripts/setup-vm-network.sh`;
    } else if (tapsAvailable === 0) {
      message = 'No TAP devices available. All are allocated to VMs.';
    } else {
      message = `Network ready. ${tapsAvailable} TAP devices available.`;
    }

    return {
      configured: true,
      healthy,
      bridgeExists,
      tapDevicesExist,
      availableTaps: tapsAvailable,
      totalTaps: config.tapDevices.length,
      message,
    };
  }

  /**
   * Require network to be ready, throw if not
   */
  requireReady(): void {
    const status = this.checkHealth();
    if (!status.healthy) {
      throw new Error(status.message);
    }
  }

  /**
   * Allocate a TAP device for a VM (async version supporting both modes)
   */
  async allocateAsync(vmId: string): Promise<TapAllocation> {
    // Helper mode: create TAP on-demand
    if (this.mode === 'helper') {
      const tapInfo = await this.tapHelper.createTap(vmId);
      const allocation: TapAllocation = {
        tapName: tapInfo.name,
        guestIp: tapInfo.guestIp,
        gateway: tapInfo.gateway,
        macAddress: tapInfo.macAddress,
        bridgeName: tapInfo.bridgeName,
      };

      console.log(`[NetworkPool] Created TAP device ${tapInfo.name} for VM ${vmId} (helper mode)`);
      this.emit('tap:allocated', { vmId, allocation });

      return allocation;
    }

    // Pool mode: use existing implementation
    return this.allocate(vmId);
  }

  /**
   * Allocate a TAP device for a VM (sync, pool mode only)
   */
  allocate(vmId: string): TapAllocation {
    if (this.mode === 'helper') {
      throw new Error('Use allocateAsync() for helper mode');
    }

    const config = this.load();
    if (!config) {
      throw new Error('Network not configured. Run: sudo ./scripts/install-tap-helper.sh --setup-bridge');
    }

    // Find first available TAP device that exists
    const tapIndex = config.tapDevices.findIndex(
      (t) => !t.allocated && this.deviceExists(t.name)
    );

    if (tapIndex === -1) {
      const status = this.checkHealth();
      throw new Error(`No available TAP devices. ${status.message}`);
    }

    const tap = config.tapDevices[tapIndex];
    tap.allocated = true;
    tap.allocatedTo = vmId;

    this.config = config;
    this.save();

    const allocation: TapAllocation = {
      tapName: tap.name,
      guestIp: tap.guestIp,
      gateway: config.gateway,
      macAddress: tap.macAddress,
      bridgeName: config.bridgeName,
    };

    console.log(`[NetworkPool] Allocated TAP device ${tap.name} to VM ${vmId}`);
    this.emit('tap:allocated', { vmId, allocation });

    return allocation;
  }

  /**
   * Release a TAP device (async version supporting both modes)
   */
  async releaseAsync(tapName: string, vmId?: string): Promise<void> {
    // Helper mode: delete TAP device
    if (this.mode === 'helper' && vmId) {
      await this.tapHelper.deleteTap(vmId);
      console.log(`[NetworkPool] Deleted TAP device ${tapName} for VM ${vmId} (helper mode)`);
      this.emit('tap:released', { tapName, vmId });
      return;
    }

    // Pool mode: use existing implementation
    this.release(tapName);
  }

  /**
   * Release a TAP device back to the pool (sync, pool mode only)
   */
  release(tapName: string): void {
    const config = this.load();
    if (!config) return;

    const tap = config.tapDevices.find((t) => t.name === tapName);
    if (tap) {
      const vmId = tap.allocatedTo;
      tap.allocated = false;
      tap.allocatedTo = null;

      this.config = config;
      this.save();

      console.log(`[NetworkPool] Released TAP device ${tapName} from VM ${vmId}`);
      this.emit('tap:released', { tapName, vmId });
    }
  }

  /**
   * Release TAP device by VM ID (async version)
   */
  async releaseByVmIdAsync(vmId: string): Promise<void> {
    // Helper mode
    if (this.mode === 'helper') {
      const tapInfo = this.tapHelper.getTapInfo(vmId);
      if (tapInfo) {
        await this.releaseAsync(tapInfo.name, vmId);
      }
      return;
    }

    // Pool mode
    this.releaseByVmId(vmId);
  }

  /**
   * Release TAP device by VM ID (sync, pool mode only)
   */
  releaseByVmId(vmId: string): void {
    const config = this.load();
    if (!config) return;

    const tap = config.tapDevices.find((t) => t.allocatedTo === vmId);
    if (tap) {
      this.release(tap.name);
    }
  }

  /**
   * Get allocation for a VM
   */
  getAllocation(vmId: string): TapAllocation | null {
    // Helper mode
    if (this.mode === 'helper') {
      const tapInfo = this.tapHelper.getTapInfo(vmId);
      if (!tapInfo) return null;
      return {
        tapName: tapInfo.name,
        guestIp: tapInfo.guestIp,
        gateway: tapInfo.gateway,
        macAddress: tapInfo.macAddress,
        bridgeName: tapInfo.bridgeName,
      };
    }

    // Pool mode
    const config = this.load();
    if (!config) return null;

    const tap = config.tapDevices.find((t) => t.allocatedTo === vmId);
    if (!tap) return null;

    return {
      tapName: tap.name,
      guestIp: tap.guestIp,
      gateway: config.gateway,
      macAddress: tap.macAddress,
      bridgeName: config.bridgeName,
    };
  }

  /**
   * Clean up stale allocations from VMs that no longer exist
   */
  cleanupStale(activeVmIds: string[]): number {
    const config = this.load();
    if (!config) return 0;

    let cleaned = 0;
    for (const tap of config.tapDevices) {
      if (tap.allocated && tap.allocatedTo) {
        if (!activeVmIds.includes(tap.allocatedTo)) {
          console.log(`[NetworkPool] Cleaning up stale TAP allocation: ${tap.name} -> ${tap.allocatedTo}`);
          tap.allocated = false;
          tap.allocatedTo = null;
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      this.config = config;
      this.save();
      console.log(`[NetworkPool] Cleaned up ${cleaned} stale allocations`);
    }

    return cleaned;
  }

  /**
   * Get number of available TAP devices
   */
  availableCount(): number {
    const config = this.load();
    if (!config) return 0;

    return config.tapDevices.filter(
      (t) => !t.allocated && this.deviceExists(t.name)
    ).length;
  }

  /**
   * Get total number of TAP devices
   */
  totalCount(): number {
    const config = this.load();
    if (!config) return 0;
    return config.tapDevices.length;
  }

  /**
   * Get bridge name
   */
  getBridgeName(): string | null {
    const config = this.load();
    return config?.bridgeName || null;
  }

  /**
   * Get gateway IP
   */
  getGateway(): string | null {
    const config = this.load();
    return config?.gateway || null;
  }
}
