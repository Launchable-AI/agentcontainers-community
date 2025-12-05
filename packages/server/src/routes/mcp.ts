import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import * as mcpRegistry from '../services/mcp-registry.js';

const mcp = new Hono();

// Get registry status
mcp.get('/status', async (c) => {
  const status = await mcpRegistry.getRegistryStatus();
  return c.json(status);
});

// Sync registry (can take a while, so we stream progress)
mcp.post('/sync', async (c) => {
  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({ event: 'status', data: 'Starting sync...' });

      const result = await mcpRegistry.syncRegistry();

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify(result),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await stream.writeSSE({
        event: 'error',
        data: message,
      });
    }
  });
});

// List all servers (with optional pagination)
mcp.get('/servers', async (c) => {
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  const allServers = await mcpRegistry.getAllServers();
  const servers = allServers.slice(offset, offset + limit);

  return c.json({
    servers,
    total: allServers.length,
    limit,
    offset,
  });
});

// Search servers
mcp.get('/search', async (c) => {
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '50');

  const servers = await mcpRegistry.searchServers(query, limit);

  return c.json({
    servers,
    query,
    count: servers.length,
  });
});

// Get single server by name
mcp.get('/servers/:name{.+}', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const server = await mcpRegistry.getServerByName(name);

  if (!server) {
    return c.json({ error: 'Server not found' }, 404);
  }

  // Include install command
  const installCommand = mcpRegistry.generateInstallCommand(server);

  return c.json({
    ...server,
    installCommand,
  });
});

// Get install command for a server
mcp.get('/servers/:name{.+}/install', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const server = await mcpRegistry.getServerByName(name);

  if (!server) {
    return c.json({ error: 'Server not found' }, 404);
  }

  const command = mcpRegistry.generateInstallCommand(server);

  return c.json({
    name: server.name,
    command,
  });
});

export default mcp;
