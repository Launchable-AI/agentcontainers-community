/**
 * MCP Registry Service
 * Syncs and searches MCP servers from the official registry
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const DATA_DIR = join(PROJECT_ROOT, 'data');
const MCP_REGISTRY_FILE = join(DATA_DIR, 'mcp-registry.json');
const MCP_FAVORITES_FILE = join(DATA_DIR, 'mcp-favorites.json');

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io';

export interface MCPPackage {
  registryType: 'npm' | 'pypi' | 'docker' | 'crate' | string;
  identifier: string;
  version: string;
  transport?: {
    type: 'stdio' | 'sse' | 'streamable-http' | string;
    args?: string[];
  };
}

export interface MCPServer {
  name: string;
  title: string;
  description: string;
  version: string;
  packages: MCPPackage[];
  repository?: {
    type: string;
    url: string;
  };
  tools?: Array<{ name: string; description: string }>;
  prompts?: Array<{ name: string; description: string }>;
  resources?: Array<{ type: string; description: string }>;
  status?: 'deprecated' | 'deleted' | 'active';
  updatedAt?: string;
}

export interface MCPRegistryStore {
  servers: MCPServer[];
  lastSynced: string | null;
  totalCount: number;
}

async function loadStore(): Promise<MCPRegistryStore> {
  try {
    if (existsSync(MCP_REGISTRY_FILE)) {
      const data = await readFile(MCP_REGISTRY_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load MCP registry store:', error);
  }
  return { servers: [], lastSynced: null, totalCount: 0 };
}

async function saveStore(store: MCPRegistryStore): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MCP_REGISTRY_FILE, JSON.stringify(store, null, 2));
}

/**
 * Sync all servers from the MCP registry
 */
export async function syncRegistry(): Promise<{ count: number; timestamp: string }> {
  const servers: MCPServer[] = [];
  let cursor: string | null = null;
  const limit = 100;

  console.log('Starting MCP registry sync...');

  // Paginate through all servers
  while (true) {
    const url = new URL(`${REGISTRY_BASE_URL}/v0.1/servers`);
    url.searchParams.set('limit', limit.toString());
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch from registry: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      servers: Array<{ server: MCPServer; _meta?: unknown }>;
      metadata: { count: number; nextCursor?: string };
    };

    // Extract server data from wrapper and filter out deleted servers
    const extractedServers = data.servers
      .map(item => item.server)
      .filter(s => s && s.status !== 'deleted');
    servers.push(...extractedServers);

    console.log(`Fetched ${data.servers.length} servers (${servers.length} total)`);

    // Check if there are more pages
    if (!data.metadata.nextCursor) {
      break;
    }
    cursor = data.metadata.nextCursor;
  }

  // Deduplicate servers by name, keeping only the latest version
  const serverMap = new Map<string, MCPServer>();
  for (const server of servers) {
    const existing = serverMap.get(server.name);
    if (!existing || compareVersions(server.version, existing.version) > 0) {
      serverMap.set(server.name, server);
    }
  }
  const deduplicatedServers = Array.from(serverMap.values());

  const timestamp = new Date().toISOString();
  const store: MCPRegistryStore = {
    servers: deduplicatedServers,
    lastSynced: timestamp,
    totalCount: deduplicatedServers.length,
  };

  await saveStore(store);
  console.log(`MCP registry sync complete: ${deduplicatedServers.length} unique servers (from ${servers.length} total versions)`);

  return { count: deduplicatedServers.length, timestamp };
}

/**
 * Compare two semver-like version strings
 * Returns positive if a > b, negative if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(n => parseInt(n, 10) || 0);
  const partsB = b.split('.').map(n => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

/**
 * Get registry status (last sync time, count)
 */
export async function getRegistryStatus(): Promise<{ lastSynced: string | null; count: number }> {
  const store = await loadStore();
  return { lastSynced: store.lastSynced, count: store.totalCount };
}

/**
 * Get all servers
 */
export async function getAllServers(): Promise<MCPServer[]> {
  const store = await loadStore();
  return store.servers;
}

/**
 * Simple fuzzy search implementation
 */
function fuzzyMatch(text: string, query: string): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Exact match gets highest score
  if (lowerText === lowerQuery) return 1;

  // Contains match
  if (lowerText.includes(lowerQuery)) return 0.8;

  // Fuzzy matching - check if all query chars appear in order
  let queryIndex = 0;
  let score = 0;
  let consecutiveBonus = 0;

  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      score += 1 + consecutiveBonus;
      consecutiveBonus += 0.5; // Bonus for consecutive matches
      queryIndex++;
    } else {
      consecutiveBonus = 0;
    }
  }

  // All query chars must be found
  if (queryIndex < lowerQuery.length) return 0;

  // Normalize score
  return (score / (lowerQuery.length * 2)) * 0.6;
}

