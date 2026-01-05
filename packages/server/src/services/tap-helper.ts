/**
 * TapHelper - On-demand TAP Device Management
 *
 * Uses the agentc-tap-helper binary (with CAP_NET_ADMIN capability)
 * to create and delete TAP devices without requiring root privileges
 * for the main application.
 *
 * Installation: sudo ./scripts/install-tap-helper.sh --setup-bridge
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Result from TAP creation */
export interface TapCreateResult {
  success: boolean;
  tapName: string;
  error?: string;
}

/** TAP device info */
export interface TapInfo {
  name: string;
  guestIp: string;
  gateway: string;
  macAddress: string;
  bridgeName: string;
}

/** Helper status */
export interface HelperStatus {
  installed: boolean;
  hasCapability: boolean;
  bridgeExists: boolean;
  bridgeName: string;
  message: string;
}

// Default configuration
const DEFAULT_BRIDGE_NAME = 'agentc-br0';
const DEFAULT_GATEWAY = '172.31.0.1';
const DEFAULT_SUBNET_PREFIX = '172.31.0';
const HELPER_BINARY = 'agentc-tap-helper';

// Search paths for the helper binary
const HELPER_PATHS = [
  '/usr/local/bin/agentc-tap-helper',
  '/usr/local/lib/agentcontainers/agentc-tap-helper',
  path.join(__dirname, '../../../../helpers/tap-helper/target/release/agentc-tap-helper'),
];

export class TapHelper {
  private helperPath: string | null = null;
  private bridgeName: string;
  private gateway: string;
  private subnetPrefix: string;
  private nextIpSuffix: number = 2; // Start at .2 (gateway is .1)
  private allocatedTaps: Map<string, TapInfo> = new Map(); // vmId -> TapInfo

  constructor(options?: {
    bridgeName?: string;
    gateway?: string;
    subnetPrefix?: string;
  }) {
    this.bridgeName = options?.bridgeName || DEFAULT_BRIDGE_NAME;
    this.gateway = options?.gateway || DEFAULT_GATEWAY;
    this.subnetPrefix = options?.subnetPrefix || DEFAULT_SUBNET_PREFIX;
    this.helperPath = this.findHelper();
  }

  /**
   * Find the helper binary in known locations
   */
  private findHelper(): string | null {
    for (const helperPath of HELPER_PATHS) {
      if (fs.existsSync(helperPath)) {
        return helperPath;
      }
    }
    return null;
  }

  /**
   * Check if a network device exists
   */
  private deviceExists(name: string): boolean {
    return fs.existsSync(`/sys/class/net/${name}`);
  }

  /**
   * Generate a MAC address for a TAP device
   */
  private generateMacAddress(suffix: number): string {
    // Use locally administered address (bit 1 of first octet set)
    // Format: 52:54:00:01:XX:XX where XX:XX is based on suffix
    const b1 = (suffix >> 8) & 0xff;
    const b2 = suffix & 0xff;
    return `52:54:00:01:${b1.toString(16).padStart(2, '0')}:${b2.toString(16).padStart(2, '0')}`;
  }

  /**
   * Get the next available IP address
   */
  private getNextIp(): string {
    const ip = `${this.subnetPrefix}.${this.nextIpSuffix}`;
    this.nextIpSuffix++;
    if (this.nextIpSuffix > 254) {
      this.nextIpSuffix = 2; // Wrap around (will likely fail due to conflicts)
    }
    return ip;
  }

