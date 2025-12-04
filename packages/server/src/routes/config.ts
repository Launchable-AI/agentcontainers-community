import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getConfig, setConfig } from '../services/config.js';

const configRoutes = new Hono();

const UpdateConfigSchema = z.object({
  sshKeysDisplayPath: z.string().min(1).optional(),
  dataDirectory: z.string().optional(),
});

const BrowseDirectorySchema = z.object({
  path: z.string().optional(),
});

// Get current config
configRoutes.get('/', async (c) => {
  const config = await getConfig();
  return c.json(config);
});

// Update config
configRoutes.patch('/', zValidator('json', UpdateConfigSchema), async (c) => {
  const updates = c.req.valid('json');
  const newConfig = await setConfig(updates);
  return c.json(newConfig);
});

// Browse directories for folder picker
configRoutes.post('/browse', zValidator('json', BrowseDirectorySchema), async (c) => {
  const { path: requestedPath } = c.req.valid('json');

  // Default to home directory
  let targetPath = requestedPath || homedir();

  // Expand ~ to home directory
  if (targetPath.startsWith('~')) {
    targetPath = join(homedir(), targetPath.slice(1));
  }

  try {
    const stats = await stat(targetPath);
    if (!stats.isDirectory()) {
      return c.json({ error: 'Not a directory' }, 400);
    }

    const entries = await readdir(targetPath, { withFileTypes: true });
    const directories = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        path: join(targetPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Also include hidden directories but mark them
    const hiddenDirs = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('.') && entry.name !== '.' && entry.name !== '..')
      .map(entry => ({
        name: entry.name,
        path: join(targetPath, entry.name),
        hidden: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return c.json({
      currentPath: targetPath,
      parent: targetPath === '/' ? null : join(targetPath, '..'),
      directories: [...directories, ...hiddenDirs],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read directory';
    return c.json({ error: message }, 400);
  }
});

export default configRoutes;
