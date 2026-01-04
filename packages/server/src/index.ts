import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { testConnection } from './services/docker.js';
import { getHypervisorService } from './services/hypervisor.js';
import {
  createTerminalSession,
  writeToSession,
  resizeSession,
  closeSessionByWebSocket,
} from './services/terminal.js';
import containers from './routes/containers.js';
import images from './routes/images.js';
import volumes from './routes/volumes.js';
import dockerfiles from './routes/dockerfiles.js';
import configRoutes from './routes/config.js';
import composes from './routes/composes.js';
import ai from './routes/ai.js';
import components from './routes/components.js';
import mcp from './routes/mcp.js';
import notes from './routes/notes.js';
import vms from './routes/vms.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: (origin) => {
    // Allow any origin for local development and remote access
    // In production, you may want to restrict this to specific domains
    return origin || '*';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type'],
}));

// Health check
app.get('/api/health', async (c) => {
  const dockerConnected = await testConnection();

  // Get hypervisor status (lazy - don't initialize if not already done)
  let hypervisor = null;
  try {
    const service = getHypervisorService();
    const networkStatus = service.getNetworkStatus();
    const vmStats = service.getStats();
    hypervisor = {
      initialized: true,
      network: networkStatus.healthy ? 'healthy' : 'not_configured',
      vms: vmStats,
    };
  } catch {
    hypervisor = { initialized: false };
  }

  return c.json({
    status: 'ok',
    docker: dockerConnected ? 'connected' : 'disconnected',
    hypervisor,
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
app.route('/api/components', components);
app.route('/api/mcp', mcp);
app.route('/api/notes', notes);
app.route('/api/vms', vms);

// SSE for real-time events (placeholder for now)
app.get('/api/events', (c) => {
  // TODO: Implement Docker event streaming
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return c.body('data: {"type":"connected"}\n\n');
});

function setupWebSocketServer(server: ReturnType<typeof createServer>) {
  const wss = new WebSocketServer({ server, path: '/ws/terminal' });

  wss.on('connection', (ws: WebSocket, req) => {
    console.log('WebSocket connection established');
    let sessionId: string | null = null;

    ws.on('message', (message: Buffer) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case 'start':
            // Start a new terminal session
            if (msg.containerId) {
              sessionId = createTerminalSession(
                ws,
                msg.containerId,
                msg.shell || '/bin/bash',
                msg.cols || 80,
                msg.rows || 24,
                msg.isDevNode || false
              );
            } else {
              ws.send(JSON.stringify({ type: 'error', message: 'containerId is required' }));
            }
            break;

          case 'input':
            // Send input to terminal
            if (sessionId && msg.data) {
              writeToSession(sessionId, msg.data);
            }
            break;

          case 'resize':
            // Resize terminal
            if (sessionId && msg.cols && msg.rows) {
              resizeSession(sessionId, msg.cols, msg.rows);
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          default:
            console.warn('Unknown WebSocket message type:', msg.type);
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      closeSessionByWebSocket(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      closeSessionByWebSocket(ws);
    });
  });

  return wss;
}

async function main() {
  // Use SERVER_PORT from env or default to 4001
  const port = parseInt(process.env.SERVER_PORT || '4001', 10);

  // Test Docker connection
  const dockerConnected = await testConnection();
  if (!dockerConnected) {
    console.warn('⚠️  Warning: Could not connect to Docker daemon');
    console.warn('   Make sure Docker is running and accessible');
  } else {
    console.log('✓ Docker connection established');
  }

  // Create HTTP server
  const server = createServer(async (req, res) => {
    // Collect request body for non-GET/HEAD methods
    let body: Buffer | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }

    // Handle Hono requests
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: body ? new Uint8Array(body) : undefined,
    });

    const response = await app.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((value: string, key: string) => {
      res.setHeader(key, value);
    });

    if (response.body) {
      const reader = response.body.getReader();
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        return pump();
      };
      await pump();
    } else {
      res.end();
    }
  });

  // Setup WebSocket server
  setupWebSocketServer(server);

  server.listen(port, () => {
    console.log(`\n🚀 Agent Containers API`);
    console.log(`   Running on http://localhost:${port}`);
    console.log(`   WebSocket: ws://localhost:${port}/ws/terminal`);
    console.log(`   API docs: http://localhost:${port}/api/health\n`);
  });
}

main().catch(console.error);
