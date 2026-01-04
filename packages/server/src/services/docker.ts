import Docker from 'dockerode';
import type { ContainerInfo, VolumeInfo, ImageInfo } from '../types/index.js';
import { getConfig } from './config.js';

const docker = new Docker();

const CONTAINER_LABEL = 'agent-container-management';
const IMAGE_LABEL = 'agent-container-management';

export async function listContainers(): Promise<ContainerInfo[]> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [CONTAINER_LABEL] },
  });

  return containers.map((container) => {
    const sshPort = extractSshPort(container.Ports);
    return {
      id: container.Id,
      name: container.Names[0]?.replace(/^\//, '') || '',
      image: container.Image,
      status: container.Status,
      state: mapState(container.State),
      sshPort,
      sshCommand: sshPort ? `ssh -p ${sshPort} root@localhost` : null,
      volumes: extractVolumes(container.Mounts),
      ports: extractPorts(container.Ports),
      createdAt: new Date(container.Created * 1000).toISOString(),
    };
  });
}

export async function getContainer(id: string): Promise<ContainerInfo | null> {
  try {
    const container = docker.getContainer(id);
    const info = await container.inspect();

    const sshPort = extractSshPortFromInspect(info.NetworkSettings.Ports);
    return {
      id: info.Id,
      name: info.Name.replace(/^\//, ''),
      image: info.Config.Image,
      status: info.State.Status,
      state: mapState(info.State.Status),
      sshPort,
      sshCommand: sshPort ? `ssh -p ${sshPort} root@localhost` : null,
      volumes: extractVolumesFromInspect(info.Mounts),
      ports: extractPortsFromInspect(info.NetworkSettings.Ports),
      createdAt: info.Created,
    };
  } catch {
    return null;
  }
}

export async function createContainer(options: {
  name: string;
  image: string;
  sshPort: number;
  volumes?: Array<{ name: string; mountPath: string }>;
  ports?: Array<{ container: number; host: number }>;
  env?: Record<string, string>;
}): Promise<Docker.Container> {
  const { name, image, sshPort, volumes = [], ports = [], env = {} } = options;

  // Convert volume names to local directory paths for bind mounts
  const binds: string[] = [];
  for (const v of volumes) {
    const volumePath = await getVolumePath(v.name);
    binds.push(`${volumePath}:${v.mountPath}`);
  }
  const envArray = Object.entries(env).map(([k, v]) => `${k}=${v}`);

  // Build exposed ports and port bindings
  const exposedPorts: Record<string, object> = { '22/tcp': {} };
  const portBindings: Record<string, Array<{ HostPort: string }>> = {
    '22/tcp': [{ HostPort: sshPort.toString() }],
  };

  for (const port of ports) {
    const key = `${port.container}/tcp`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: port.host.toString() }];
  }

  const container = await docker.createContainer({
    name,
    Hostname: name,
    Image: image,
    Labels: { [CONTAINER_LABEL]: 'true' },
    Env: envArray,
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      Binds: binds.length > 0 ? binds : undefined,
      RestartPolicy: { Name: 'unless-stopped' },
    },
  });

  return container;
}

export async function startContainer(id: string): Promise<void> {
  const container = docker.getContainer(id);
  await container.start();
}

export async function stopContainer(id: string): Promise<void> {
  const container = docker.getContainer(id);
  await container.stop();
}

export async function removeContainer(id: string): Promise<void> {
  const container = docker.getContainer(id);
  await container.remove({ force: true });
}

export async function listImages(): Promise<ImageInfo[]> {
  const images = await docker.listImages({
    filters: { label: [IMAGE_LABEL] },
  });
  return images.map((img) => ({
    id: img.Id,
    repoTags: img.RepoTags || [],
    size: img.Size,
    created: new Date(img.Created * 1000).toISOString(),
  }));
}