export interface SearchResult {
  servers: MCPServer[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Search servers with fuzzy matching and pagination
 */
export async function searchServers(
  query: string,
  limit: number = 50,
  offset: number = 0
): Promise<SearchResult> {
  const store = await loadStore();

  let results: MCPServer[];

  if (!query.trim()) {
    // No query - return all servers paginated
    results = store.servers;
  } else {
    // Score each server
    const scored = store.servers.map(server => {
      const nameScore = fuzzyMatch(server.name, query) * 2; // Name weighted higher
      const titleScore = fuzzyMatch(server.title || '', query) * 1.5;
      const descScore = fuzzyMatch(server.description || '', query);

      // Check package identifiers too
      const packageScore = (server.packages || []).reduce((max, pkg) => {
        return Math.max(max, fuzzyMatch(pkg.identifier, query));
      }, 0);

      const totalScore = nameScore + titleScore + descScore + packageScore;

      return { server, score: totalScore };
    });

    // Filter and sort by score
    results = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.server);
  }

  return {
    servers: results.slice(offset, offset + limit),
    total: results.length,
    offset,
    limit,
  };
}

/**
 * Get a specific server by name
 */
export async function getServerByName(name: string): Promise<MCPServer | null> {
  const store = await loadStore();
  return store.servers.find(s => s.name === name) || null;
}

/**
 * Generate install command for Claude Code
 */
export function generateInstallCommand(server: MCPServer): string | null {
  if (!server.packages || server.packages.length === 0) {
    return null;
  }

  // Prefer npm packages, then pypi
  const npmPackage = server.packages.find(p => p.registryType === 'npm');
  if (npmPackage) {
    return `claude mcp add ${server.name} -- npx -y ${npmPackage.identifier}`;
  }

  const pypiPackage = server.packages.find(p => p.registryType === 'pypi');
  if (pypiPackage) {
    return `claude mcp add ${server.name} -- uvx ${pypiPackage.identifier}`;
  }

  // For other types, show a generic command
  const pkg = server.packages[0];
  return `# ${pkg.registryType} package: ${pkg.identifier}@${pkg.version}`;
}

/**
 * Get servers by registry type (npm, pypi, etc.)
 */
export async function getServersByRegistryType(registryType: string): Promise<MCPServer[]> {
  const store = await loadStore();
  return store.servers.filter(server =>
    server.packages?.some(pkg => pkg.registryType === registryType)
  );
}

// ============ Favorites ============

interface FavoritesStore {
  favorites: string[]; // Array of server names
}

async function loadFavorites(): Promise<FavoritesStore> {
  try {
    if (existsSync(MCP_FAVORITES_FILE)) {
      const data = await readFile(MCP_FAVORITES_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load MCP favorites:', error);
  }
  return { favorites: [] };
}

async function saveFavorites(store: FavoritesStore): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MCP_FAVORITES_FILE, JSON.stringify(store, null, 2));
}

export async function getFavorites(): Promise<string[]> {
  const store = await loadFavorites();
  return store.favorites;
}

export async function addFavorite(serverName: string): Promise<void> {
  const store = await loadFavorites();
  if (!store.favorites.includes(serverName)) {
    store.favorites.push(serverName);
    await saveFavorites(store);
  }
}

export async function removeFavorite(serverName: string): Promise<void> {
  const store = await loadFavorites();
  store.favorites = store.favorites.filter(f => f !== serverName);
  await saveFavorites(store);
}

export async function isFavorite(serverName: string): Promise<boolean> {
  const store = await loadFavorites();
  return store.favorites.includes(serverName);
}

export async function getFavoriteServers(): Promise<MCPServer[]> {
  const [registryStore, favoritesStore] = await Promise.all([
    loadStore(),
    loadFavorites(),
  ]);

  return registryStore.servers.filter(s => favoritesStore.favorites.includes(s.name));
}

// ============ README Fetching ============

/**
 * Extract GitHub owner and repo from a repository URL
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Handle various GitHub URL formats
  const patterns = [
    /github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/|$)/,
    /github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }
  return null;
}

/**
 * Fetch README content from GitHub repository
 */
export async function fetchReadme(serverName: string): Promise<string | null> {
  const server = await getServerByName(serverName);
  if (!server) {
    console.log(`[fetchReadme] Server not found: ${serverName}`);
    return null;
  }

  if (!server.repository?.url) {
    console.log(`[fetchReadme] No repository URL for: ${serverName}`);
    return null;
  }

  const parsed = parseGitHubUrl(server.repository.url);
  if (!parsed) {
    console.log(`[fetchReadme] Could not parse GitHub URL: ${server.repository.url}`);
    return null;
  }

  // Extract subdirectory from repository URL if present (for monorepos)
  // e.g., https://github.com/owner/repo/tree/main/packages/server
  let subdir = '';
  const subdirMatch = server.repository.url.match(/github\.com\/[^\/]+\/[^\/]+\/tree\/[^\/]+\/(.+)/);
  if (subdirMatch) {
    subdir = subdirMatch[1] + '/';
  }

  // Try common README filenames
  const readmeFiles = ['README.md', 'readme.md', 'Readme.md', 'README.MD'];
  const branches = ['main', 'master'];

  for (const branch of branches) {
    for (const filename of readmeFiles) {
      try {
        // First try with subdirectory if present
        if (subdir) {
          const subdirUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${subdir}${filename}`;
          const subdirResponse = await fetch(subdirUrl);
          if (subdirResponse.ok) {
            return await subdirResponse.text();
          }
        }

        // Try root directory
        const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${filename}`;
        const response = await fetch(rawUrl);

        if (response.ok) {
          return await response.text();
        }
      } catch (error) {
        // Continue to next filename/branch
      }
    }
  }

  console.log(`[fetchReadme] README not found for: ${serverName} (${server.repository.url})`);
  return null;
}
