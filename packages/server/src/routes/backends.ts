import { Hono } from 'hono';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { testConnection } from '../services/docker.js';
import os from 'os';

const execAsync = promisify(exec);

const backends = new Hono();

interface BackendInfo {
  installed: boolean;
  enabled: boolean;
  running: boolean;
  version?: string;
  error?: string;
}

interface BackendStatus {
  docker: BackendInfo;
  cloudHypervisor: BackendInfo;
  firecracker: BackendInfo;
}

// Helper to check if a binary exists in PATH or common locations
async function findBinary(name: string, additionalPaths: string[] = []): Promise<string | null> {
  // Check common installation paths
  const paths = [
    ...additionalPaths,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    `/opt/${name}/${name}`,
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }

  // Try which command
  try {
    const { stdout } = await execAsync(`which ${name}`);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// Get version from binary
async function getBinaryVersion(binary: string, versionArg: string = '--version'): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`${binary} ${versionArg} 2>&1`);
    // Extract version number from output
    const match = stdout.match(/(\d+\.\d+\.?\d*)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

// Check Docker status
async function getDockerStatus(): Promise<BackendInfo> {
  const info: BackendInfo = {
    installed: false,
    enabled: false,
    running: false,
  };

  // Check if Docker is installed
  const dockerPath = await findBinary('docker');
  if (!dockerPath) {
    return info;
  }

  info.installed = true;
  info.version = await getBinaryVersion(dockerPath);

  // Check if Docker daemon is running
  try {
    const connected = await testConnection();
    info.running = connected;
    info.enabled = connected; // If Docker is running, it's enabled
  } catch (err) {
    info.error = err instanceof Error ? err.message : 'Failed to connect to Docker';
  }

  return info;
}

// Check Cloud-Hypervisor status
async function getCloudHypervisorStatus(): Promise<BackendInfo> {
  const info: BackendInfo = {
    installed: false,
    enabled: false,
    running: false,
  };

  // Check if cloud-hypervisor binary exists
  const chPath = await findBinary('cloud-hypervisor');
  if (!chPath) {
    return info;
  }

  info.installed = true;
  info.version = await getBinaryVersion(chPath);

  // Check KVM availability (required for cloud-hypervisor)
  try {
    if (existsSync('/dev/kvm')) {
      info.enabled = true;
      // Check if any cloud-hypervisor processes are running
      const { stdout } = await execAsync('pgrep -f cloud-hypervisor 2>/dev/null || true');
      info.running = stdout.trim().length > 0;
    } else {
      info.error = 'KVM not available - check virtualization support';
    }
  } catch {
    info.enabled = existsSync('/dev/kvm');
  }

  return info;
}

// Check Firecracker status
async function getFirecrackerStatus(): Promise<BackendInfo> {
  const info: BackendInfo = {
    installed: false,
    enabled: false,
    running: false,
  };

  // Check if firecracker binary exists
  const fcPath = await findBinary('firecracker');
  if (!fcPath) {
    return info;
  }

  info.installed = true;
  info.version = await getBinaryVersion(fcPath);

  // Check KVM availability (required for Firecracker)
  try {
    if (existsSync('/dev/kvm')) {
      info.enabled = true;
      // Check if any firecracker processes are running
      const { stdout } = await execAsync('pgrep -f firecracker 2>/dev/null || true');
      info.running = stdout.trim().length > 0;
    } else {
      info.error = 'KVM not available - check virtualization support';
    }
  } catch {
    info.enabled = existsSync('/dev/kvm');
  }

  return info;
}

// GET /backends/status - Get status of all backends
backends.get('/status', async (c) => {
  const [docker, cloudHypervisor, firecracker] = await Promise.all([
    getDockerStatus(),
    getCloudHypervisorStatus(),
    getFirecrackerStatus(),
  ]);

  const status: BackendStatus = {
    docker,
    cloudHypervisor,
    firecracker,
  };

  return c.json(status);
});

// POST /backends/:backend/enable - Enable a backend
backends.post('/:backend/enable', async (c) => {
  const backend = c.req.param('backend');

  switch (backend) {
    case 'docker':
      // Docker doesn't really have an "enable" concept through our app
      // It's either running or not via systemd
      try {
        await execAsync('sudo systemctl start docker');
        return c.json({ success: true, message: 'Docker service started' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to start Docker service' }, 500);
      }

    case 'cloud-hypervisor':
    case 'firecracker':
      // These are just binary tools, enabling means ensuring KVM is accessible
      if (existsSync('/dev/kvm')) {
        return c.json({ success: true, message: `${backend} is ready (KVM available)` });
      }
      return c.json({ success: false, message: 'KVM not available' }, 400);

    default:
      return c.json({ error: 'Unknown backend' }, 404);
  }
});

// POST /backends/:backend/disable - Disable a backend
backends.post('/:backend/disable', async (c) => {
  const backend = c.req.param('backend');

  switch (backend) {
    case 'docker':
      try {
        await execAsync('sudo systemctl stop docker');
        return c.json({ success: true, message: 'Docker service stopped' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to stop Docker service' }, 500);
      }

    case 'cloud-hypervisor':
    case 'firecracker':
      // Can't really "disable" these - they're just binaries
      return c.json({ success: true, message: `${backend} doesn't require disabling` });

    default:
      return c.json({ error: 'Unknown backend' }, 404);
  }
});

// POST /backends/:backend/install - Install a backend
backends.post('/:backend/install', async (c) => {
  const backend = c.req.param('backend');

  switch (backend) {
    case 'docker':
      try {
        // Install Docker using official script
        await execAsync('curl -fsSL https://get.docker.com | sh', { timeout: 300000 });
        await execAsync('sudo usermod -aG docker $USER');
        return c.json({ success: true, message: 'Docker installed. You may need to log out and back in for group changes.' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to install Docker' }, 500);
      }

    case 'cloud-hypervisor':
      try {
        // Use the install script if available
        const scriptPath = `${process.cwd()}/scripts/install-cloud-hypervisor.sh`;
        if (existsSync(scriptPath)) {
          await execAsync(`bash ${scriptPath}`, { timeout: 300000 });
        } else {
          // Fallback: Download from releases
          const arch = process.arch === 'x64' ? 'x86_64' : 'aarch64';
          await execAsync(`
            curl -sL https://github.com/cloud-hypervisor/cloud-hypervisor/releases/latest/download/cloud-hypervisor-static-${arch} -o /tmp/cloud-hypervisor &&
            chmod +x /tmp/cloud-hypervisor &&
            sudo mv /tmp/cloud-hypervisor /usr/local/bin/
          `, { timeout: 120000 });
        }
        return c.json({ success: true, message: 'Cloud-Hypervisor installed' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to install Cloud-Hypervisor' }, 500);
      }

    case 'firecracker':
      try {
        // Use the install script if available
        const scriptPath = `${process.cwd()}/scripts/install-firecracker.sh`;
        if (existsSync(scriptPath)) {
          await execAsync(`bash ${scriptPath}`, { timeout: 300000 });
        } else {
          // Fallback: Download from releases
          const arch = process.arch === 'x64' ? 'x86_64' : 'aarch64';
          await execAsync(`
            LATEST=$(curl -s https://api.github.com/repos/firecracker-microvm/firecracker/releases/latest | grep '"tag_name"' | cut -d'"' -f4) &&
            curl -sL "https://github.com/firecracker-microvm/firecracker/releases/download/\${LATEST}/firecracker-\${LATEST}-${arch}.tgz" -o /tmp/firecracker.tgz &&
            tar -xzf /tmp/firecracker.tgz -C /tmp &&
            sudo mv /tmp/release-\${LATEST}-${arch}/firecracker-\${LATEST}-${arch} /usr/local/bin/firecracker &&
            rm -rf /tmp/firecracker.tgz /tmp/release-*
          `, { timeout: 120000 });
        }
        return c.json({ success: true, message: 'Firecracker installed' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to install Firecracker' }, 500);
      }

    default:
      return c.json({ error: 'Unknown backend' }, 404);
  }
});

// POST /backends/:backend/uninstall - Uninstall a backend
backends.post('/:backend/uninstall', async (c) => {
  const backend = c.req.param('backend');

  switch (backend) {
    case 'docker':
      try {
        await execAsync('sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin');
        await execAsync('sudo rm -rf /var/lib/docker /var/lib/containerd');
        return c.json({ success: true, message: 'Docker uninstalled' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to uninstall Docker' }, 500);
      }

    case 'cloud-hypervisor':
      try {
        await execAsync('sudo rm -f /usr/local/bin/cloud-hypervisor');
        return c.json({ success: true, message: 'Cloud-Hypervisor uninstalled' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to uninstall Cloud-Hypervisor' }, 500);
      }

    case 'firecracker':
      try {
        await execAsync('sudo rm -f /usr/local/bin/firecracker');
        return c.json({ success: true, message: 'Firecracker uninstalled' });
      } catch (err) {
        return c.json({ success: false, message: 'Failed to uninstall Firecracker' }, 500);
      }

    default:
      return c.json({ error: 'Unknown backend' }, 404);
  }
});

// ============ Host Stats ============

interface HostStats {
  cpu: {
    usage: number; // percentage
    cores: number;
    model: string;
  };
  memory: {
    total: number; // bytes
    used: number;
    free: number;
    usage: number; // percentage
  };
  disk: {
    total: number; // bytes
    used: number;
    free: number;
    usage: number; // percentage
  };
  uptime: number; // seconds
  hostname: string;
}

// Get CPU usage by reading /proc/stat
async function getCpuUsage(): Promise<number> {
  try {
    const stat1 = readFileSync('/proc/stat', 'utf8');
    const line1 = stat1.split('\n')[0];
    const parts1 = line1.split(/\s+/).slice(1).map(Number);

    await new Promise(resolve => setTimeout(resolve, 100));

    const stat2 = readFileSync('/proc/stat', 'utf8');
    const line2 = stat2.split('\n')[0];
    const parts2 = line2.split(/\s+/).slice(1).map(Number);

    const idle1 = parts1[3] + parts1[4];
    const idle2 = parts2[3] + parts2[4];
    const total1 = parts1.reduce((a, b) => a + b, 0);
    const total2 = parts2.reduce((a, b) => a + b, 0);

    const idleDelta = idle2 - idle1;
    const totalDelta = total2 - total1;

    return Math.round((1 - idleDelta / totalDelta) * 100);
  } catch {
    return 0;
  }
}

// Get disk usage for root filesystem
async function getDiskUsage(): Promise<{ total: number; used: number; free: number; usage: number }> {
  try {
    const { stdout } = await execAsync('df -B1 / | tail -1');
    const parts = stdout.trim().split(/\s+/);
    const total = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    const free = parseInt(parts[3], 10);
    return {
      total,
      used,
      free,
      usage: Math.round((used / total) * 100),
    };
  } catch {
    return { total: 0, used: 0, free: 0, usage: 0 };
  }
}

// GET /backends/host-stats - Get host system statistics
backends.get('/host-stats', async (c) => {
  const cpus = os.cpus();
  const cpuUsage = await getCpuUsage();
  const diskStats = await getDiskUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const stats: HostStats = {
    cpu: {
      usage: cpuUsage,
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown',
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usage: Math.round((usedMem / totalMem) * 100),
    },
    disk: diskStats,
    uptime: os.uptime(),
    hostname: os.hostname(),
  };

  return c.json(stats);
});

export default backends;
