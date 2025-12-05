import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as componentService from '../services/components.js';

const components = new Hono();

// Schema for creating a component
const CreateComponentSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().min(1).max(500),
  category: z.enum(['database', 'cache', 'web', 'messaging', 'storage', 'monitoring', 'development', 'other']),
  icon: z.string().optional(),
  image: z.string().min(1),
  defaultTag: z.string().min(1),
  ports: z.array(z.object({
    container: z.number().int().positive(),
    host: z.number().int().positive().optional(),
    description: z.string().optional(),
  })),
  volumes: z.array(z.object({
    name: z.string().min(1),
    path: z.string().min(1),
    description: z.string().optional(),
  })),
  environment: z.array(z.object({
    name: z.string().min(1),
    value: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
  })),
  healthcheck: z.object({
    test: z.string().min(1),
    interval: z.string().optional(),
    timeout: z.string().optional(),
    retries: z.number().int().positive().optional(),
  }).optional(),
  dependsOn: z.array(z.string()).optional(),
  networks: z.array(z.string()).optional(),
});

// List all components
components.get('/', async (c) => {
  try {
    const allComponents = await componentService.getAllComponents();
    return c.json(allComponents);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get component by ID
components.get('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const component = await componentService.getComponentById(id);
    if (!component) {
      return c.json({ error: 'Component not found' }, 404);
    }
    return c.json(component);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Get components by category
components.get('/category/:category', async (c) => {
  const category = c.req.param('category') as componentService.Component['category'];

  try {
    const categoryComponents = await componentService.getComponentsByCategory(category);
    return c.json(categoryComponents);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// Create a new component
components.post('/', zValidator('json', CreateComponentSchema), async (c) => {
  const data = c.req.valid('json');

  try {
    const newComponent = await componentService.addComponent(data);
    return c.json(newComponent, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('already exists')) {
      return c.json({ error: message }, 409);
    }
    return c.json({ error: message }, 500);
  }
});

// Update a component
components.put('/:id', zValidator('json', CreateComponentSchema.partial()), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');

  try {
    const updated = await componentService.updateComponent(id, data);
    return c.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('not found')) {
      return c.json({ error: message }, 404);
    }
    if (message.includes('built-in')) {
      return c.json({ error: message }, 403);
    }
    return c.json({ error: message }, 500);
  }
});

// Delete a component
components.delete('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    await componentService.deleteComponent(id);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('not found')) {
      return c.json({ error: message }, 404);
    }
    if (message.includes('built-in')) {
      return c.json({ error: message }, 403);
    }
    return c.json({ error: message }, 500);
  }
});

// Generate compose YAML for a component
components.get('/:id/yaml', async (c) => {
  const id = c.req.param('id');
  const serviceName = c.req.query('name');

  try {
    const component = await componentService.getComponentById(id);
    if (!component) {
      return c.json({ error: 'Component not found' }, 404);
    }

    const yaml = componentService.generateComposeYaml(component, serviceName);
    return c.json({ yaml });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

export default components;
