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