export async function pullImage(imageName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) {
        reject(err);
        return;
      }
      docker.modem.followProgress(stream, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

export async function removeImage(id: string): Promise<void> {
  const image = docker.getImage(id);
  await image.remove({ force: true });
}

export async function imageHasLabel(imageName: string, label: string): Promise<boolean> {
  try {
    const image = docker.getImage(imageName);
    const info = await image.inspect();
    return info.Config?.Labels?.[label] === 'true';
  } catch {
    // Image doesn't exist or can't be inspected
    return false;
  }
}

export async function buildImage(dockerfile: string, tag: string): Promise<void> {
  const tar = await createTarFromDockerfile(dockerfile);

  return new Promise((resolve, reject) => {
    docker.buildImage(tar, { t: tag, labels: { [IMAGE_LABEL]: 'true' }, rm: true }, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      if (!stream) {
        reject(new Error('No stream returned from buildImage'));
        return;
      }

      let buildError: string | null = null;

      stream.on('data', (chunk: Buffer) => {
        try {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            const json = JSON.parse(line);
            if (json.error) {
              buildError = json.error;
            }
          }
        } catch {
          // Ignore parse errors
        }
      });

      docker.modem.followProgress(stream, (err) => {
        if (err) {
          reject(err);
        } else if (buildError) {
          reject(new Error(buildError));
        } else {
          resolve();
        }
      });
    });
  });
}

export async function buildImageWithLogs(
  dockerfile: string,
  tag: string,
  onLog: (message: string) => void
): Promise<void> {
  const tar = await createTarFromDockerfile(dockerfile);

  return new Promise((resolve, reject) => {
    docker.buildImage(tar, { t: tag, labels: { [IMAGE_LABEL]: 'true' }, rm: true }, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      if (!stream) {
        reject(new Error('No stream returned from buildImage'));
        return;
      }

      let buildError: string | null = null;

      stream.on('data', (chunk: Buffer) => {
        try {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            const json = JSON.parse(line);
            if (json.stream) {
              onLog(json.stream);
            } else if (json.error) {
              buildError = json.error;
              onLog(`ERROR: ${json.error}`);
            } else if (json.status) {
              onLog(`${json.status}${json.progress ? ` ${json.progress}` : ''}`);
            }
          }
        } catch {
          onLog(chunk.toString());
        }
      });

      docker.modem.followProgress(stream, (err) => {
        if (err) {
          reject(err);
        } else if (buildError) {
          reject(new Error(buildError));
        } else {
          resolve();
        }
      });
    });
  });
}

async function createTarFromDockerfile(dockerfile: string): Promise<NodeJS.ReadableStream> {
  const { pack } = await import('tar-stream');
  const { PassThrough } = await import('stream');

  const tarStream = pack();
  tarStream.entry({ name: 'Dockerfile' }, dockerfile);
  tarStream.finalize();

  return tarStream;
}

// Volume functions now use local directories instead of Docker volumes
// This keeps data in the project directory for easy access

async function getVolumesDir(): Promise<string> {
  const { join } = await import('path');
  const config = await getConfig();
  return join(config.dataDirectory, 'volumes');
}

async function getDirectorySize(dirPath: string): Promise<number> {
  const { readdir, stat } = await import('fs/promises');
  const { join } = await import('path');

  let totalSize = 0;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(entryPath);
      } else if (entry.isFile()) {
        const stats = await stat(entryPath);
        totalSize += stats.size;
      }
    }
  } catch {
    // Ignore errors (permission issues, etc.)
  }

  return totalSize;
}

export async function listVolumes(): Promise<VolumeInfo[]> {
  const { readdir, stat, mkdir } = await import('fs/promises');
  const { join } = await import('path');

  const volumesDir = await getVolumesDir();
  await mkdir(volumesDir, { recursive: true });

  try {
    const entries = await readdir(volumesDir, { withFileTypes: true });
    const volumes: VolumeInfo[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const volPath = join(volumesDir, entry.name);
        const stats = await stat(volPath);
        volumes.push({
          name: entry.name,
          driver: 'local',
          mountpoint: volPath,
          createdAt: stats.birthtime.toISOString(),
          size: 0, // Size is loaded lazily via separate endpoint
        });
      }
    }

    return volumes;
  } catch {
    return [];
  }
}

