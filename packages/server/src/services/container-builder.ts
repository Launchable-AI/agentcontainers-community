import { execSync } from 'child_process';
import { mkdir, readFile, rm, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as dockerService from './docker.js';
import { findAvailableSshPort, validateHostPorts } from '../utils/port.js';
import type { CreateContainerRequest, ContainerInfo } from '../types/index.js';

const ACM_LABEL = 'agent-container-management';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const SSH_KEYS_DIR = join(PROJECT_ROOT, 'data', 'ssh-keys');
const APP_KEY_NAME = 'acm'; // Single app-wide SSH key

export interface ContainerBuildResult {
  container: ContainerInfo;
  privateKeyPath: string;
}

export async function buildAndCreateContainer(request: CreateContainerRequest): Promise<ContainerBuildResult> {
  const { name, image, dockerfile, volumes, ports, env } = request;

  // Get or create the app-wide SSH key
  const { publicKey } = await getOrCreateAppSshKey();
  const privateKeyPath = join(SSH_KEYS_DIR, `${APP_KEY_NAME}.pem`);

  // Determine which image to use
  let imageName: string;

  if (dockerfile) {
    // Build from user's dockerfile with SSH key baked in
    imageName = `acm-${name}:latest`;
    const dockerfileWithKey = injectPublicKey(dockerfile, publicKey);
    await dockerService.buildImage(dockerfileWithKey, imageName);
  } else if (image) {
    // Check if this image is already ACM-ready (has our label)
    const isAcmImage = await dockerService.imageHasLabel(image, ACM_LABEL);

    if (isAcmImage) {
      // Image already has SSH setup - use it directly
      // Note: If SSH fails, user should rebuild the image to get current key
      imageName = image;
    } else {
      // Base image needs SSH setup - build a new image with key baked in
      imageName = `acm-${name}:latest`;
      const baseDockerfile = createSshDockerfile(image, publicKey);
      await dockerService.buildImage(baseDockerfile, imageName);
    }
  } else {
    throw new Error('Either image or dockerfile must be provided');
  }

  // Validate that requested host ports are available
  await validateHostPorts(ports);

  // Find available SSH port
  const sshPort = await findAvailableSshPort();

  // Create container
  const container = await dockerService.createContainer({
    name,
    image: imageName,
    sshPort,
    volumes,
    ports,
    env,
  });

  // Start container
  await container.start();

  // Get container info
  const containerInfo = await dockerService.getContainer(container.id);
  if (!containerInfo) {
    throw new Error('Failed to get container info after creation');
  }

  return {
    container: containerInfo,
    privateKeyPath,
  };
}

// Inject SSH public key into Dockerfile (replaces {{PUBLIC_KEY}} placeholder)
function injectPublicKey(dockerfile: string, publicKey: string): string {
  return dockerfile.replace(/\{\{PUBLIC_KEY\}\}/g, publicKey);
}

export async function getPrivateKeyPath(): Promise<string> {
  return join(SSH_KEYS_DIR, `${APP_KEY_NAME}.pem`);
}

export async function getPrivateKey(): Promise<string> {
  const keyPath = await getPrivateKeyPath();
  return readFile(keyPath, 'utf-8');
}

export async function getPublicKey(): Promise<string> {
  const { publicKey } = await getOrCreateAppSshKey();
  return publicKey;
}

async function getOrCreateAppSshKey(): Promise<{ publicKey: string; privateKey: string }> {
  await mkdir(SSH_KEYS_DIR, { recursive: true });

  const privateKeyPath = join(SSH_KEYS_DIR, `${APP_KEY_NAME}.pem`);
  const publicKeyPath = join(SSH_KEYS_DIR, `${APP_KEY_NAME}.pem.pub`);

  // Check if key already exists
  try {
    await access(privateKeyPath);
    // Key exists, read and return it
    const privateKey = await readFile(privateKeyPath, 'utf-8');
    // Regenerate public key from private key if needed
    execSync(`ssh-keygen -y -f "${privateKeyPath}" > "${publicKeyPath}"`, { stdio: 'pipe' });
    const publicKey = await readFile(publicKeyPath, 'utf-8');
    await rm(publicKeyPath);
    return { publicKey: publicKey.trim(), privateKey };
  } catch {
    // Key doesn't exist, generate new one
  }

  // Generate key pair using ssh-keygen
  execSync(`ssh-keygen -t rsa -b 4096 -f "${privateKeyPath}" -N "" -C "agent-containers"`, {
    stdio: 'pipe',
  });

  // Read the generated keys
  const privateKey = await readFile(privateKeyPath, 'utf-8');
  const publicKey = await readFile(publicKeyPath, 'utf-8');

  // Clean up the .pub file (we only need the content)
  await rm(publicKeyPath);

  return { publicKey: publicKey.trim(), privateKey };
}

// Generate a complete Dockerfile when user only provides a base image
function createSshDockerfile(baseImage: string, publicKey: string): string {
  return `FROM ${baseImage}

# Install packages
RUN apt-get update && apt-get install -y \\
    openssh-server \\
    sudo \\
    curl \\
    git \\
    vim \\
    && rm -rf /var/lib/apt/lists/* \\
    && mkdir -p /var/run/sshd

# Create non-root user with sudo access
RUN useradd -m -s /bin/bash dev \\
    && echo 'dev ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Configure SSH for key-based auth
RUN sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config \\
    && sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config

# Setup SSH key
RUN mkdir -p /home/dev/.ssh \\
    && chmod 700 /home/dev/.ssh \\
    && echo '${publicKey}' > /home/dev/.ssh/authorized_keys \\
    && chmod 600 /home/dev/.ssh/authorized_keys \\
    && chown -R dev:dev /home/dev/.ssh

# Add ~/.local/bin to PATH for pip-installed tools
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/dev/.bashrc

# Set working directory
RUN mkdir -p /home/dev/workspace && chown dev:dev /home/dev/workspace
WORKDIR /home/dev/workspace

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
`;
}
