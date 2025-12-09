import { z } from 'zod';

export const CreateContainerSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'Container name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen'),
  image: z.string().optional(),
  dockerfile: z.string().optional(),
  volumes: z.array(z.object({
    name: z.string(),
    mountPath: z.string(),
  })).optional(),
  ports: z.array(z.object({
    container: z.number().min(1).max(65535),
    host: z.number().min(1).max(65535),
  })).optional(),
  env: z.record(z.string()).optional(),
});

export type CreateContainerRequest = z.infer<typeof CreateContainerSchema>;

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

export const CreateVolumeSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'Volume name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen'),
});

export type CreateVolumeRequest = z.infer<typeof CreateVolumeSchema>;

export const SaveDockerfileSchema = z.object({
  content: z.string().min(1),
});

export type SaveDockerfileRequest = z.infer<typeof SaveDockerfileSchema>;

export const PullImageSchema = z.object({
  image: z.string().min(1),
});

export type PullImageRequest = z.infer<typeof PullImageSchema>;

export const BuildImageSchema = z.object({
  dockerfile: z.string().min(1),
  tag: z.string().min(1),
});

export type BuildImageRequest = z.infer<typeof BuildImageSchema>;

export const ReconfigureContainerSchema = z.object({
  volumes: z.array(z.object({
    name: z.string(),
    mountPath: z.string(),
  })).optional(),
  ports: z.array(z.object({
    container: z.number().min(1).max(65535),
    host: z.number().min(1).max(65535),
  })).optional(),
});

export type ReconfigureContainerRequest = z.infer<typeof ReconfigureContainerSchema>;

// Compose types
export const CreateComposeSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'Project name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen'),
  content: z.string().min(1),
});

export type CreateComposeRequest = z.infer<typeof CreateComposeSchema>;

export const UpdateComposeSchema = z.object({
  content: z.string().min(1),
});

export type UpdateComposeRequest = z.infer<typeof UpdateComposeSchema>;

export const RenameComposeSchema = z.object({
  newName: z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
    'Project name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen'),
});

export type RenameComposeRequest = z.infer<typeof RenameComposeSchema>;

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
