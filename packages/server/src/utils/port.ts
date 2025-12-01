import { createServer } from 'net';
import Docker from 'dockerode';

const docker = new Docker();

export async function findAvailablePort(startPort: number, maxAttempts = 100): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error(`No available port found between ${startPort} and ${startPort + maxAttempts}`);
}

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '127.0.0.1');
  });
}

export async function findAvailableSshPort(): Promise<number> {
  // Get ports already used by Docker containers
  const usedPorts = await getUsedContainerPorts();

  for (let port = 2222; port < 2222 + 100; port++) {
    // Skip ports already mapped to containers
    if (usedPorts.has(port)) {
      continue;
    }
    // Also check if host is using the port
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error('No available SSH port found');
}

export async function getUsedContainerPorts(excludeContainerId?: string): Promise<Set<number>> {
  const usedPorts = new Set<number>();

  try {
    const containers = await docker.listContainers({ all: true });

    for (const container of containers) {
      // Skip the excluded container (useful for reconfiguration)
      if (excludeContainerId && container.Id.startsWith(excludeContainerId)) {
        continue;
      }

      for (const portInfo of container.Ports || []) {
        if (portInfo.PublicPort) {
          usedPorts.add(portInfo.PublicPort);
        }
      }
    }
  } catch {
    // If we can't list containers, return empty set
  }

  return usedPorts;
}

export interface PortMapping {
  container: number;
  host: number;
}

/**
 * Validates that the specified host ports are available.
 * Checks both Docker container usage and host system availability.
 * @param ports Array of port mappings to validate
 * @param excludeContainerId Optional container ID to exclude from Docker port check (for reconfiguration)
 * @throws Error if any host port is already in use
 */
export async function validateHostPorts(
  ports: PortMapping[] | undefined,
  excludeContainerId?: string
): Promise<void> {
  if (!ports || ports.length === 0) {
    return;
  }

  // Get ports used by Docker containers
  const usedPorts = await getUsedContainerPorts(excludeContainerId);

  const unavailablePorts: { port: number; reason: string }[] = [];

  for (const mapping of ports) {
    const { host: hostPort } = mapping;

    // Check if port is used by another Docker container
    if (usedPorts.has(hostPort)) {
      unavailablePorts.push({ port: hostPort, reason: 'already mapped to another container' });
      continue;
    }

    // Check if port is in use on the host system
    const available = await isPortAvailable(hostPort);
    if (!available) {
      unavailablePorts.push({ port: hostPort, reason: 'already in use on the host' });
    }
  }

  if (unavailablePorts.length > 0) {
    const portList = unavailablePorts
      .map(({ port, reason }) => `${port} (${reason})`)
      .join(', ');
    throw new Error(`Host port(s) unavailable: ${portList}`);
  }
}