export async function getVolumeSize(name: string): Promise<number> {
  const { join } = await import('path');
  const volumesDir = await getVolumesDir();
  const volPath = join(volumesDir, name);
  return getDirectorySize(volPath);
}

export async function createVolume(name: string): Promise<void> {
  const { mkdir } = await import('fs/promises');
  const { join } = await import('path');

  const volumesDir = await getVolumesDir();
  const volumePath = join(volumesDir, name);
  await mkdir(volumePath, { recursive: true });
}

export async function removeVolume(name: string): Promise<void> {
  const { rm } = await import('fs/promises');
  const { join } = await import('path');

  const volumesDir = await getVolumesDir();
  const volumePath = join(volumesDir, name);
  await rm(volumePath, { recursive: true });
}

export async function getVolumeFiles(volumeName: string): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const { join } = await import('path');

  const volumesDir = await getVolumesDir();
  const volumePath = join(volumesDir, volumeName);

  async function listFilesRecursive(dir: string, base: string = ''): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const relativePath = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...await listFilesRecursive(join(dir, entry.name), relativePath));
      } else {
        files.push(relativePath);
      }
    }

    return files;
  }

  try {
    return await listFilesRecursive(volumePath);
  } catch {
    return [];
  }
}

export async function uploadFileToVolume(
  volumeName: string,
  fileName: string,
  fileContent: Buffer
): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises');
  const { join, dirname } = await import('path');

  const volumesDir = await getVolumesDir();
  const filePath = join(volumesDir, volumeName, fileName);

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, fileContent);
}

export async function getVolumePath(volumeName: string): Promise<string> {
  const { join } = await import('path');
  const volumesDir = await getVolumesDir();
  return join(volumesDir, volumeName);
}

