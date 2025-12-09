// Dynamic server discovery
let cachedServerUrl: string | null = null;
const SERVER_PORTS_TO_TRY = [4001, 4002, 4003, 4004, 4005, 3001, 3002, 3003];

async function discoverServer(): Promise<string> {
  // Try cached URL first
  if (cachedServerUrl) {
    try {
      const response = await fetch(`${cachedServerUrl}/api/health`, { method: 'GET' });
      if (response.ok) {
        return cachedServerUrl;
      }
    } catch {
      // Server moved, re-discover
      cachedServerUrl = null;
    }
  }

  // Try each port
  for (const port of SERVER_PORTS_TO_TRY) {
    try {
      const url = `http://localhost:${port}`;
      const response = await fetch(`${url}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(500), // 500ms timeout per port
      });
      if (response.ok) {
        console.log(`🔗 Connected to API server on port ${port}`);
        cachedServerUrl = url;
        return url;
      }
    } catch {
      // Try next port
    }
  }

  throw new Error('Could not find API server. Is it running?');
}

async function getApiBase(): Promise<string> {
  const serverUrl = await discoverServer();
  return `${serverUrl}/api`;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: 'running' | 'stopped' | 'created' | 'exited' | 'paused' | 'building' | 'failed';
  sshPort: number | null;
  sshCommand: string | null;
  volumes: Array<{ name: string; mountPath: string }>;
  ports: Array<{ container: number; host: number }>;
  createdAt: string;
}

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  createdAt: string;
  size: number;
}

export interface ImageInfo {
  id: string;
  repoTags: string[];
  size: number;
  created: string;
}

export interface CreateContainerRequest {
  name: string;
  image?: string;
  dockerfile?: string;
  volumes?: Array<{ name: string; mountPath: string }>;
  ports?: Array<{ container: number; host: number }>;
  env?: Record<string, string>;
}

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const apiBase = await getApiBase();

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Containers
export async function listContainers(): Promise<ContainerInfo[]> {
  return fetchAPI('/containers');
}

export async function getContainer(id: string): Promise<ContainerInfo> {
  return fetchAPI(`/containers/${id}`);
}

export async function createContainer(request: CreateContainerRequest): Promise<{
  buildId: string;
  status: 'building';
  message: string;
}> {
  return fetchAPI('/containers', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function startContainer(id: string): Promise<void> {
  await fetchAPI(`/containers/${id}/start`, { method: 'POST' });
}

export async function stopContainer(id: string): Promise<void> {
  await fetchAPI(`/containers/${id}/stop`, { method: 'POST' });
}

export async function removeContainer(id: string): Promise<void> {
  await fetchAPI(`/containers/${id}`, { method: 'DELETE' });
}

export interface ReconfigureContainerRequest {
  volumes?: Array<{ name: string; mountPath: string }>;
  ports?: Array<{ container: number; host: number }>;
}

export async function reconfigureContainer(id: string, request: ReconfigureContainerRequest): Promise<ContainerInfo> {
  return fetchAPI(`/containers/${id}/reconfigure`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function downloadSshKey(id: string): Promise<Blob> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/containers/${id}/ssh-key`);
  if (!response.ok) {
    throw new Error('Failed to download SSH key');
  }
  return response.blob();
}

// Images
export async function listImages(): Promise<ImageInfo[]> {
  return fetchAPI('/images');
}

export async function pullImage(image: string): Promise<void> {
  await fetchAPI('/images/pull', {
    method: 'POST',
    body: JSON.stringify({ image }),
  });
}

export async function removeImage(id: string): Promise<void> {
  await fetchAPI(`/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Volumes
export async function listVolumes(): Promise<VolumeInfo[]> {
  return fetchAPI('/volumes');
}

export async function createVolume(name: string): Promise<void> {
  await fetchAPI('/volumes', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function removeVolume(name: string): Promise<void> {
  await fetchAPI(`/volumes/${name}`, { method: 'DELETE' });
}

export async function getVolumeSize(name: string): Promise<number> {
  const result = await fetchAPI<{ size: number }>(`/volumes/${name}/size`);
  return result.size;
}

export async function getVolumeFiles(name: string): Promise<string[]> {
  const result = await fetchAPI<{ files: string[] }>(`/volumes/${name}/files`);
  return result.files;
}

export async function uploadFileToVolume(volumeName: string, file: File): Promise<void> {
  const serverUrl = await discoverServer();
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${serverUrl}/api/volumes/${volumeName}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(error.error || 'Upload failed');
  }
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export async function uploadDirectoryToVolume(
  volumeName: string,
  files: Array<{ file: File; relativePath: string }>,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> {
  const serverUrl = await discoverServer();
  const formData = new FormData();

  // Append each file with its relative path as metadata
  for (let i = 0; i < files.length; i++) {
    const { file, relativePath } = files[i];
    formData.append('files', file);
    formData.append('paths', relativePath);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.error || 'Upload failed'));
        } catch {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed: Network error'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload cancelled'));
    });

    xhr.open('POST', `${serverUrl}/api/volumes/${volumeName}/upload-directory`);
    xhr.send(formData);
  });
}

// Dockerfiles
export async function listDockerfiles(): Promise<string[]> {
  return fetchAPI('/dockerfiles');
}

export async function getDockerfile(name: string): Promise<{ name: string; content: string }> {
  return fetchAPI(`/dockerfiles/${name}`);
}

export async function saveDockerfile(name: string, content: string): Promise<void> {
  await fetchAPI(`/dockerfiles/${name}`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function deleteDockerfile(name: string): Promise<void> {
  await fetchAPI(`/dockerfiles/${name}`, { method: 'DELETE' });
}

export async function buildDockerfile(
  name: string,
  onLog: (log: string) => void,
  onDone: (tag: string) => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = await discoverServer();

  return new Promise((resolve, reject) => {
    // Use fetch with streaming for SSE
    fetch(`${serverUrl}/api/dockerfiles/${name}/build`, {
      method: 'POST',
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Build failed' }));
        onError(error.error || 'Build failed');
        reject(new Error(error.error || 'Build failed'));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        reject(new Error('No response stream'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const eventBlock of lines) {
          const eventMatch = eventBlock.match(/event: (\w+)/);
          const dataMatch = eventBlock.match(/data: (.+)/);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);

            if (event === 'log') {
              onLog(data);
            } else if (event === 'done') {
              onDone(data);
              resolve();
            } else if (event === 'error') {
              onError(data);
              reject(new Error(data));
            }
          }
        }
      }
      resolve();
    }).catch((err) => {
      onError(err.message);
      reject(err);
    });
  });
}

// Health
export async function checkHealth(): Promise<{ status: string; docker: string }> {
  return fetchAPI('/health');
}

// Config
export interface AppConfig {
  sshKeysDisplayPath: string;
  dataDirectory: string;
  defaultDevNodeImage: string;
}

export async function getConfig(): Promise<AppConfig> {
  return fetchAPI('/config');
}

export async function updateConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
  return fetchAPI('/config', {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

// Directory browsing
export interface DirectoryEntry {
  name: string;
  path: string;
  hidden?: boolean;
}

export interface BrowseDirectoryResponse {
  currentPath: string;
  parent: string | null;
  directories: DirectoryEntry[];
}

export async function browseDirectory(path?: string): Promise<BrowseDirectoryResponse> {
  return fetchAPI('/config/browse', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

// Compose
export interface ComposeService {
  name: string;
  containerId: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'created' | 'unknown';
  image: string;
  ports: Array<{ container: number; host: number | null }>;
  sshPort: number | null;
}

export interface ComposeProject {
  name: string;
  status: 'running' | 'partial' | 'stopped';
  services: ComposeService[];
  createdAt: string;
}

export interface ComposeContent {
  name: string;
  content: string;
}

export async function listComposeProjects(): Promise<ComposeProject[]> {
  return fetchAPI('/composes');
}

export async function getComposeProject(name: string): Promise<ComposeProject> {
  return fetchAPI(`/composes/${name}`);
}

export async function getComposeContent(name: string): Promise<ComposeContent> {
  return fetchAPI(`/composes/${name}/content`);
}

export async function createComposeProject(name: string, content: string): Promise<ComposeProject> {
  return fetchAPI('/composes', {
    method: 'POST',
    body: JSON.stringify({ name, content }),
  });
}

export async function updateComposeProject(name: string, content: string): Promise<ComposeProject> {
  return fetchAPI(`/composes/${name}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function deleteComposeProject(name: string): Promise<void> {
  await fetchAPI(`/composes/${name}`, { method: 'DELETE' });
}

export async function renameComposeProject(name: string, newName: string): Promise<ComposeProject> {
  return fetchAPI(`/composes/${name}/rename`, {
    method: 'POST',
    body: JSON.stringify({ newName }),
  });
}

export async function composeUp(
  name: string,
  onLog: (log: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = await discoverServer();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/composes/${name}/up`, {
      method: 'POST',
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to start' }));
        onError(error.error || 'Failed to start');
        reject(new Error(error.error || 'Failed to start'));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        reject(new Error('No response stream'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const eventBlock of lines) {
          const eventMatch = eventBlock.match(/event: (\w+)/);
          const dataMatch = eventBlock.match(/data: (.+)/);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);

            if (event === 'log') {
              onLog(data);
            } else if (event === 'done') {
              onDone();
              resolve();
            } else if (event === 'error') {
              onError(data);
              reject(new Error(data));
            }
          }
        }
      }
      resolve();
    }).catch((err) => {
      onError(err.message);
      reject(err);
    });
  });
}

export async function composeDown(
  name: string,
  onLog: (log: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = await discoverServer();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/composes/${name}/down`, {
      method: 'POST',
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to stop' }));
        onError(error.error || 'Failed to stop');
        reject(new Error(error.error || 'Failed to stop'));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        reject(new Error('No response stream'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const eventBlock of lines) {
          const eventMatch = eventBlock.match(/event: (\w+)/);
          const dataMatch = eventBlock.match(/data: (.+)/);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);

            if (event === 'log') {
              onLog(data);
            } else if (event === 'done') {
              onDone();
              resolve();
            } else if (event === 'error') {
              onError(data);
              reject(new Error(data));
            }
          }
        }
      }
      resolve();
    }).catch((err) => {
      onError(err.message);
      reject(err);
    });
  });
}

