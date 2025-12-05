/**
 * Component Library Service
 * Manages pre-built and custom docker-compose components
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const DATA_DIR = join(PROJECT_ROOT, 'data');
const COMPONENTS_FILE = join(DATA_DIR, 'components.json');

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

// Pre-built components that come with the system
const BUILT_IN_COMPONENTS: Component[] = [
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Powerful open-source relational database',
    category: 'database',
    icon: '🐘',
    image: 'postgres',
    defaultTag: '16-alpine',
    ports: [
      { container: 5432, host: 5432, description: 'PostgreSQL port' }
    ],
    volumes: [
      { name: 'postgres_data', path: '/var/lib/postgresql/data', description: 'Database storage' }
    ],
    environment: [
      { name: 'POSTGRES_USER', value: 'postgres', description: 'Database user', required: true },
      { name: 'POSTGRES_PASSWORD', value: 'postgres', description: 'Database password', required: true },
      { name: 'POSTGRES_DB', value: 'app', description: 'Default database name' }
    ],
    healthcheck: {
      test: 'pg_isready -U postgres',
      interval: '10s',
      timeout: '5s',
      retries: 5
    },
    builtIn: true,
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 'nginx',
    name: 'Nginx',
    description: 'High-performance web server and reverse proxy',
    category: 'web',
    icon: '🌐',
    image: 'nginx',
    defaultTag: 'alpine',
    ports: [
      { container: 80, host: 8080, description: 'HTTP port' },
      { container: 443, description: 'HTTPS port' }
    ],
    volumes: [
      { name: 'nginx_conf', path: '/etc/nginx/conf.d', description: 'Configuration files' },
      { name: 'nginx_html', path: '/usr/share/nginx/html', description: 'Static files' }
    ],
    environment: [],
    healthcheck: {
      test: 'curl -f http://localhost/ || exit 1',
      interval: '30s',
      timeout: '10s',
      retries: 3
    },
    builtIn: true,
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 'redis',
    name: 'Redis',
    description: 'In-memory data store for caching and messaging',
    category: 'cache',
    icon: '⚡',
    image: 'redis',
    defaultTag: '7-alpine',
    ports: [
      { container: 6379, host: 6379, description: 'Redis port' }
    ],
    volumes: [
      { name: 'redis_data', path: '/data', description: 'Data persistence' }
    ],
    environment: [],
    healthcheck: {
      test: 'redis-cli ping',
      interval: '10s',
      timeout: '5s',
      retries: 5
    },
    builtIn: true,
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 'mysql',
    name: 'MySQL',
    description: 'Popular open-source relational database',
    category: 'database',
    icon: '🐬',
    image: 'mysql',
    defaultTag: '8',
    ports: [
      { container: 3306, host: 3306, description: 'MySQL port' }
    ],
    volumes: [
      { name: 'mysql_data', path: '/var/lib/mysql', description: 'Database storage' }
    ],
    environment: [
      { name: 'MYSQL_ROOT_PASSWORD', value: 'rootpassword', description: 'Root password', required: true },
      { name: 'MYSQL_DATABASE', value: 'app', description: 'Default database' },
      { name: 'MYSQL_USER', value: 'user', description: 'Database user' },
      { name: 'MYSQL_PASSWORD', value: 'password', description: 'User password' }
    ],
    healthcheck: {
      test: 'mysqladmin ping -h localhost',
      interval: '10s',
      timeout: '5s',
      retries: 5
    },
    builtIn: true,
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    description: 'Document-oriented NoSQL database',
    category: 'database',
    icon: '🍃',
    image: 'mongo',
    defaultTag: '7',
    ports: [
      { container: 27017, host: 27017, description: 'MongoDB port' }
    ],
    volumes: [
      { name: 'mongo_data', path: '/data/db', description: 'Database storage' }
    ],
    environment: [
      { name: 'MONGO_INITDB_ROOT_USERNAME', value: 'admin', description: 'Admin username' },
      { name: 'MONGO_INITDB_ROOT_PASSWORD', value: 'adminpassword', description: 'Admin password' }
    ],
    healthcheck: {
      test: 'mongosh --eval "db.adminCommand(\'ping\')"',
      interval: '10s',
      timeout: '5s',
      retries: 5
    },
    builtIn: true,
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 'rabbitmq',
    name: 'RabbitMQ',
    description: 'Message broker for distributed systems',
    category: 'messaging',
    icon: '🐰',
    image: 'rabbitmq',
    defaultTag: '3-management-alpine',
    ports: [
      { container: 5672, host: 5672, description: 'AMQP port' },
      { container: 15672, host: 15672, description: 'Management UI' }
    ],
    volumes: [
      { name: 'rabbitmq_data', path: '/var/lib/rabbitmq', description: 'Data persistence' }
    ],
    environment: [
      { name: 'RABBITMQ_DEFAULT_USER', value: 'admin', description: 'Admin user' },
      { name: 'RABBITMQ_DEFAULT_PASS', value: 'adminpassword', description: 'Admin password' }
    ],
    healthcheck: {
      test: 'rabbitmq-diagnostics -q ping',
      interval: '30s',
      timeout: '10s',
      retries: 5
    },
    builtIn: true,
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 'minio',
    name: 'MinIO',
    description: 'S3-compatible object storage',
    category: 'storage',
    icon: '📦',
    image: 'minio/minio',
    defaultTag: 'latest',
    ports: [
      { container: 9000, host: 9000, description: 'API port' },
      { container: 9001, host: 9001, description: 'Console UI' }
    ],
    volumes: [
      { name: 'minio_data', path: '/data', description: 'Object storage' }
    ],
    environment: [
      { name: 'MINIO_ROOT_USER', value: 'minioadmin', description: 'Admin user' },
      { name: 'MINIO_ROOT_PASSWORD', value: 'minioadmin', description: 'Admin password' }
    ],
    healthcheck: {
      test: 'curl -f http://localhost:9000/minio/health/live || exit 1',
      interval: '30s',
      timeout: '10s',
      retries: 3
    },
    builtIn: true,
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 'elasticsearch',
    name: 'Elasticsearch',
    description: 'Distributed search and analytics engine',
    category: 'database',
    icon: '🔍',
    image: 'elasticsearch',
    defaultTag: '8.11.0',
    ports: [
      { container: 9200, host: 9200, description: 'REST API' },
      { container: 9300, host: 9300, description: 'Node communication' }
    ],
    volumes: [
      { name: 'es_data', path: '/usr/share/elasticsearch/data', description: 'Data storage' }
    ],
    environment: [
      { name: 'discovery.type', value: 'single-node', description: 'Single node mode' },
      { name: 'ES_JAVA_OPTS', value: '-Xms512m -Xmx512m', description: 'JVM memory' },
      { name: 'xpack.security.enabled', value: 'false', description: 'Disable security' }
    ],
    healthcheck: {
      test: 'curl -f http://localhost:9200/_cluster/health || exit 1',
      interval: '30s',
      timeout: '10s',
      retries: 5
    },
    builtIn: true,
    createdAt: '2024-01-01T00:00:00Z'
  }
];

interface ComponentStore {
  customComponents: Component[];
}

async function loadStore(): Promise<ComponentStore> {
  try {
    if (existsSync(COMPONENTS_FILE)) {
      const data = await readFile(COMPONENTS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load components store:', error);
  }
  return { customComponents: [] };
}

async function saveStore(store: ComponentStore): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(COMPONENTS_FILE, JSON.stringify(store, null, 2));
}

export async function getAllComponents(): Promise<Component[]> {
  const store = await loadStore();
  return [...BUILT_IN_COMPONENTS, ...store.customComponents];
}

export async function getComponentById(id: string): Promise<Component | null> {
  const all = await getAllComponents();
  return all.find(c => c.id === id) || null;
}

export async function getComponentsByCategory(category: Component['category']): Promise<Component[]> {
  const all = await getAllComponents();
  return all.filter(c => c.category === category);
}

export async function addComponent(component: Omit<Component, 'id' | 'builtIn' | 'createdAt'>): Promise<Component> {
  const store = await loadStore();

  // Generate a unique ID
  const id = component.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

  // Check for duplicate
  const all = await getAllComponents();
  if (all.some(c => c.id === id)) {
    throw new Error(`Component with ID "${id}" already exists`);
  }

  const newComponent: Component = {
    ...component,
    id,
    builtIn: false,
    createdAt: new Date().toISOString()
  };

  store.customComponents.push(newComponent);
  await saveStore(store);

  return newComponent;
}

export async function updateComponent(id: string, updates: Partial<Omit<Component, 'id' | 'builtIn' | 'createdAt'>>): Promise<Component> {
  const store = await loadStore();

  // Check if it's a built-in component
  if (BUILT_IN_COMPONENTS.some(c => c.id === id)) {
    throw new Error('Cannot modify built-in components');
  }

  const index = store.customComponents.findIndex(c => c.id === id);
  if (index === -1) {
    throw new Error(`Component "${id}" not found`);
  }

  store.customComponents[index] = {
    ...store.customComponents[index],
    ...updates
  };

  await saveStore(store);
  return store.customComponents[index];
}

export async function deleteComponent(id: string): Promise<void> {
  const store = await loadStore();

  // Check if it's a built-in component
  if (BUILT_IN_COMPONENTS.some(c => c.id === id)) {
    throw new Error('Cannot delete built-in components');
  }

  const index = store.customComponents.findIndex(c => c.id === id);
  if (index === -1) {
    throw new Error(`Component "${id}" not found`);
  }

  store.customComponents.splice(index, 1);
  await saveStore(store);
}

/**
 * Generate docker-compose YAML for a component
 */
