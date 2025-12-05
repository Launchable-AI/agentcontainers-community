import { spawn } from 'child_process';
import { readdir, readFile, writeFile, rm, stat, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import Docker from 'dockerode';
import yaml from 'yaml';
import { getConfig } from './config.js';
import type { ComposeProject, ComposeService } from '../types/index.js';

const docker = new Docker();

// Parse services defined in compose YAML
async function getDefinedServices(projectName: string): Promise<Map<string, { image: string }>> {
  const composesDir = await getComposesDir();
  const filePath = join(composesDir, `${projectName}.yml`);
  const definedServices = new Map<string, { image: string }>();

  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = yaml.parse(content);

    if (parsed?.services && typeof parsed.services === 'object') {
      for (const [serviceName, serviceConfig] of Object.entries(parsed.services)) {
        const config = serviceConfig as Record<string, unknown>;
        const image = (config?.image as string) ||
                      (config?.build ? `${projectName}-${serviceName}` : 'unknown');
        definedServices.set(serviceName, { image });
      }
    }
  } catch {
    // Ignore parse errors
  }

  return definedServices;
}

async function getComposesDir(): Promise<string> {
  const config = await getConfig();
  return join(config.dataDirectory, 'compose');
}

export async function listComposeProjects(): Promise<ComposeProject[]> {
  const composesDir = await getComposesDir();
  await mkdir(composesDir, { recursive: true });

  try {
    const entries = await readdir(composesDir, { withFileTypes: true });
    const projects: ComposeProject[] = [];

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
        const name = entry.name.replace(/\.(yml|yaml)$/, '');
        const filePath = join(composesDir, entry.name);
        const stats = await stat(filePath);
        const services = await getComposeServices(name);

        // Determine overall status based on defined services
        let status: 'running' | 'partial' | 'stopped' = 'stopped';
        if (services.length > 0) {
          const runningCount = services.filter(s => s.state === 'running').length;
          if (runningCount === services.length && runningCount > 0) {
            status = 'running';
          } else if (runningCount > 0) {
            status = 'partial';
          }
        }

        projects.push({
          name,
          status,
          services,
          createdAt: stats.birthtime.toISOString(),
        });
      }
    }

    return projects;
  } catch {
    return [];
  }
}

export async function getComposeProject(name: string): Promise<ComposeProject | null> {
  const composesDir = await getComposesDir();
  const filePath = join(composesDir, `${name}.yml`);

  try {
    const stats = await stat(filePath);
    const services = await getComposeServices(name);

    let status: 'running' | 'partial' | 'stopped' = 'stopped';
    if (services.length > 0) {
      const runningCount = services.filter(s => s.state === 'running').length;
      if (runningCount === services.length && runningCount > 0) {
        status = 'running';
      } else if (runningCount > 0) {
        status = 'partial';
      }
    }

    return {
      name,
      status,
      services,
      createdAt: stats.birthtime.toISOString(),
    };
  } catch {
    return null;
  }
}

