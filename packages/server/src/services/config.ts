import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const CONFIG_FILE = join(PROJECT_ROOT, 'data', 'config.json');

export interface AppConfig {
  sshKeysDisplayPath: string; // Path shown in SSH commands (e.g., ~/.ssh)
  dataDirectory: string; // Base directory for all data (volumes, ssh-keys, etc.)
  defaultDevNodeImage: string; // Default image for dev-node containers
}

const DEFAULT_CONFIG: AppConfig = {
  sshKeysDisplayPath: '~/.ssh',
  dataDirectory: join(PROJECT_ROOT, 'data'),
  defaultDevNodeImage: 'ubuntu:24.04',
};

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

let cachedConfig: AppConfig | null = null;

export async function getConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Partial<AppConfig>;
    cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
    return cachedConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
  const current = await getConfig();
  const newConfig = { ...current, ...updates };

  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(newConfig, null, 2));

  cachedConfig = newConfig;
  return newConfig;
}

export async function getSshKeysDisplayPath(): Promise<string> {
  const config = await getConfig();
  return config.sshKeysDisplayPath;
}
