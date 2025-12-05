import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  streamComposeAssistant,
  streamDockerfileAssistant,
  createComponentFromAI,
  isAIConfigured,
  getComposePrompt,
  setComposePrompt,
  getDockerfilePrompt,
  setDockerfilePrompt,
  getDefaultComposePrompt,
  getDefaultDockerfilePrompt,
  getMCPInstallPrompt,
  setMCPInstallPrompt,
  getDefaultMCPInstallPrompt,
  getMCPSearchPrompt,
  setMCPSearchPrompt,
  getDefaultMCPSearchPrompt,
  getModel,
  setModel,
  getDefaultModel,
  getAvailableModels,
} from '../services/ai.js';
import { addComponent } from '../services/components.js';

const ai = new Hono();

const ComposeChatSchema = z.object({
  message: z.string().min(1),
  composeContent: z.string().optional(),
});

const DockerfileChatSchema = z.object({
  message: z.string().min(1),
  dockerfileContent: z.string().optional(),
});

const UpdatePromptSchema = z.object({
  prompt: z.string().nullable(),
});

const CreateComponentSchema = z.object({
  request: z.string().min(1).max(500),
});

// Check if AI is configured
ai.get('/status', async (c) => {
  return c.json({
    configured: isAIConfigured(),
  });
});

// Get all prompts and model settings
ai.get('/prompts', async (c) => {
  return c.json({
    compose: {
      current: getComposePrompt(),
      default: getDefaultComposePrompt(),
      isCustom: getComposePrompt() !== getDefaultComposePrompt(),
    },
    dockerfile: {
      current: getDockerfilePrompt(),
      default: getDefaultDockerfilePrompt(),
      isCustom: getDockerfilePrompt() !== getDefaultDockerfilePrompt(),
    },
    mcpInstall: {
      current: getMCPInstallPrompt(),
      default: getDefaultMCPInstallPrompt(),
      isCustom: getMCPInstallPrompt() !== getDefaultMCPInstallPrompt(),
    },
    mcpSearch: {
      current: getMCPSearchPrompt(),
      default: getDefaultMCPSearchPrompt(),
      isCustom: getMCPSearchPrompt() !== getDefaultMCPSearchPrompt(),
    },
    model: {
      current: getModel(),
      default: getDefaultModel(),
      available: getAvailableModels(),
    },
  });
});

// Update compose prompt
ai.put('/prompts/compose', zValidator('json', UpdatePromptSchema), async (c) => {
  const { prompt } = c.req.valid('json');
  setComposePrompt(prompt);
  return c.json({ success: true, prompt: getComposePrompt() });
});

// Update dockerfile prompt
ai.put('/prompts/dockerfile', zValidator('json', UpdatePromptSchema), async (c) => {
  const { prompt } = c.req.valid('json');
  setDockerfilePrompt(prompt);
  return c.json({ success: true, prompt: getDockerfilePrompt() });
});

// Update MCP install prompt
ai.put('/prompts/mcp-install', zValidator('json', UpdatePromptSchema), async (c) => {
  const { prompt } = c.req.valid('json');
  setMCPInstallPrompt(prompt);
  return c.json({ success: true, prompt: getMCPInstallPrompt() });
});

// Update MCP search prompt
ai.put('/prompts/mcp-search', zValidator('json', UpdatePromptSchema), async (c) => {
  const { prompt } = c.req.valid('json');
  setMCPSearchPrompt(prompt);
  return c.json({ success: true, prompt: getMCPSearchPrompt() });
});

// Update model
const UpdateModelSchema = z.object({
  model: z.string().nullable(),
});

ai.put('/model', zValidator('json', UpdateModelSchema), async (c) => {
  const { model } = c.req.valid('json');
  setModel(model);
  return c.json({ success: true, model: getModel() });
});

// Stream compose assistant chat
ai.post('/compose-chat', zValidator('json', ComposeChatSchema), async (c) => {
  const { message, composeContent } = c.req.valid('json');

  if (!isAIConfigured()) {
    return c.json({ error: 'OpenRouter API key not configured' }, 503);
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
        await streamComposeAssistant(message, composeContent || '', {
          onChunk: (chunk) => sendEvent('chunk', chunk),
          onError: (error) => sendEvent('error', error),
          onDone: () => sendEvent('done', 'complete'),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        sendEvent('error', errorMessage);
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
});

// Stream dockerfile assistant chat
ai.post('/dockerfile-chat', zValidator('json', DockerfileChatSchema), async (c) => {
  const { message, dockerfileContent } = c.req.valid('json');

  if (!isAIConfigured()) {
    return c.json({ error: 'OpenRouter API key not configured' }, 503);
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
        await streamDockerfileAssistant(message, dockerfileContent || '', {
          onChunk: (chunk) => sendEvent('chunk', chunk),
          onError: (error) => sendEvent('error', error),
          onDone: () => sendEvent('done', 'complete'),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        sendEvent('error', errorMessage);
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
});

// Create a component from natural language using AI
ai.post('/create-component', zValidator('json', CreateComponentSchema), async (c) => {
  const { request } = c.req.valid('json');

  if (!isAIConfigured()) {
    return c.json({ error: 'OpenRouter API key not configured' }, 503);
  }

  const result = await createComponentFromAI(request);

  if (result.error || !result.component) {
    return c.json({ error: result.error || 'Failed to create component' }, 500);
  }

  try {
    // Validate and add the component to the library
    const component = await addComponent(result.component as Parameters<typeof addComponent>[0]);
    return c.json({ success: true, component });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save component';
    return c.json({ error: message }, 500);
  }
});

export default ai;
