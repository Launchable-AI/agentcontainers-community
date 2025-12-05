import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateComposeSchema, UpdateComposeSchema } from '../types/index.js';
import * as composeService from '../services/compose.js';

const composes = new Hono();

// List all compose projects
composes.get('/', async (c) => {
  try {
    const projects = await composeService.listComposeProjects();
    return c.json(projects);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get a specific compose project
composes.get('/:name', async (c) => {
  const name = c.req.param('name');

  try {
    const project = await composeService.getComposeProject(name);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    return c.json(project);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get compose file content
composes.get('/:name/content', async (c) => {
  const name = c.req.param('name');

  try {
    const content = await composeService.getComposeContent(name);
    if (content === null) {
      return c.json({ error: 'Project not found' }, 404);
    }
    return c.json({ name, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Create a new compose project
composes.post('/', zValidator('json', CreateComposeSchema), async (c) => {
  const { name, content } = c.req.valid('json');

  try {
    // Check if project already exists
    const existing = await composeService.getComposeProject(name);
    if (existing) {
      return c.json({ error: 'Project already exists' }, 409);
    }

    await composeService.saveComposeFile(name, content);
    const project = await composeService.getComposeProject(name);
    return c.json(project, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Update compose file content
composes.put('/:name', zValidator('json', UpdateComposeSchema), async (c) => {
  const name = c.req.param('name');
  const { content } = c.req.valid('json');

  try {
    const existing = await composeService.getComposeProject(name);
    if (!existing) {
      return c.json({ error: 'Project not found' }, 404);
    }

    await composeService.saveComposeFile(name, content);
    const project = await composeService.getComposeProject(name);
    return c.json(project);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Delete a compose project
composes.delete('/:name', async (c) => {
  const name = c.req.param('name');

  try {
    const existing = await composeService.getComposeProject(name);
    if (!existing) {
      return c.json({ error: 'Project not found' }, 404);
    }

    await composeService.deleteComposeProject(name);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Start compose project (docker compose up) - with streaming logs
composes.post('/:name/up', async (c) => {
  const name = c.req.param('name');

  try {
    const existing = await composeService.getComposeProject(name);
    if (!existing) {
      return c.json({ error: 'Project not found' }, 404);
    }

    // Set up SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendEvent = (event: string, data: string) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          await composeService.composeUp(name, {
            onLog: (log) => sendEvent('log', log),
            onError: (error) => sendEvent('error', error),
            onDone: () => sendEvent('done', 'Compose services started'),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to start';
          sendEvent('error', message);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Stop compose project (docker compose down) - with streaming logs
composes.post('/:name/down', async (c) => {
  const name = c.req.param('name');

  try {
    const existing = await composeService.getComposeProject(name);
    if (!existing) {
      return c.json({ error: 'Project not found' }, 404);
    }

    // Set up SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendEvent = (event: string, data: string) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          await composeService.composeDownWithLogs(name, {
            onLog: (log) => sendEvent('log', log),
            onError: (error) => sendEvent('error', error),
            onDone: () => sendEvent('done', 'Compose services stopped'),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to stop';
          sendEvent('error', message);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get compose logs (streaming)
composes.get('/:name/logs', async (c) => {
  const name = c.req.param('name');
  const tail = parseInt(c.req.query('tail') || '100', 10);

  try {
    const existing = await composeService.getComposeProject(name);
    if (!existing) {
      return c.json({ error: 'Project not found' }, 404);
    }

    // Set up SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const sendEvent = (event: string, data: string) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        const stopLogs = await composeService.getComposeLogs(name, {
          onLog: (log) => sendEvent('log', log),
          onError: (error) => sendEvent('error', error),
          onDone: () => {
            sendEvent('done', 'Log stream ended');
            controller.close();
          },
        }, tail);

        // Handle client disconnect - this is a simplified approach
        // In production, you'd want to listen for the abort signal
        setTimeout(() => {
          stopLogs();
          controller.close();
        }, 300000); // 5 minute timeout for log streaming
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

export default composes;
