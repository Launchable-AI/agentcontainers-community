import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import * as dockerService from '../services/docker.js';
import * as containerBuilder from '../services/container-builder.js';
import * as buildTracker from '../services/build-tracker.js';
import { CreateContainerSchema, ReconfigureContainerSchema } from '../types/index.js';
import { findAvailableSshPort, findAvailablePort, getUsedContainerPorts, validateHostPorts } from '../utils/port.js';

const containers = new Hono();

// List all containers (includes active/failed builds as pseudo-containers)
containers.get('/', async (c) => {
  const [containerList, builds] = await Promise.all([
    dockerService.listContainers(),
    Promise.resolve(buildTracker.listBuilds()),
  ]);

  // Convert builds to container-like objects for the UI
  const buildContainers = builds
    .filter((b) => b.status === 'building' || b.status === 'failed')
    .map((b) => ({
      id: b.id,
      name: b.name,
      image: b.status === 'building' ? 'building...' : 'build failed',
      status: b.status === 'building' ? 'Building image...' : `Failed: ${b.error}`,
      state: (b.status === 'building' ? 'building' : 'failed') as 'building' | 'failed',
      sshPort: null,
      sshCommand: null,
      volumes: [],
      ports: [],
      createdAt: b.startedAt,
    }));

  return c.json([...buildContainers, ...containerList]);
});

// Get single container
containers.get('/:id', async (c) => {
  const id = c.req.param('id');
  const container = await dockerService.getContainer(id);

  if (!container) {
    return c.json({ error: 'Container not found' }, 404);
  }

  return c.json(container);
});

// Create container (starts build in background, returns immediately)
containers.post('/', zValidator('json', CreateContainerSchema), async (c) => {
  const body = c.req.valid('json');

  // Check if there's already a build in progress for this name
  const existingBuild = buildTracker.getActiveBuildByName(body.name);
  if (existingBuild) {
    return c.json({ error: 'A build is already in progress for this container name' }, 409);
  }

  // Create build tracker entry
  const build = buildTracker.createBuild(body.name);

  // Start build in background (don't await)
  containerBuilder.buildAndCreateContainer(body)
    .then((result) => {
      buildTracker.completeBuild(build.id, result.container.id);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      buildTracker.failBuild(build.id, message);
    });

  // Return immediately with build info
  return c.json({
    buildId: build.id,
    status: 'building',
    message: 'Container build started in background',
  }, 202);
});

