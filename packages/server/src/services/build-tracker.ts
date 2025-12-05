// Track container builds in progress

export interface BuildStatus {
  id: string;
  name: string;
  status: 'building' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
  containerId?: string;
}

// In-memory store for active builds
const builds = new Map<string, BuildStatus>();

export function createBuild(name: string): BuildStatus {
  const id = `build-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const build: BuildStatus = {
    id,
    name,
    status: 'building',
    startedAt: new Date().toISOString(),
  };
  builds.set(id, build);
  return build;
}

export function completeBuild(id: string, containerId: string): void {
  const build = builds.get(id);
  if (build) {
    build.status = 'completed';
    build.completedAt = new Date().toISOString();
    build.containerId = containerId;
    // Remove after a short delay so frontend can see completion
    setTimeout(() => builds.delete(id), 10000);
  }
}

export function failBuild(id: string, error: string): void {
  const build = builds.get(id);
  if (build) {
    build.status = 'failed';
    build.completedAt = new Date().toISOString();
    build.error = error;
    // Keep failed builds longer so user can see the error
    setTimeout(() => builds.delete(id), 60000);
  }
}

export function getBuild(id: string): BuildStatus | undefined {
  return builds.get(id);
}

export function listBuilds(): BuildStatus[] {
  return Array.from(builds.values());
}

export function getActiveBuildByName(name: string): BuildStatus | undefined {
  return Array.from(builds.values()).find(
    (b) => b.name === name && b.status === 'building'
  );
}

export function removeBuild(id: string): boolean {
  return builds.delete(id);
}
