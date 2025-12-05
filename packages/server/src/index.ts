import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { findAvailablePort } from './utils/port.js';
import { testConnection } from './services/docker.js';
import containers from './routes/containers.js';
import images from './routes/images.js';
import volumes from './routes/volumes.js';
import dockerfiles from './routes/dockerfiles.js';
import configRoutes from './routes/config.js';
import composes from './routes/composes.js';
import ai from './routes/ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const PORT_FILE = join(PROJECT_ROOT, 'data', '.server-port');

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: (origin) => {
    // Allow any localhost origin (handles dynamic ports)
    if (!origin || origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
      return origin || '*';
    }
    return null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type'],
}));

// Health check
app.get('/api/health', async (c) => {
  const dockerConnected = await testConnection();
  return c.json({
    status: 'ok',
    docker: dockerConnected ? 'connected' : 'disconnected',
  });
});

// Routes
app.route('/api/containers', containers);
app.route('/api/images', images);
app.route('/api/volumes', volumes);
app.route('/api/dockerfiles', dockerfiles);
app.route('/api/config', configRoutes);
app.route('/api/composes', composes);
app.route('/api/ai', ai);

// SSE for real-time events (placeholder for now)
app.get('/api/events', (c) => {
  // TODO: Implement Docker event streaming
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return c.body('data: {"type":"connected"}\n\n');
});

async function main() {
  const DEFAULT_PORT = 4001; // Use higher port to avoid conflicts
  const port = await findAvailablePort(DEFAULT_PORT);

  // Write port to file so frontend can discover it
  await mkdir(dirname(PORT_FILE), { recursive: true });
  await writeFile(PORT_FILE, port.toString());

  // Test Docker connection
  const dockerConnected = await testConnection();
  if (!dockerConnected) {
    console.warn('⚠️  Warning: Could not connect to Docker daemon');
    console.warn('   Make sure Docker is running and accessible');
  } else {
    console.log('✓ Docker connection established');
  }

  serve({
    fetch: app.fetch,
    port,
  }, (info) => {
    console.log(`\n🚀 Agent Containers API`);
    console.log(`   Running on http://localhost:${info.port}`);
    console.log(`   API docs: http://localhost:${info.port}/api/health\n`);
  });
}

main().catch(console.error);