// AI Chat
export interface AIStatus {
  configured: boolean;
}

export async function getAIStatus(): Promise<AIStatus> {
  return fetchAPI('/ai/status');
}

export async function streamComposeChat(
  message: string,
  composeContent: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = await discoverServer();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/ai/compose-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, composeContent }),
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'AI request failed' }));
        onError(error.error || 'AI request failed');
        reject(new Error(error.error || 'AI request failed'));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        reject(new Error('No response stream'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const eventBlock of lines) {
          const eventMatch = eventBlock.match(/event: (\w+)/);
          const dataMatch = eventBlock.match(/data: (.+)/);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);

            if (event === 'chunk') {
              onChunk(data);
            } else if (event === 'done') {
              onDone();
              resolve();
            } else if (event === 'error') {
              onError(data);
              reject(new Error(data));
            }
          }
        }
      }
      resolve();
    }).catch((err) => {
      onError(err.message);
      reject(err);
    });
  });
}

export async function streamDockerfileChat(
  message: string,
  dockerfileContent: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = await discoverServer();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/ai/dockerfile-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, dockerfileContent }),
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'AI request failed' }));
        onError(error.error || 'AI request failed');
        reject(new Error(error.error || 'AI request failed'));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        reject(new Error('No response stream'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const eventBlock of lines) {
          const eventMatch = eventBlock.match(/event: (\w+)/);
          const dataMatch = eventBlock.match(/data: (.+)/);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);

            if (event === 'chunk') {
              onChunk(data);
            } else if (event === 'done') {
              onDone();
              resolve();
            } else if (event === 'error') {
              onError(data);
              reject(new Error(data));
            }
          }
        }
      }
      resolve();
    }).catch((err) => {
      onError(err.message);
      reject(err);
    });
  });
}