  /**
   * Run the helper with given arguments
   */
  private async runHelper(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.helperPath) {
      throw new Error('TAP helper not installed. Run: sudo ./scripts/install-tap-helper.sh');
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(this.helperPath!, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Check if the helper is properly installed with capabilities
   */
  async checkStatus(): Promise<HelperStatus> {
    if (!this.helperPath) {
      return {
        installed: false,
        hasCapability: false,
        bridgeExists: false,
        bridgeName: this.bridgeName,
        message: 'TAP helper not found. Run: sudo ./scripts/install-tap-helper.sh',
      };
    }

    try {
      const result = await this.runHelper(['check-caps']);
      const hasCapability = result.exitCode === 0;
      const bridgeExists = this.deviceExists(this.bridgeName);

      let message = '';
      if (!hasCapability) {
        message = 'TAP helper missing CAP_NET_ADMIN. Run: sudo ./scripts/install-tap-helper.sh';
      } else if (!bridgeExists) {
        message = `Bridge ${this.bridgeName} not found. Run: sudo ./scripts/install-tap-helper.sh --setup-bridge`;
      } else {
        message = 'TAP helper ready for on-demand TAP creation';
      }

      return {
        installed: true,
        hasCapability,
        bridgeExists,
        bridgeName: this.bridgeName,
        message,
      };
    } catch (error) {
      return {
        installed: true,
        hasCapability: false,
        bridgeExists: false,
        bridgeName: this.bridgeName,
        message: `Failed to check helper status: ${error}`,
      };
    }
  }

  /**
   * Check if the helper is ready to create TAP devices
   */
  async isReady(): Promise<boolean> {
    const status = await this.checkStatus();
    return status.installed && status.hasCapability && status.bridgeExists;
  }

  /**
   * Create a TAP device for a VM
   * Note: Assumes checkStatus() has been called during initialization
   */
  async createTap(vmId: string): Promise<TapInfo> {
    // Skip status check for performance - it's checked during initialize()
    // Only verify the helper path exists
    if (!this.helperPath) {
      throw new Error('TAP helper not installed. Run: sudo ./scripts/install-tap-helper.sh');
    }

    // Generate TAP name based on VM ID (sanitized)
    const sanitizedId = vmId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    const tapName = `tap-${sanitizedId}`;

    // Check if already allocated
    if (this.allocatedTaps.has(vmId)) {
      return this.allocatedTaps.get(vmId)!;
    }

    // Check if TAP already exists (from previous run)
    if (this.deviceExists(tapName)) {
      console.log(`[TapHelper] TAP ${tapName} already exists, deleting first`);
      await this.deleteTap(vmId);
    }

    const guestIp = this.getNextIp();
    // MAC must match dnsmasq static reservations: MAC byte = IP suffix - 2
    // After getNextIp(), nextIpSuffix has been incremented, so IP suffix = nextIpSuffix - 1
    // Therefore: MAC byte = (nextIpSuffix - 1) - 2 = nextIpSuffix - 3
    const macAddress = this.generateMacAddress(this.nextIpSuffix - 3);

    // Get owner UID/GID (current user)
    const uid = process.getuid?.() || 1000;
    const gid = process.getgid?.() || 1000;

    console.log(`[TapHelper] Creating TAP ${tapName} for VM ${vmId}`);

    const result = await this.runHelper([
      'create',
      '--name', tapName,
      '--bridge', this.bridgeName,
      '--owner-uid', uid.toString(),
      '--owner-gid', gid.toString(),
      '--format', 'json',
    ]);

    if (result.exitCode !== 0) {
      let errorMsg = result.stderr || 'Unknown error';
      try {
        const json = JSON.parse(result.stdout);
        if (json.error) errorMsg = json.error;
      } catch {}
      throw new Error(`Failed to create TAP: ${errorMsg}`);
    }

    const tapInfo: TapInfo = {
      name: tapName,
      guestIp,
      gateway: this.gateway,
      macAddress,
      bridgeName: this.bridgeName,
    };

    this.allocatedTaps.set(vmId, tapInfo);
    console.log(`[TapHelper] Created TAP ${tapName} with IP ${guestIp}`);

    return tapInfo;
  }

  /**
   * Delete a TAP device for a VM
   */
  async deleteTap(vmId: string): Promise<void> {
    const tapInfo = this.allocatedTaps.get(vmId);
    if (!tapInfo) {
      // Try to find by pattern
      const sanitizedId = vmId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
      const tapName = `tap-${sanitizedId}`;

      if (this.deviceExists(tapName)) {
        console.log(`[TapHelper] Deleting orphan TAP ${tapName}`);
        try {
          await this.runHelper(['delete', '--name', tapName]);
        } catch (error) {
          console.warn(`[TapHelper] Failed to delete orphan TAP: ${error}`);
        }
      }
      return;
    }

    console.log(`[TapHelper] Deleting TAP ${tapInfo.name} for VM ${vmId}`);

    try {
      const result = await this.runHelper(['delete', '--name', tapInfo.name]);
      if (result.exitCode !== 0) {
        console.warn(`[TapHelper] Failed to delete TAP: ${result.stderr}`);
      }
    } catch (error) {
      console.warn(`[TapHelper] Error deleting TAP: ${error}`);
    }

    this.allocatedTaps.delete(vmId);
  }

  /**
   * Get TAP info for a VM
   */
  getTapInfo(vmId: string): TapInfo | null {
    return this.allocatedTaps.get(vmId) || null;
  }

  /**
   * Get all allocated TAPs
   */
  getAllocatedTaps(): Map<string, TapInfo> {
    return new Map(this.allocatedTaps);
  }

  /**
   * Clean up all TAP devices created by this helper
   */
  async cleanupAll(): Promise<void> {
    console.log(`[TapHelper] Cleaning up ${this.allocatedTaps.size} TAP devices`);

    for (const [vmId, tapInfo] of this.allocatedTaps) {
      try {
        await this.runHelper(['delete', '--name', tapInfo.name]);
        console.log(`[TapHelper] Deleted TAP ${tapInfo.name}`);
      } catch (error) {
        console.warn(`[TapHelper] Failed to delete TAP ${tapInfo.name}: ${error}`);
      }
    }

    this.allocatedTaps.clear();
  }
}

// Export singleton for convenience
let defaultHelper: TapHelper | null = null;

export function getTapHelper(): TapHelper {
  if (!defaultHelper) {
    defaultHelper = new TapHelper();
  }
  return defaultHelper;
}
