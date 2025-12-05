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

// Search servers with pagination
mcp.get('/search', async (c) => {
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const result = await mcpRegistry.searchServers(query, limit, offset);

  return c.json({
    ...result,
    query,
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

// Get README for a server
mcp.get('/servers/:name{.+}/readme', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const readme = await mcpRegistry.fetchReadme(name);

  if (!readme) {
    return c.json({ error: 'README not found' }, 404);
  }

  return c.json({
    name,
    content: readme,
  });
});

// ============ Favorites ============

// Get all favorites
mcp.get('/favorites', async (c) => {
  const favorites = await mcpRegistry.getFavorites();
  const servers = await mcpRegistry.getFavoriteServers();

  return c.json({
    favorites,
    servers,
  });
});

// Add a favorite
mcp.post('/favorites/:name{.+}', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  await mcpRegistry.addFavorite(name);
  return c.json({ success: true });
});

// Remove a favorite
mcp.delete('/favorites/:name{.+}', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  await mcpRegistry.removeFavorite(name);
  return c.json({ success: true });
});

// Check if a server is a favorite
mcp.get('/favorites/:name{.+}/check', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const isFavorite = await mcpRegistry.isFavorite(name);
  return c.json({ isFavorite });
});

export default mcp;
