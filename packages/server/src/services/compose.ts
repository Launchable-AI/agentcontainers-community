import { spawn } from 'child_process';
import { readdir, readFile, writeFile, rm, stat, mkdir } from 'fs/promises';
import { join } from 'path';
import Docker from 'dockerode';
import { getConfig } from './config.js';
import type { ComposeProject, ComposeService } from '../types/index.js';

const docker = new Docker();

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

        // Determine overall status
        let status: 'running' | 'partial' | 'stopped' = 'stopped';
        if (services.length > 0) {
          const runningCount = services.filter(s => s.state === 'running').length;
          if (runningCount === services.length) {
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
      if (runningCount === services.length) {
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

export async function getComposeServices(projectName: string): Promise<ComposeService[]> {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: [`com.docker.compose.project=${projectName}`],
      },
    });

    return containers.map(container => {
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

      return {
        name: serviceName,
        containerId: container.Id,
        state,
        image: container.Image,
        ports,
        sshPort,
      };
    });
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