export async function getComposeContent(name: string): Promise<string | null> {
  const composesDir = await getComposesDir();
  const filePath = join(composesDir, `${name}.yml`);

  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function saveComposeFile(name: string, content: string): Promise<void> {
  const composesDir = await getComposesDir();
  await mkdir(composesDir, { recursive: true });
  const filePath = join(composesDir, `${name}.yml`);
  await writeFile(filePath, content, 'utf-8');
}

export async function deleteComposeProject(name: string): Promise<void> {
  // First, bring down the project if running
  await composeDown(name);

  // Then delete the file
  const composesDir = await getComposesDir();
  const filePath = join(composesDir, `${name}.yml`);
  await rm(filePath, { force: true });
}

export async function renameComposeProject(oldName: string, newName: string): Promise<void> {
  const composesDir = await getComposesDir();
  const oldPath = join(composesDir, `${oldName}.yml`);
  const newPath = join(composesDir, `${newName}.yml`);

  // Check if new name already exists
  try {
    await stat(newPath);
    throw new Error('A project with that name already exists');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  // If project is running, bring it down first
  const services = await getComposeServices(oldName);
  const wasRunning = services.some(s => s.state === 'running');
  if (wasRunning) {
    await composeDown(oldName);
  }

  // Rename the file
  await rename(oldPath, newPath);

  // If it was running, bring it back up with the new name
  if (wasRunning) {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('docker', ['compose', '-f', newPath, '-p', newName, 'up', '-d'], {
        cwd: composesDir,
      });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Failed to restart project`));
      });
      proc.on('error', reject);
    });
  }
}

export async function getComposeServices(projectName: string): Promise<ComposeService[]> {
  try {
    // Get defined services from YAML
    const definedServices = await getDefinedServices(projectName);

    // Get running containers
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: [`com.docker.compose.project=${projectName}`],
      },
    });

    // Map container info by service name
    const runningServices = new Map<string, ComposeService>();
    for (const container of containers) {
      const serviceName = container.Labels['com.docker.compose.service'] || 'unknown';
      const state = mapContainerState(container.State);
      const ports: Array<{ container: number; host: number | null }> = [];
      let sshPort: number | null = null;

      for (const port of container.Ports || []) {
        if (port.PrivatePort) {
          ports.push({
            container: port.PrivatePort,
            host: port.PublicPort || null,
          });
          // Detect SSH port (port 22 mapped to host)
          if (port.PrivatePort === 22 && port.PublicPort) {
            sshPort = port.PublicPort;
          }
        }
      }

      runningServices.set(serviceName, {
        name: serviceName,
        containerId: container.Id,
        state,
        image: container.Image,
        ports,
        sshPort,
      });
    }

    // Merge: include all defined services, with container info if running
    const services: ComposeService[] = [];

    for (const [serviceName, { image }] of definedServices) {
      const running = runningServices.get(serviceName);
      if (running) {
        services.push(running);
        runningServices.delete(serviceName);
      } else {
        // Service defined but not running
        services.push({
          name: serviceName,
          containerId: '',
          state: 'unknown',
          image,
          ports: [],
          sshPort: null,
        });
      }
    }

    // Add any running services that weren't in the YAML (edge case)
    for (const running of runningServices.values()) {
      services.push(running);
    }

    return services;
  } catch {
    return [];
  }
}

function mapContainerState(state: string): ComposeService['state'] {
  const stateMap: Record<string, ComposeService['state']> = {
    running: 'running',
    exited: 'exited',
    paused: 'paused',
    restarting: 'restarting',
    dead: 'dead',
    created: 'created',
  };
  return stateMap[state.toLowerCase()] || 'unknown';
}

export interface ComposeStreamCallbacks {
  onLog: (log: string) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

export async function composeUp(
  name: string,
  callbacks: ComposeStreamCallbacks
): Promise<void> {
  const composesDir = await getComposesDir();
  const filePath = join(composesDir, `${name}.yml`);

  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['compose', '-f', filePath, '-p', name, 'up', '-d', '--build'], {
      cwd: composesDir,
    });

    proc.stdout.on('data', (data) => {
      callbacks.onLog(data.toString());
    });

    proc.stderr.on('data', (data) => {
      // Docker compose outputs progress to stderr
      callbacks.onLog(data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        callbacks.onDone();
        resolve();
      } else {
        callbacks.onError(`Process exited with code ${code}`);
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      callbacks.onError(err.message);
      reject(err);
    });
  });
}

export async function composeDown(name: string): Promise<void> {
  const composesDir = await getComposesDir();
  const filePath = join(composesDir, `${name}.yml`);

  // Check if file exists first
  try {
    await stat(filePath);
  } catch {
    // File doesn't exist, nothing to bring down
    return;
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['compose', '-f', filePath, '-p', name, 'down'], {
      cwd: composesDir,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

export async function composeDownWithLogs(
  name: string,
  callbacks: ComposeStreamCallbacks
): Promise<void> {
  const composesDir = await getComposesDir();
  const filePath = join(composesDir, `${name}.yml`);

  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['compose', '-f', filePath, '-p', name, 'down'], {
      cwd: composesDir,
    });

    proc.stdout.on('data', (data) => {
      callbacks.onLog(data.toString());
    });

    proc.stderr.on('data', (data) => {
      callbacks.onLog(data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        callbacks.onDone();
        resolve();
      } else {
        callbacks.onError(`Process exited with code ${code}`);
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      callbacks.onError(err.message);
      reject(err);
    });
  });
}

export async function getComposeLogs(
  name: string,
  callbacks: ComposeStreamCallbacks,
  tail: number = 100
): Promise<() => void> {
  const composesDir = await getComposesDir();
  const filePath = join(composesDir, `${name}.yml`);

  const proc = spawn('docker', ['compose', '-f', filePath, '-p', name, 'logs', '-f', '--tail', String(tail)], {
    cwd: composesDir,
  });

  proc.stdout.on('data', (data) => {
    callbacks.onLog(data.toString());
  });

  proc.stderr.on('data', (data) => {
    callbacks.onLog(data.toString());
  });

  proc.on('close', () => {
    callbacks.onDone();
  });

  proc.on('error', (err) => {
    callbacks.onError(err.message);
  });

  // Return a function to stop following logs
  return () => {
    proc.kill();
  };
}
