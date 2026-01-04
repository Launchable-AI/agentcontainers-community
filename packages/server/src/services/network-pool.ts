/**
 * NetworkPool - TAP Device Pool Manager
 *
 * Manages a pool of pre-allocated TAP devices for rootless VM networking.
 * TAP devices are created during `sudo ./scripts/setup-vm-network.sh` and
 * allocated to VMs at runtime without requiring elevated privileges.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

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

export class NetworkPool extends EventEmitter {
  private configPath: string;
  private config: NetworkPoolConfig | null = null;

  constructor(dataDir: string) {
    super();
    this.configPath = path.join(dataDir, 'network.json');
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
   */
  checkHealth(): NetworkStatus {
    if (!this.isConfigured()) {
      return {
        configured: false,
        healthy: false,
        bridgeExists: false,
        tapDevicesExist: false,
        availableTaps: 0,
        totalTaps: 0,
        message: 'Network not configured. Run: sudo ./scripts/setup-vm-network.sh',
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
      message = `Bridge ${config.bridgeName} not found. Run: sudo ./scripts/setup-vm-network.sh`;
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
   * Allocate a TAP device for a VM
   */
  allocate(vmId: string): TapAllocation {
    const config = this.load();
    if (!config) {
      throw new Error('Network not configured. Run: sudo ./scripts/setup-vm-network.sh');
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
   * Release a TAP device back to the pool
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
   * Release TAP device by VM ID
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