export async function testConnection(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

function extractSshPort(ports: Docker.Port[]): number | null {
  const sshPort = ports.find((p) => p.PrivatePort === 22);
  return sshPort?.PublicPort || null;
}

function extractSshPortFromInspect(ports: Record<string, Array<{ HostPort: string }> | null>): number | null {
  const sshPorts = ports['22/tcp'];
  if (sshPorts && sshPorts.length > 0) {
    return parseInt(sshPorts[0].HostPort, 10);
  }
  return null;
}

function extractVolumes(mounts: Docker.ContainerInfo['Mounts']): Array<{ name: string; mountPath: string }> {
  return mounts
    .filter((m) => m.Type === 'volume' || m.Type === 'bind')
    .map((m) => {
      // For bind mounts, extract the volume name from the source path
      let name = m.Name || '';
      if (m.Type === 'bind' && m.Source) {
        // Extract volume name from path like /data/volumes/my-volume
        const parts = m.Source.split('/');
        const volIndex = parts.indexOf('volumes');
        if (volIndex !== -1 && parts.length > volIndex + 1) {
          name = parts[volIndex + 1];
        } else {
          name = parts[parts.length - 1] || m.Source;
        }
      }
      return {
        name,
        mountPath: m.Destination,
      };
    });
}

function extractVolumesFromInspect(mounts: Array<{ Type: string; Name?: string; Source?: string; Destination: string }>): Array<{ name: string; mountPath: string }> {
  return mounts
    .filter((m) => m.Type === 'volume' || m.Type === 'bind')
    .map((m) => {
      // For bind mounts, extract the volume name from the source path
      let name = m.Name || '';
      if (m.Type === 'bind' && m.Source) {
        // Extract volume name from path like /data/volumes/my-volume
        const parts = m.Source.split('/');
        const volIndex = parts.indexOf('volumes');
        if (volIndex !== -1 && parts.length > volIndex + 1) {
          name = parts[volIndex + 1];
        } else {
          name = parts[parts.length - 1] || m.Source;
        }
      }
      return {
        name,
        mountPath: m.Destination,
      };
    });
}

function extractPorts(ports: Docker.Port[]): Array<{ container: number; host: number }> {
  const portMap = new Map<string, { container: number; host: number }>();

  for (const p of ports) {
    if (!p.PublicPort || p.PrivatePort === 22) continue; // Exclude SSH port

    const key = `${p.PublicPort}-${p.PrivatePort}`;
    if (!portMap.has(key)) {
      portMap.set(key, { container: p.PrivatePort, host: p.PublicPort });
    }
  }

  return Array.from(portMap.values());
}

function extractPortsFromInspect(ports: Record<string, Array<{ HostPort: string }> | null>): Array<{ container: number; host: number }> {
  const portMap = new Map<string, { container: number; host: number }>();

  for (const [key, bindings] of Object.entries(ports)) {
    if (!bindings) continue;

    const containerPort = parseInt(key.split('/')[0], 10);
    if (containerPort === 22) continue; // Skip SSH port

    const hostPort = parseInt(bindings[0]?.HostPort, 10);

    if (containerPort && hostPort) {
      const mapKey = `${hostPort}-${containerPort}`;
      if (!portMap.has(mapKey)) {
        portMap.set(mapKey, { container: containerPort, host: hostPort });
      }
    }
  }

  return Array.from(portMap.values());
}

function mapState(state: string): ContainerInfo['state'] {
  const stateMap: Record<string, ContainerInfo['state']> = {
    running: 'running',
    exited: 'exited',
    created: 'created',
    paused: 'paused',
  };
  return stateMap[state.toLowerCase()] || 'stopped';
}

/**
 * Get container logs
 */
export async function getContainerLogs(
  containerId: string,
  options: { tail?: number; since?: number; timestamps?: boolean } = {}
): Promise<string> {
  const container = docker.getContainer(containerId);
  const { tail = 200, since = 0, timestamps = true } = options;

  const logs = await container.logs({
    stdout: true,
    stderr: true,
    tail,
    since,
    timestamps,
  });

  // Docker logs come with stream headers (8 bytes per line)
  // We need to strip them to get clean log output
  const buffer = Buffer.from(logs as unknown as Buffer);
  const lines: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Each frame has 8-byte header: [type(1), 0, 0, 0, size(4)]
    if (offset + 8 > buffer.length) break;

    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;

    if (offset + size > buffer.length) break;

    const line = buffer.subarray(offset, offset + size).toString('utf-8');
    lines.push(line.trimEnd());
    offset += size;
  }

  return lines.join('\n');
}

/**
 * Stream container logs (for real-time viewing)
 */
export async function streamContainerLogs(
  containerId: string,
  onLog: (line: string) => void,
  options: { tail?: number; since?: number } = {}
): Promise<() => void> {
  const container = docker.getContainer(containerId);
  const { tail = 100, since = 0 } = options;

  const stream = await container.logs({
    stdout: true,
    stderr: true,
    tail,
    since,
    timestamps: true,
    follow: true,
  });

  let buffer = Buffer.alloc(0);
  let aborted = false;

  const processBuffer = () => {
    while (buffer.length >= 8) {
      const size = buffer.readUInt32BE(4);
      const frameSize = 8 + size;

      if (buffer.length < frameSize) break;

      const line = buffer.subarray(8, frameSize).toString('utf-8').trimEnd();
      if (line) onLog(line);

      buffer = buffer.subarray(frameSize);
    }
  };

  (stream as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
    if (aborted) return;
    buffer = Buffer.concat([buffer, chunk]);
    processBuffer();
  });

  (stream as NodeJS.ReadableStream).on('end', () => {
    if (!aborted) {
      onLog('[Container log stream ended]');
    }
  });

  (stream as NodeJS.ReadableStream).on('error', (err: Error) => {
    if (!aborted) {
      onLog(`[Error: ${err.message}]`);
    }
  });

  // Return cleanup function
  return () => {
    aborted = true;
    // Stream is a Node.js Readable, cast and destroy safely
    const readable = stream as NodeJS.ReadableStream & { destroy?: () => void };
    if (typeof readable.destroy === 'function') {
      readable.destroy();
    }
  };
}

export { docker };
