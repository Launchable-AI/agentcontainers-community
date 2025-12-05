import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import * as mcpRegistry from '../services/mcp-registry.js';
import { streamMCPInstallInstructions, isAIConfigured, searchMCPServersWithAI } from '../services/ai.js';

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

// AI-powered semantic search
mcp.post('/ai-search', async (c) => {
  const body = await c.req.json();
  const query = body.query;

  if (!query || typeof query !== 'string') {
    return c.json({ error: 'Query is required' }, 400);
  }

  if (!isAIConfigured()) {
    return c.json({ error: 'AI not configured. Set OPENROUTER_API_KEY in .env.local' }, 503);
  }

  // Get all servers and create summaries for AI
  const allServers = await mcpRegistry.getAllServers();
  const serverSummaries = allServers.map(s => ({
    name: s.name,
    title: s.title,
    description: s.description,
  }));

  const result = await searchMCPServersWithAI(query, serverSummaries);

  if (result.error) {
    return c.json({ error: result.error }, 500);
  }

  // Get full server objects for matching names
  const matchingServers = result.serverNames
    .map(name => allServers.find(s => s.name === name))
    .filter((s): s is mcpRegistry.MCPServer => s !== undefined);

  return c.json({
    servers: matchingServers,
    total: matchingServers.length,
    query,
    aiSearch: true,
  });
});

// ============ Server sub-routes (must come BEFORE the generic /servers/:name route) ============

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

// Stream AI-generated install guide from README
mcp.post('/servers/:name{.+}/install-guide', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));

  if (!isAIConfigured()) {
    return c.json({ error: 'AI not configured. Set OPENROUTER_API_KEY in .env.local' }, 503);
  }

  // First fetch the README
  const readme = await mcpRegistry.fetchReadme(name);
  if (!readme) {
    return c.json({ error: 'README not found - cannot generate install guide' }, 404);
  }

  return streamSSE(c, async (stream) => {
    try {
      await streamMCPInstallInstructions(
        name,
        readme,
        {
          onChunk: async (chunk) => {
            await stream.writeSSE({ event: 'chunk', data: chunk });
          },
          onError: async (error) => {
            await stream.writeSSE({ event: 'error', data: error });
          },
          onDone: async () => {
            await stream.writeSSE({ event: 'done', data: 'complete' });
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await stream.writeSSE({ event: 'error', data: message });
    }
  });
});

// Get single server by name (catch-all, must come AFTER more specific routes)
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

// ============ Favorites ============

// Check if a server is a favorite (must come BEFORE the generic favorites routes)
mcp.get('/favorites/:name{.+}/check', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const isFavorite = await mcpRegistry.isFavorite(name);
  return c.json({ isFavorite });
});

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

export default mcp;