// Start container (auto-reassigns ports if there's a conflict)
containers.post('/:id/start', async (c) => {
  const id = c.req.param('id');

  try {
    // Get container info to check its ports
    const container = await dockerService.getContainer(id);
    if (!container) {
      return c.json({ error: 'Container not found' }, 404);
    }

    // Check if any ports are in conflict (excluding this container)
    const usedPorts = await getUsedContainerPorts(id);
    let needsRecreate = false;

    if (container.sshPort && usedPorts.has(container.sshPort)) {
      needsRecreate = true;
    }

    for (const port of container.ports) {
      if (usedPorts.has(port.host)) {
        needsRecreate = true;
        break;
      }
    }

    if (needsRecreate) {
      // Port conflict - recreate container with new ports
      const { name, image, volumes } = container;

      // Remove the old container
      await dockerService.removeContainer(id);

      // Find new available SSH port
      const newSshPort = await findAvailableSshPort();

      // Reassign conflicting custom ports
      const newPorts = [];
      const currentUsedPorts = await getUsedContainerPorts();
      for (const port of container.ports) {
        if (currentUsedPorts.has(port.host)) {
          const newHostPort = await findAvailablePort(port.host);
          newPorts.push({ container: port.container, host: newHostPort });
        } else {
          newPorts.push(port);
        }
      }

      // Create new container with same config but new ports
      const newContainer = await dockerService.createContainer({
        name,
        image,
        sshPort: newSshPort,
        volumes: volumes.map(v => ({ name: v.name, mountPath: v.mountPath })),
        ports: newPorts,
      });

      // Start the new container
      await newContainer.start();
      return c.json({ success: true, recreated: true, newId: newContainer.id });
    }

    // No conflict - just start
    await dockerService.startContainer(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Stop container
containers.post('/:id/stop', async (c) => {
  const id = c.req.param('id');

  try {
    await dockerService.stopContainer(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Reconfigure container (recreates with new ports/volumes)
containers.post('/:id/reconfigure', zValidator('json', ReconfigureContainerSchema), async (c) => {
  const id = c.req.param('id');
  const { volumes, ports } = c.req.valid('json');

  try {
    // Get current container info
    const container = await dockerService.getContainer(id);
    if (!container) {
      return c.json({ error: 'Container not found' }, 404);
    }

    const { name, image } = container;

    // Stop container first to free its ports
    // This is necessary because the host port check will fail if the container is still running
    if (container.state === 'running') {
      await dockerService.stopContainer(id);
    }

    // Now validate that requested host ports are available
    // The container's ports are now freed, so we can check properly
    // Still exclude the container ID in case it's in a stopped state with ports still "reserved"
    await validateHostPorts(ports, id);

    // Remove the container
    await dockerService.removeContainer(id);

    // Find new SSH port
    const sshPort = await findAvailableSshPort();

    // Create new container with same name/image but new config
    const newContainer = await dockerService.createContainer({
      name,
      image,
      sshPort,
      volumes,
      ports,
    });

    // Start the new container
    await newContainer.start();

    // Get updated container info
    const newContainerInfo = await dockerService.getContainer(newContainer.id);
    return c.json(newContainerInfo);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Remove container or failed build
containers.delete('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    // Check if this is a build ID (failed or in-progress build)
    if (id.startsWith('build-')) {
      const removed = buildTracker.removeBuild(id);
      if (!removed) {
        return c.json({ error: 'Build not found' }, 404);
      }
      return c.json({ success: true });
    }

    // Otherwise, it's a Docker container
    await dockerService.removeContainer(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get SSH private key (single app-wide key for all containers)
containers.get('/:id/ssh-key', async (c) => {
  try {
    const privateKey = await containerBuilder.getPrivateKey();

    c.header('Content-Type', 'application/x-pem-file');
    c.header('Content-Disposition', 'attachment; filename="acm.pem"');

    return c.body(privateKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get container logs (REST endpoint for fetching logs)
containers.get('/:id/logs', async (c) => {
  const id = c.req.param('id');
  const tail = parseInt(c.req.query('tail') || '200', 10);
  const timestamps = c.req.query('timestamps') !== 'false';

  try {
    const logs = await dockerService.getContainerLogs(id, { tail, timestamps });
    return c.json({ logs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Stream container logs (SSE endpoint for real-time logs)
containers.get('/:id/logs/stream', async (c) => {
  const id = c.req.param('id');
  const tail = parseInt(c.req.query('tail') || '100', 10);

  // Set up SSE headers
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;
  let closed = false;

  const sendEvent = async (event: string, data: string) => {
    if (closed) return;
    try {
      await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch {
      // Stream closed
    }
  };

  // Start streaming logs
  dockerService.streamContainerLogs(
    id,
    (line) => sendEvent('log', line),
    { tail }
  ).then((cleanupFn) => {
    cleanup = cleanupFn;
  }).catch((error) => {
    sendEvent('error', error instanceof Error ? error.message : 'Unknown error');
  });

  // Clean up after 5 minutes or when client disconnects
  const timeout = setTimeout(async () => {
    closed = true;
    cleanup?.();
    await sendEvent('done', 'Timeout - stream closed after 5 minutes');
    await writer.close();
  }, 5 * 60 * 1000);

  c.req.raw.signal.addEventListener('abort', () => {
    closed = true;
    cleanup?.();
    clearTimeout(timeout);
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

export default containers;