export function generateComposeYaml(component: Component, serviceName?: string): string {
  const name = serviceName || component.id;
  const lines: string[] = [];

  lines.push(`  ${name}:`);
  lines.push(`    image: ${component.image}:${component.defaultTag}`);

  // Ports
  if (component.ports.length > 0) {
    lines.push('    ports:');
    for (const port of component.ports) {
      if (port.host) {
        lines.push(`      - "${port.host}:${port.container}"`);
      } else {
        lines.push(`      - "${port.container}"`);
      }
    }
  }

  // Volumes
  if (component.volumes.length > 0) {
    lines.push('    volumes:');
    for (const vol of component.volumes) {
      lines.push(`      - ${vol.name}:${vol.path}`);
    }
  }

  // Environment
  if (component.environment.length > 0) {
    lines.push('    environment:');
    for (const env of component.environment) {
      lines.push(`      ${env.name}: "${env.value}"`);
    }
  }

  // Healthcheck
  if (component.healthcheck) {
    lines.push('    healthcheck:');
    lines.push(`      test: ["CMD-SHELL", "${component.healthcheck.test}"]`);
    if (component.healthcheck.interval) {
      lines.push(`      interval: ${component.healthcheck.interval}`);
    }
    if (component.healthcheck.timeout) {
      lines.push(`      timeout: ${component.healthcheck.timeout}`);
    }
    if (component.healthcheck.retries) {
      lines.push(`      retries: ${component.healthcheck.retries}`);
    }
  }

  // Restart policy
  lines.push('    restart: unless-stopped');

  return lines.join('\n');
}

/**
 * Generate volume definitions for components
 */
export function generateVolumesYaml(components: Component[]): string {
  const volumes = new Set<string>();

  for (const comp of components) {
    for (const vol of comp.volumes) {
      volumes.add(vol.name);
    }
  }

  if (volumes.size === 0) return '';

  const lines: string[] = ['volumes:'];
  for (const vol of volumes) {
    lines.push(`  ${vol}:`);
  }

  return lines.join('\n');
}
