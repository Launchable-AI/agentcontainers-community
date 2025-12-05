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

const DEFAULT_MCP_INSTALL_PROMPT = `You are an expert at extracting installation instructions from README files for MCP (Model Context Protocol) servers.

Given a README file, extract and format the installation instructions for Claude Code users.

Your response should:
1. Focus specifically on how to install and configure the MCP server for use with Claude Code
2. Include any required environment variables or API keys
3. Show the exact command(s) needed to install
4. Mention any prerequisites (Node.js, Python, etc.)
5. Be concise and actionable

Format your response as clean markdown with:
- A brief one-line description of what the server does
- Prerequisites section (if any)
- Installation command(s) in code blocks
- Configuration steps (environment variables, API keys, etc.)
- A simple usage example if available

If the README doesn't contain clear installation instructions, indicate what information is missing and provide best-effort guidance based on the package type (npm, pypi, etc.).

Keep your response focused and practical - users want to quickly install and start using the MCP server.`;

let mcpInstallPrompt: string | null = null;

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

export function getMCPInstallPrompt(): string {
  return mcpInstallPrompt || DEFAULT_MCP_INSTALL_PROMPT;
}

export function setMCPInstallPrompt(prompt: string | null): void {
  mcpInstallPrompt = prompt;
}

export function getDefaultMCPInstallPrompt(): string {
  return DEFAULT_MCP_INSTALL_PROMPT;
}

const DEFAULT_MCP_SEARCH_PROMPT = `You are an expert at finding MCP (Model Context Protocol) servers from a registry. Given a user's description of what they need, analyze the available MCP servers and return the most relevant matches.

Your task is to:
1. Understand what the user is looking for
2. Match against the available MCP servers based on name, description, and capabilities
3. Return a JSON array of server names that best match the query

Important guidelines:
- Return between 1-10 server names that best match the query
- Prioritize exact matches and highly relevant servers first
- Consider the user's use case and what tools/capabilities they might need
- If no servers clearly match, return an empty array

Return ONLY a JSON array of server names, no explanation. Example: ["server-name-1", "server-name-2"]`;

let mcpSearchPrompt: string | null = null;

export function getMCPSearchPrompt(): string {
  return mcpSearchPrompt || DEFAULT_MCP_SEARCH_PROMPT;
}

export function setMCPSearchPrompt(prompt: string | null): void {
  mcpSearchPrompt = prompt;
}

export interface MCPSearchResult {
  serverNames: string[];
  error?: string;
}

/**
 * Use AI to search MCP servers based on natural language query
 */
export async function searchMCPServersWithAI(
  query: string,
  serverSummaries: Array<{ name: string; title: string; description: string }>
): Promise<MCPSearchResult> {
  const apiKey = getOpenRouterApiKey();

  if (!apiKey) {
    return { serverNames: [], error: 'OpenRouter API key not configured' };
  }

  // Create a condensed list of servers for the prompt
  const serverList = serverSummaries
    .map(s => `- ${s.name}: ${s.title || s.name} - ${s.description || 'No description'}`)
    .join('\n');

  const userMessage = `Available MCP servers:\n${serverList}\n\nUser query: "${query}"\n\nReturn a JSON array of the most relevant server names.`;

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
        messages: [
          { role: 'system', content: getMCPSearchPrompt() },
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
      return { serverNames: [], error: errorMessage };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      return { serverNames: [], error: 'No response from AI' };
    }

    // Parse JSON from response - handle potential markdown wrapping
    let jsonContent = content.trim();
    if (jsonContent.startsWith('```')) {
      const match = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        jsonContent = match[1].trim();
      }
    }

    const serverNames = JSON.parse(jsonContent);
    if (!Array.isArray(serverNames)) {
      return { serverNames: [], error: 'Invalid response format' };
    }

    return { serverNames: serverNames.filter(n => typeof n === 'string') };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { serverNames: [], error: `AI search failed: ${message}` };
  }
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

const COMPONENT_CREATION_PROMPT = `You are a Docker expert. When asked to create a component for a docker-compose library, you will output ONLY a JSON object with the component definition. No markdown, no explanations, just valid JSON.

The JSON must follow this exact schema:
{
  "name": "Human readable name (e.g., PostgreSQL)",
  "description": "Brief description of what this component does",
  "category": "database" | "cache" | "web" | "messaging" | "storage" | "monitoring" | "development" | "other",
  "icon": "Single emoji representing the service",
  "image": "Docker image name without tag (e.g., postgres)",
  "defaultTag": "Recommended version tag (e.g., 16-alpine)",
  "ports": [{ "container": 5432, "host": 5432, "description": "Port description" }],
  "volumes": [{ "name": "volume_name", "path": "/container/path", "description": "Volume description" }],
  "environment": [{ "name": "ENV_VAR", "value": "default_value", "description": "What this var does", "required": true/false }],
  "healthcheck": { "test": "healthcheck command", "interval": "10s", "timeout": "5s", "retries": 5 }
}

Guidelines:
- Use official Docker images when available
- Include sensible default environment variables
- Add volume mounts for persistent data
- Include healthcheck when the image supports it
- Use alpine variants when available for smaller images
- Include typical default ports

Examples of component requests and expected output:
- "add mongodb" → MongoDB component with mongo image, port 27017, data volume
- "add nginx" → Nginx component with nginx image, ports 80/443, config volumes
- "add redis" → Redis component with redis image, port 6379, data volume`;

export async function createComponentFromAI(
  request: string
): Promise<{ component: Record<string, unknown> | null; error?: string }> {
  const apiKey = getOpenRouterApiKey();

  if (!apiKey) {
    return { component: null, error: 'OpenRouter API key not configured' };
  }

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
        messages: [
          { role: 'system', content: COMPONENT_CREATION_PROMPT },
          { role: 'user', content: `Create a component for: ${request}` }
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
      return { component: null, error: errorMessage };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      return { component: null, error: 'No response from AI' };
    }

    // Try to parse JSON from the response
    // Sometimes the AI wraps it in markdown code blocks
    let jsonContent = content.trim();
    if (jsonContent.startsWith('```')) {
      const match = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        jsonContent = match[1].trim();
      }
    }

    const component = JSON.parse(jsonContent);
    return { component };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { component: null, error: `Failed to create component: ${message}` };
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

/**
 * Stream MCP installation instructions extraction from README content
 */
export async function streamMCPInstallInstructions(
  serverName: string,
  readmeContent: string,
  callbacks: AIStreamCallbacks
): Promise<void> {
  const apiKey = getOpenRouterApiKey();

  if (!apiKey) {
    callbacks.onError('OpenRouter API key not configured. Add OPENROUTER_API_KEY to .env.local file.');
    return;
  }

  const userMessage = `Extract installation instructions for the MCP server "${serverName}" from the following README:\n\n${readmeContent}`;

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
          { role: 'system', content: getMCPInstallPrompt() },
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
            // Skip invalid JSON lines for MCP install
          }
        }
      }
    }

    callbacks.onDone();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    callbacks.onError(`Failed to connect to OpenRouter: ${msg}`);
  }
}