// AI Prompts
export interface AIPromptInfo {
  current: string;
  default: string;
  isCustom: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
}

export interface ModelInfo {
  current: string;
  default: string;
  available: ModelOption[];
}

export interface AIPrompts {
  compose: AIPromptInfo;
  dockerfile: AIPromptInfo;
  mcpInstall: AIPromptInfo;
  mcpSearch: AIPromptInfo;
  model: ModelInfo;
}

export async function getAIPrompts(): Promise<AIPrompts> {
  return fetchAPI('/ai/prompts');
}

export async function updateComposePrompt(prompt: string | null): Promise<{ success: boolean; prompt: string }> {
  return fetchAPI('/ai/prompts/compose', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export async function updateDockerfilePrompt(prompt: string | null): Promise<{ success: boolean; prompt: string }> {
  return fetchAPI('/ai/prompts/dockerfile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export async function updateMCPInstallPrompt(prompt: string | null): Promise<{ success: boolean; prompt: string }> {
  return fetchAPI('/ai/prompts/mcp-install', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export async function updateMCPSearchPrompt(prompt: string | null): Promise<{ success: boolean; prompt: string }> {
  return fetchAPI('/ai/prompts/mcp-search', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

export async function updateModel(model: string | null): Promise<{ success: boolean; model: string }> {
  return fetchAPI('/ai/model', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
}

// Components
export interface ComponentPort {
  container: number;
  host?: number;
  description?: string;
}

export interface ComponentVolume {
  name: string;
  path: string;
  description?: string;
}

export interface ComponentEnvVar {
  name: string;
  value: string;
  description?: string;
  required?: boolean;
}

export interface Component {
  id: string;
  name: string;
  description: string;
  category: 'database' | 'cache' | 'web' | 'messaging' | 'storage' | 'monitoring' | 'development' | 'other';
  icon?: string;
  image: string;
  defaultTag: string;
  ports: ComponentPort[];
  volumes: ComponentVolume[];
  environment: ComponentEnvVar[];
  healthcheck?: {
    test: string;
    interval?: string;
    timeout?: string;
    retries?: number;
  };
  dependsOn?: string[];
  networks?: string[];
  builtIn: boolean;
  createdAt: string;
}

export async function listComponents(): Promise<Component[]> {
  return fetchAPI('/components');
}

export async function getComponent(id: string): Promise<Component> {
  return fetchAPI(`/components/${id}`);
}

export async function getComponentsByCategory(category: Component['category']): Promise<Component[]> {
  return fetchAPI(`/components/category/${category}`);
}

export async function createComponent(component: Omit<Component, 'id' | 'builtIn' | 'createdAt'>): Promise<Component> {
  return fetchAPI('/components', {
    method: 'POST',
    body: JSON.stringify(component),
  });
}

export async function updateComponent(id: string, updates: Partial<Omit<Component, 'id' | 'builtIn' | 'createdAt'>>): Promise<Component> {
  return fetchAPI(`/components/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteComponent(id: string): Promise<void> {
  await fetchAPI(`/components/${id}`, { method: 'DELETE' });
}

export async function getComponentYaml(id: string, serviceName?: string): Promise<{ yaml: string }> {
  const params = serviceName ? `?name=${encodeURIComponent(serviceName)}` : '';
  return fetchAPI(`/components/${id}/yaml${params}`);
}

export async function createComponentFromAI(request: string): Promise<{ success: boolean; component: Component }> {
  return fetchAPI('/ai/create-component', {
    method: 'POST',
    body: JSON.stringify({ request }),
  });
}

// MCP Registry

export interface MCPPackage {
  registryType: 'npm' | 'pypi' | 'docker' | 'crate' | string;
  identifier: string;
  version: string;
  transport?: {
    type: 'stdio' | 'sse' | 'streamable-http' | string;
    args?: string[];
  };
}

export type MCPServerSource = 'anthropic' | 'manual' | 'github' | 'docker';

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
  installCommand?: string;
  source?: MCPServerSource;
}

export interface MCPRegistryStatus {
  lastSynced: string | null;
  count: number;
}

export async function getMCPRegistryStatus(): Promise<MCPRegistryStatus> {
  return fetchAPI('/mcp/status');
}

export async function syncMCPRegistry(
  onProgress?: (message: string) => void,
  onComplete?: (result: { count: number; timestamp: string }) => void,
  onError?: (error: string) => void
): Promise<void> {
  const apiBase = await getApiBase();

  const response = await fetch(`${apiBase}/mcp/sync`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        const eventType = line.slice(6).trim();
        const dataLine = lines[lines.indexOf(line) + 1];
        if (dataLine?.startsWith('data:')) {
          const data = dataLine.slice(5).trim();
          if (eventType === 'status') {
            onProgress?.(data);
          } else if (eventType === 'done') {
            onComplete?.(JSON.parse(data));
          } else if (eventType === 'error') {
            onError?.(data);
          }
        }
      }
    }
  }
}

export async function listMCPServers(limit = 100, offset = 0): Promise<{
  servers: MCPServer[];
  total: number;
  limit: number;
  offset: number;
}> {
  return fetchAPI(`/mcp/servers?limit=${limit}&offset=${offset}`);
}

export async function searchMCPServers(query: string, limit = 50, offset = 0): Promise<{
  servers: MCPServer[];
  query: string;
  total: number;
  limit: number;
  offset: number;
}> {
  return fetchAPI(`/mcp/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`);
}

export async function aiSearchMCPServers(query: string): Promise<{
  servers: MCPServer[];
  total: number;
  query: string;
  aiSearch: boolean;
}> {
  return fetchAPI('/mcp/ai-search', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}

export async function getMCPServer(name: string): Promise<MCPServer> {
  return fetchAPI(`/mcp/servers/${encodeURIComponent(name)}`);
}

export async function getMCPInstallCommand(name: string): Promise<{ name: string; command: string | null }> {
  return fetchAPI(`/mcp/servers/${encodeURIComponent(name)}/install`);
}

export async function getMCPReadme(name: string): Promise<{ name: string; content: string }> {
  return fetchAPI(`/mcp/servers/${encodeURIComponent(name)}/readme`);
}

// MCP Favorites

export async function getMCPFavorites(): Promise<{
  favorites: string[];
  servers: MCPServer[];
}> {
  return fetchAPI('/mcp/favorites');
}

export async function addMCPFavorite(name: string): Promise<void> {
  await fetchAPI(`/mcp/favorites/${encodeURIComponent(name)}`, { method: 'POST' });
}

export async function removeMCPFavorite(name: string): Promise<void> {
  await fetchAPI(`/mcp/favorites/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function checkMCPFavorite(name: string): Promise<{ isFavorite: boolean }> {
  return fetchAPI(`/mcp/favorites/${encodeURIComponent(name)}/check`);
}

// Stream AI-generated install guide
export async function streamMCPInstallGuide(
  name: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const serverUrl = await discoverServer();

  return new Promise((resolve, reject) => {
    fetch(`${serverUrl}/api/mcp/servers/${encodeURIComponent(name)}/install-guide`, {
      method: 'POST',
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to generate install guide' }));
        onError(error.error || 'Failed to generate install guide');
        reject(new Error(error.error || 'Failed to generate install guide'));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response stream');
        reject(new Error('No response stream'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const eventBlock of lines) {
          const eventMatch = eventBlock.match(/event: (\w+)/);
          const dataMatch = eventBlock.match(/data: (.+)/s);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            const data = dataMatch[1];

            if (event === 'chunk') {
              onChunk(data);
            } else if (event === 'done') {
              onDone();
              resolve();
            } else if (event === 'error') {
              onError(data);
              reject(new Error(data));
            }
          }
        }
      }
      onDone();
      resolve();
    }).catch((err) => {
      onError(err.message);
      reject(err);
    });
  });
}

// ============ Manual MCP Servers ============

export async function addManualMCPServer(githubUrl: string): Promise<{ server: MCPServer }> {
  return fetchAPI('/mcp/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: githubUrl }),
  });
}

export async function getManualMCPServers(): Promise<{ servers: MCPServer[] }> {
  return fetchAPI('/mcp/manual');
}

export async function removeManualMCPServer(name: string): Promise<{ success: boolean }> {
  return fetchAPI(`/mcp/manual/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}
