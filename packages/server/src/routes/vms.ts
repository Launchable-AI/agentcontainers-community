/**
 * VM Routes - API endpoints for virtual machine management
 */

import { Hono } from 'hono';
import { getHypervisorService, initializeHypervisorService } from '../services/hypervisor.js';
import { CreateVmSchema } from '../types/vm.js';

const vms = new Hono();

// Initialize hypervisor service
let hypervisorInitialized = false;

async function ensureHypervisorInitialized() {
  if (!hypervisorInitialized) {
    await initializeHypervisorService();
    hypervisorInitialized = true;
  }
  return getHypervisorService();
}

// List all VMs
vms.get('/', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const vmList = hypervisor.listVms();
    return c.json(vmList);
  } catch (error) {
    console.error('[VMs API] Failed to list VMs:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get VM stats
vms.get('/stats', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const stats = hypervisor.getStats();
    return c.json(stats);
  } catch (error) {
    console.error('[VMs API] Failed to get stats:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get network status
vms.get('/network', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const status = hypervisor.getNetworkStatus();
    return c.json(status);
  } catch (error) {
    console.error('[VMs API] Failed to get network status:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List available base images
vms.get('/base-images', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const images = hypervisor.listBaseImages();
    return c.json(images);
  } catch (error) {
    console.error('[VMs API] Failed to list base images:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get SSH key for VMs
vms.get('/ssh-key', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const privateKey = hypervisor.getSshPrivateKey();
    if (!privateKey) {
      return c.json({ error: 'SSH key not found' }, 404);
    }
    return c.text(privateKey, 200, {
      'Content-Type': 'application/x-pem-file',
      'Content-Disposition': 'attachment; filename="vm_id_ed25519"',
    });
  } catch (error) {
    console.error('[VMs API] Failed to get SSH key:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get warmup status for a base image
vms.get('/warmup/:baseImage', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const baseImage = c.req.param('baseImage');
    const status = hypervisor.getWarmupStatus(baseImage);
    return c.json(status);
  } catch (error) {
    console.error('[VMs API] Failed to get warmup status:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Trigger warmup for a base image
vms.post('/warmup/:baseImage', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const baseImage = c.req.param('baseImage');

    // Start warmup in background
    hypervisor.warmupBaseImage(baseImage).catch(err => {
      console.error(`[VMs API] Warmup failed for ${baseImage}:`, err);
    });

    return c.json({ message: 'Warmup started', baseImage });
  } catch (error) {
    console.error('[VMs API] Failed to start warmup:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Create a new VM
vms.post('/', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const body = await c.req.json();

    // Validate request
    const parseResult = CreateVmSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json({ error: parseResult.error.format() }, 400);
    }

    const config = parseResult.data;
    const vm = await hypervisor.createVm({
      name: config.name,
      baseImage: config.baseImage,
      vcpus: config.vcpus,
      memoryMb: config.memoryMb,
      diskGb: config.diskGb,
      portMappings: config.ports,
      volumes: config.volumes,
      autoStart: config.autoStart,
    });

    return c.json(vm, 201);
  } catch (error) {
    console.error('[VMs API] Failed to create VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get a specific VM
vms.get('/:id', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const id = c.req.param('id');
    const vm = hypervisor.getVm(id);

    if (!vm) {
      return c.json({ error: `VM ${id} not found` }, 404);
    }

    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to get VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get VM boot logs
vms.get('/:id/logs', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const id = c.req.param('id');
    const lines = parseInt(c.req.query('lines') || '100', 10);

    const logs = hypervisor.getVmBootLogs(id, lines);
    if (logs === null) {
      return c.json({ error: `VM ${id} not found or no logs available` }, 404);
    }

    return c.json({ logs });
  } catch (error) {
    console.error('[VMs API] Failed to get VM logs:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get SSH info for a VM
vms.get('/:id/ssh', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const id = c.req.param('id');

    const sshInfo = hypervisor.getSshInfo(id);
    if (!sshInfo) {
      return c.json({ error: `VM ${id} not found` }, 404);
    }

    return c.json(sshInfo);
  } catch (error) {
    console.error('[VMs API] Failed to get SSH info:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Start a VM
vms.post('/:id/start', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const id = c.req.param('id');

    const vm = await hypervisor.startVm(id);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to start VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Stop a VM
vms.post('/:id/stop', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const id = c.req.param('id');

    const vm = await hypervisor.stopVm(id);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to stop VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Pause a VM
vms.post('/:id/pause', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const id = c.req.param('id');

    await hypervisor.pauseVm(id);
    const vm = hypervisor.getVm(id);
    return c.json(vm);
  } catch (error) {
    console.error('[VMs API] Failed to pause VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Delete a VM
vms.delete('/:id', async (c) => {
  try {
    const hypervisor = await ensureHypervisorInitialized();
    const id = c.req.param('id');

    await hypervisor.deleteVm(id);
    return c.json({ success: true, message: `VM ${id} deleted` });
  } catch (error) {
    console.error('[VMs API] Failed to delete VM:', error);
    return c.json({ error: String(error) }, 500);
  }
});

export default vms;
