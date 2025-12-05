import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-sonnet-4';

// Load API key from .env.local file
function loadEnvLocal(): void {
  const envPath = join(PROJECT_ROOT, '.env.local');
  if (existsSync(envPath)) {
    try {
      const envContent = readFileSync(envPath, 'utf-8');
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.slice(0, eqIndex).trim();
            let value = trimmed.slice(eqIndex + 1).trim();
            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = value;
            }
          }
        }
      }
    } catch {
      // Ignore errors reading .env.local
    }
  }
}

// Load env on module init
loadEnvLocal();

// Configurable prompts (can be modified at runtime)
let composePrompt: string | null = null;
let dockerfilePrompt: string | null = null;

const DEFAULT_COMPOSE_PROMPT = `You are a Docker Compose expert assistant. Help users modify their docker-compose.yml files.

When asked to make changes:
1. Understand the current compose file structure
2. Make the requested modifications
3. Return the complete updated YAML in a code block using \`\`\`yaml
4. Briefly explain what changed

Important guidelines:
- Always return valid docker-compose YAML
- Preserve existing services unless explicitly asked to remove them
- Use appropriate default values for common services (e.g., postgres default port 5432)
- Include helpful comments in the YAML where appropriate
- If adding a database, include common environment variables

Example response format:
"I'll add PostgreSQL to your compose file:

\`\`\`yaml
version: '3.8'
services:
  # ... existing services ...
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: changeme
    volumes:
      - postgres_data:/var/lib/postgresql/data
volumes:
  postgres_data:
\`\`\`

This adds a PostgreSQL 15 database with persistent storage."`;

const DEFAULT_DOCKERFILE_PROMPT = `You are a Dockerfile expert assistant. Help users modify their Dockerfiles.

When asked to make changes:
1. Understand the current Dockerfile structure
2. Make the requested modifications
3. Return the complete updated Dockerfile in a code block using \`\`\`dockerfile
4. Briefly explain what changed

Important guidelines:
- Always return valid Dockerfile syntax
- Preserve existing instructions unless explicitly asked to remove them
- Use multi-stage builds when appropriate for optimization
- Follow best practices: combine RUN commands, clean up apt caches, use specific versions
- Include helpful comments explaining complex steps
- Consider security: avoid running as root when possible, don't include secrets

Example response format:
"I'll add Node.js installation to your Dockerfile:

\`\`\`dockerfile
FROM ubuntu:24.04

# Install system packages
RUN apt-get update && apt-get install -y \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \\
    && apt-get install -y nodejs \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
\`\`\`

This adds Node.js 20.x using the NodeSource repository."`;

export interface AIStreamCallbacks {
  onChunk: (chunk: string) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

export function getOpenRouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY;
}

export function isAIConfigured(): boolean {
  return !!getOpenRouterApiKey();
}

// Prompt getters and setters
export function getComposePrompt(): string {
  return composePrompt || DEFAULT_COMPOSE_PROMPT;
}

export function setComposePrompt(prompt: string | null): void {
  composePrompt = prompt;
}

export function getDockerfilePrompt(): string {
  return dockerfilePrompt || DEFAULT_DOCKERFILE_PROMPT;
}

export function setDockerfilePrompt(prompt: string | null): void {
  dockerfilePrompt = prompt;
}

export function getDefaultComposePrompt(): string {
  return DEFAULT_COMPOSE_PROMPT;
}

export function getDefaultDockerfilePrompt(): string {
  return DEFAULT_DOCKERFILE_PROMPT;
}

export async function streamComposeAssistant(
  message: string,
  composeContent: string,
  callbacks: AIStreamCallbacks
): Promise<void> {
  const apiKey = getOpenRouterApiKey();

  if (!apiKey) {
    callbacks.onError('OpenRouter API key not configured. Set OPENROUTER_API_KEY environment variable.');
    return;
  }

  const userMessage = composeContent
    ? `Current docker-compose.yml:\n\`\`\`yaml\n${composeContent}\n\`\`\`\n\nRequest: ${message}`
    : message;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://agentcontainers.dev',
        'X-Title': 'Agent Containers',
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [
          { role: 'system', content: getComposePrompt() },
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `OpenRouter API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        // Use default error message
      }
      callbacks.onError(errorMessage);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError('No response stream available');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            callbacks.onDone();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              callbacks.onChunk(content);
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    }

    callbacks.onDone();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    callbacks.onError(`Failed to connect to OpenRouter: ${message}`);
  }
}

export async function streamDockerfileAssistant(
  message: string,
  dockerfileContent: string,
  callbacks: AIStreamCallbacks
): Promise<void> {
  const apiKey = getOpenRouterApiKey();

  if (!apiKey) {
    callbacks.onError('OpenRouter API key not configured. Add OPENROUTER_API_KEY to .env.local file.');
    return;
  }

  const userMessage = dockerfileContent
    ? `Current Dockerfile:\n\`\`\`dockerfile\n${dockerfileContent}\n\`\`\`\n\nRequest: ${message}`
    : message;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://agentcontainers.dev',
        'X-Title': 'Agent Containers',
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [
          { role: 'system', content: getDockerfilePrompt() },
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `OpenRouter API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        // Use default error message
      }
      callbacks.onError(errorMessage);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError('No response stream available');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            callbacks.onDone();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              callbacks.onChunk(content);
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    }

    callbacks.onDone();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    callbacks.onError(`Failed to connect to OpenRouter: ${message}`);
  }
}
