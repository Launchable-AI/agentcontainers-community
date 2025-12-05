import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import {
  Save,
  Trash2,
  Plus,
  Layers,
  Loader2,
  Play,
  Square,
  X,
  Minimize2,
  Maximize2,
  Upload,
  FileCode,
  Circle,
  Image,
  Copy,
  Check,
  Sparkles,
  Code,
  Network,
  Send,
  ChevronRight,
} from 'lucide-react';
import { useComposeProjects, useCreateCompose, useUpdateCompose, useDeleteCompose, useImages } from '../hooks/useContainers';
import * as api from '../api/client';
import type { ComposeProject } from '../api/client';
import { ComposeCanvas } from './ComposeCanvas';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const DEFAULT_COMPOSE = `version: '3.8'

services:
  app:
    image: ubuntu:24.04
    command: sleep infinity
    # ports:
    #   - "3000:3000"
    # volumes:
    #   - ./data:/app/data
`;

export function ComposeManager() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [content, setContent] = useState(DEFAULT_COMPOSE);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [actionLogs, setActionLogs] = useState<string[]>([]);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [isLogsMinimized, setIsLogsMinimized] = useState(false);
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [currentAction, setCurrentAction] = useState<'up' | 'down' | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // View mode: editor or canvas
  const [viewMode, setViewMode] = useState<'editor' | 'canvas'>('editor');

  // AI Panel state
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [copiedCode, setCopiedCode] = useState<number | null>(null);

  const { data: projects, refetch } = useComposeProjects();
  const { data: images } = useImages();
  const createMutation = useCreateCompose();
  const updateMutation = useUpdateCompose();
  const deleteMutation = useDeleteCompose();
  const [copiedImage, setCopiedImage] = useState<string | null>(null);

  const selectedProjectData = projects?.find(p => p.name === selectedProject);

  // Filter to show only custom-built images (acm-* tags)
  const customImages = images?.filter(img =>
    img.repoTags?.some(tag => tag.startsWith('acm-'))
  ) || [];

  // Load content when project is selected
  useEffect(() => {
    if (selectedProject) {
      api.getComposeContent(selectedProject).then((result) => {
        setContent(result.content);
      }).catch(() => {
        setContent('# Failed to load compose file');
      });
    } else {
      setContent(DEFAULT_COMPOSE);
    }
  }, [selectedProject]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [actionLogs]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Check AI status on mount
  useEffect(() => {
    api.getAIStatus().then((status) => {
      setAiConfigured(status.configured);
    }).catch(() => {
      setAiConfigured(false);
    });
  }, []);

  // Extract YAML code block from AI response
  const extractYamlFromResponse = (response: string): string | null => {
    const yamlMatch = response.match(/```(?:yaml|yml)?\n([\s\S]*?)```/);
    return yamlMatch ? yamlMatch[1].trim() : null;
  };

  // Handle sending chat message
  const handleSendChat = async () => {
    if (!chatInput.trim() || isStreaming) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsStreaming(true);

    // Add empty assistant message that will be streamed into
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      await api.streamComposeChat(
        userMessage,
        content,
        (chunk) => {
          setChatMessages((prev) => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg.role === 'assistant') {
              lastMsg.content += chunk;
            }
            return newMessages;
          });
        },
        () => {
          setIsStreaming(false);
        },
        (error) => {
          setChatMessages((prev) => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg.role === 'assistant') {
              lastMsg.content = `Error: ${error}`;
            }
            return newMessages;
          });
          setIsStreaming(false);
        }
      );
    } catch {
      setIsStreaming(false);
    }
  };

  // Apply YAML from AI response to editor
  const handleApplyYaml = (yaml: string) => {
    setContent(yaml);
    setViewMode('editor');
  };

  // Copy code to clipboard
  const handleCopyCode = async (code: string, index: number) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(index);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Render message content with syntax-highlighted code blocks
  const renderMessageContent = (content: string) => {
    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
      }
      // Add code block
      parts.push({ type: 'code', content: match[2], language: match[1] || 'plaintext' });
      lastIndex = match.index + match[0].length;
    }
    // Add remaining text
    if (lastIndex < content.length) {
      parts.push({ type: 'text', content: content.slice(lastIndex) });
    }

    return parts.map((part, idx) => {
      if (part.type === 'code') {
        return (
          <div key={idx} className="my-3 rounded-lg overflow-hidden border border-gray-700">
            <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 text-xs text-gray-400">
              <span>{part.language}</span>
            </div>
            <pre className="p-3 bg-gray-900 overflow-x-auto text-xs leading-relaxed">
              <code className="text-gray-100 font-mono">{part.content}</code>
            </pre>
          </div>
        );
      }
      return (
        <span key={idx} className="whitespace-pre-wrap">{part.content}</span>
      );
    });
  };

  const handleSave = async () => {
    if (!selectedProject) return;
    setIsSaving(true);
    try {
      await updateMutation.mutateAsync({ name: selectedProject, content });
      refetch();
    } catch (error) {
      console.error('Failed to save:', error);
    }
    setIsSaving(false);
  };

  const handleCreate = async () => {
    if (!newProjectName) return;
    setIsSaving(true);
    try {
      await createMutation.mutateAsync({ name: newProjectName, content: DEFAULT_COMPOSE });
      setSelectedProject(newProjectName);
      setContent(DEFAULT_COMPOSE);
      setNewProjectName('');
      setIsCreating(false);
      refetch();
    } catch (error) {
      console.error('Failed to create:', error);
    }
    setIsSaving(false);
  };

  const handleDelete = async () => {
    if (!selectedProject) return;
    if (!confirm(`Delete project "${selectedProject}"? This will also stop any running services.`)) return;

    try {
      await deleteMutation.mutateAsync(selectedProject);
      setSelectedProject(null);
      setContent(DEFAULT_COMPOSE);
      refetch();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const fileContent = await file.text();
      const name = file.name.replace(/\.(yml|yaml)$/, '');

      await createMutation.mutateAsync({ name, content: fileContent });
      setSelectedProject(name);
      setContent(fileContent);
      refetch();
    } catch (error) {
      console.error('Failed to upload:', error);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleComposeUp = async () => {
    if (!selectedProject) return;

    // Save first to ensure latest content is used
    await handleSave();

    setIsRunning(true);
    setActionLogs([]);
    setActionResult(null);
    setCurrentAction('up');
    setShowLogsModal(true);
    setIsLogsMinimized(false);

    try {
      await api.composeUp(
        selectedProject,
        (log) => {
          setActionLogs((prev) => [...prev, log]);
        },
        () => {
          setActionResult({ type: 'success', message: 'Services started successfully' });
          setIsRunning(false);
          refetch();
        },
        (error) => {
          setActionResult({ type: 'error', message: error });
          setIsRunning(false);
        }
      );
    } catch {
      setIsRunning(false);
    }
  };

  const handleComposeDown = async () => {
    if (!selectedProject) return;

    setIsRunning(true);
    setActionLogs([]);
    setActionResult(null);
    setCurrentAction('down');
    setShowLogsModal(true);
    setIsLogsMinimized(false);

    try {
      await api.composeDown(
        selectedProject,
        (log) => {
          setActionLogs((prev) => [...prev, log]);
        },
        () => {
          setActionResult({ type: 'success', message: 'Services stopped successfully' });
          setIsRunning(false);
          refetch();
        },
        (error) => {
          setActionResult({ type: 'error', message: error });
          setIsRunning(false);
        }
      );
    } catch {
      setIsRunning(false);
    }
  };

  const getStatusColor = (status: ComposeProject['status']) => {
    switch (status) {
      case 'running':
        return 'text-green-500';
      case 'partial':
        return 'text-yellow-500';
      case 'stopped':
      default:
        return 'text-gray-400';
    }
  };

  const getStatusBg = (status: ComposeProject['status']) => {
    switch (status) {
      case 'running':
        return 'bg-green-500/20';
      case 'partial':
        return 'bg-yellow-500/20';
      case 'stopped':
      default:
        return 'bg-gray-500/20';
    }
  };

  const handleCopyImage = async (tag: string) => {
    await navigator.clipboard.writeText(tag);
    setCopiedImage(tag);
    setTimeout(() => setCopiedImage(null), 2000);
  };

  const handleInsertImage = (tag: string) => {
    // Insert image: line at cursor or append to content
    const imageLineRegex = /^(\s*)image:\s*.*/m;
    if (imageLineRegex.test(content)) {
      // Replace existing image line
      setContent(content.replace(imageLineRegex, `$1image: ${tag}`));
    } else {
      // Try to find a service block and add image after it
      const serviceRegex = /^(\s+\w+:)\s*$/m;
      const match = content.match(serviceRegex);
      if (match) {
        const indent = match[1].match(/^\s*/)?.[0] || '  ';
        setContent(content.replace(serviceRegex, `$1\n${indent}  image: ${tag}`));
      } else {
        // Just copy to clipboard as fallback
        handleCopyImage(tag);
      }
    }
  };

  return (
    <div className="rounded-lg border bg-white dark:bg-gray-800">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".yml,.yaml"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3 dark:border-gray-700">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <Layers className="h-5 w-5" />
          Docker Compose
        </h3>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          {selectedProject && (
            <div className="flex rounded-md border border-gray-300 dark:border-gray-600 mr-2">
              <button
                onClick={() => setViewMode('editor')}
                className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium transition-colors rounded-l-md ${
                  viewMode === 'editor'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                <Code className="h-4 w-4" />
                Editor
              </button>
              <button
                onClick={() => setViewMode('canvas')}
                className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium transition-colors rounded-r-md ${
                  viewMode === 'canvas'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                <Network className="h-4 w-4" />
                Canvas
              </button>
            </div>
          )}

          {/* AI Toggle Button */}
          {selectedProject && (
            <button
              onClick={() => aiConfigured && setIsAIPanelOpen(!isAIPanelOpen)}
              disabled={!aiConfigured}
              title={!aiConfigured ? 'Set OPENROUTER_API_KEY on server to enable AI' : 'AI Assistant'}
              className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors mr-2 ${
                !aiConfigured
                  ? 'border border-gray-300 text-gray-400 cursor-not-allowed dark:border-gray-600 dark:text-gray-500'
                  : isAIPanelOpen
                  ? 'bg-purple-600 text-white'
                  : 'border border-purple-300 text-purple-600 hover:bg-purple-50 dark:border-purple-600 dark:text-purple-400 dark:hover:bg-purple-900/20'
              }`}
            >
              <Sparkles className="h-4 w-4" />
              AI
            </button>
          )}
          {selectedProject && (
            <>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
              {selectedProjectData?.status === 'running' || selectedProjectData?.status === 'partial' ? (
                <button
                  onClick={handleComposeDown}
                  disabled={isRunning}
                  className="flex items-center gap-1 rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {isRunning && currentAction === 'down' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleComposeUp}
                  disabled={isRunning}
                  className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isRunning && currentAction === 'up' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Start
                </button>
              )}
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Project Cards */}
      <div className="flex flex-wrap gap-2 p-4 border-b dark:border-gray-700">
        {projects?.map((project) => (
          <button
            key={project.name}
            onClick={() => setSelectedProject(project.name)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              selectedProject === project.name
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            <Circle className={`h-2 w-2 fill-current ${selectedProject === project.name ? 'text-white' : getStatusColor(project.status)}`} />
            <FileCode className="h-4 w-4" />
            {project.name}
          </button>
        ))}

        {/* New Project Button/Input */}
        {isCreating ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              placeholder="project-name"
              pattern="^[a-zA-Z0-9][a-zA-Z0-9_.-]*$"
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={!newProjectName || isSaving}
              className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setNewProjectName('');
              }}
              className="rounded-lg px-2 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 hover:border-blue-500 hover:text-blue-500 dark:border-gray-600 dark:text-gray-400"
            >
              <Plus className="h-4 w-4" />
              New
            </button>
            <button
              onClick={handleUpload}
              className="flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 hover:border-blue-500 hover:text-blue-500 dark:border-gray-600 dark:text-gray-400"
            >
              <Upload className="h-4 w-4" />
              Upload
            </button>
          </div>
        )}
      </div>

      {/* Services Status */}
      {selectedProject && selectedProjectData && selectedProjectData.services.length > 0 && (
        <div className="px-4 py-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Services</div>
          <div className="flex flex-wrap gap-2">
            {selectedProjectData.services.map((service) => (
              <div
                key={service.name}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${getStatusBg(service.state === 'running' ? 'running' : 'stopped')}`}
              >
                <Circle className={`h-2 w-2 fill-current ${service.state === 'running' ? 'text-green-500' : 'text-gray-400'}`} />
                <span className="font-medium text-gray-700 dark:text-gray-300">{service.name}</span>
                <span className="text-gray-500 dark:text-gray-400 text-xs">{service.image}</span>
                {service.ports.length > 0 && (
                  <span className="text-gray-400 text-xs">
                    {service.ports.map(p => p.host ? `:${p.host}` : `:${p.container}`).join(', ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Image Picker */}
      {selectedProject && customImages.length > 0 && (
        <div className="px-4 py-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            <Image className="h-3.5 w-3.5" />
            Available Images
          </div>
          <div className="flex flex-wrap gap-2">
            {customImages.map((img) => {
              const tag = img.repoTags?.find(t => t.startsWith('acm-')) || img.repoTags?.[0];
              if (!tag) return null;
              const isCopied = copiedImage === tag;
              return (
                <div
                  key={img.id}
                  className="flex items-center gap-1 rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                >
                  <button
                    onClick={() => handleInsertImage(tag)}
                    className="px-3 py-1.5 text-sm font-medium hover:bg-purple-200 dark:hover:bg-purple-900/50 rounded-l-md transition-colors"
                    title="Click to replace image in YAML"
                  >
                    {tag}
                  </button>
                  <button
                    onClick={() => handleCopyImage(tag)}
                    className="px-2 py-1.5 hover:bg-purple-200 dark:hover:bg-purple-900/50 rounded-r-md border-l border-purple-200 dark:border-purple-700 transition-colors"
                    title="Copy to clipboard"
                  >
                    {isCopied ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content Area with Editor/Canvas and AI Panel */}
      <div className="flex h-[calc(100vh-520px)] min-h-[300px] overflow-hidden">
        {/* Editor/Canvas */}
        <div className={`relative ${isAIPanelOpen ? 'flex-1 min-w-0' : 'flex-1'}`}>
          {selectedProject ? (
            viewMode === 'editor' ? (
              <Editor
                height="100%"
                defaultLanguage="yaml"
                value={content}
                onChange={(value) => setContent(value || '')}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                }}
              />
            ) : (
              <ComposeCanvas
                composeContent={content}
                services={selectedProjectData?.services || []}
              />
            )
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a project or create a new one</p>
              </div>
            </div>
          )}
        </div>

        {/* AI Side Panel */}
        {isAIPanelOpen && selectedProject && (
          <div className="w-96 border-l dark:border-gray-700 flex flex-col bg-white dark:bg-gray-800">
            {/* AI Panel Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
              <div className="flex items-center gap-2 text-gray-900 dark:text-white font-semibold">
                <Sparkles className="h-5 w-5 text-purple-500" />
                AI Assistant
              </div>
              <button
                onClick={() => setIsAIPanelOpen(false)}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.length === 0 && (
                <div className="text-center text-gray-400 py-8">
                  <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">Ask me to modify your compose file</p>
                  <p className="text-xs mt-1">e.g., "Add PostgreSQL" or "Add Redis cache"</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 ${
                    msg.role === 'user'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100 ml-4'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 mr-4'
                  }`}
                >
                  <div className="text-sm">
                    {msg.role === 'assistant' && !(isStreaming && i === chatMessages.length - 1)
                      ? renderMessageContent(msg.content)
                      : <span className="whitespace-pre-wrap">{msg.content}</span>}
                  </div>
                  {msg.role === 'assistant' && !isStreaming && msg.content && (() => {
                    const yaml = extractYamlFromResponse(msg.content);
                    if (yaml) {
                      return (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => handleCopyCode(yaml, i)}
                            className="flex-1 flex items-center justify-center gap-2 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            {copiedCode === i ? (
                              <>
                                <Check className="h-4 w-4 text-green-500" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4" />
                                Copy
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleApplyYaml(yaml)}
                            className="flex-1 flex items-center justify-center gap-2 rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700"
                          >
                            <Check className="h-4 w-4" />
                            Apply
                          </button>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              ))}
              {isStreaming && (
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-4 border-t dark:border-gray-700">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  placeholder="Ask AI to modify compose..."
                  disabled={isStreaming}
                  className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm dark:bg-gray-700 dark:text-white placeholder-gray-400 disabled:opacity-50"
                />
                <button
                  onClick={handleSendChat}
                  disabled={isStreaming || !chatInput.trim()}
                  className="rounded-md bg-purple-600 px-3 py-2 text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {isStreaming ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Log Modal - Minimized */}
      {showLogsModal && isLogsMinimized && (
        <div className="fixed bottom-4 right-4 z-50">
          <button
            onClick={() => setIsLogsMinimized(false)}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg transition-colors ${
              actionResult?.type === 'error'
                ? 'bg-red-900 text-red-100 hover:bg-red-800'
                : actionResult?.type === 'success'
                ? 'bg-green-900 text-green-100 hover:bg-green-800'
                : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            {currentAction === 'up' ? <Play className="h-5 w-5" /> : <Square className="h-5 w-5" />}
            <span className="font-medium">
              {isRunning
                ? currentAction === 'up'
                  ? 'Starting...'
                  : 'Stopping...'
                : actionResult?.type === 'success'
                ? currentAction === 'up'
                  ? 'Started'
                  : 'Stopped'
                : 'Failed'}
            </span>
            {isRunning && <Loader2 className="h-4 w-4 animate-spin" />}
            <Maximize2 className="h-4 w-4 ml-2 opacity-60" />
          </button>
        </div>
      )}

      {/* Action Log Modal - Expanded */}
      {showLogsModal && !isLogsMinimized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-3xl mx-4 rounded-lg bg-gray-900 shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
              <h3 className="font-semibold text-white flex items-center gap-2">
                {currentAction === 'up' ? <Play className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                {currentAction === 'up' ? 'Starting Services' : 'Stopping Services'}
                {isRunning && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsLogsMinimized(true)}
                  className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
                  title="Minimize"
                >
                  <Minimize2 className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setShowLogsModal(false)}
                  disabled={isRunning}
                  className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-50"
                  title={isRunning ? 'Cannot close while running' : 'Close'}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 font-mono text-sm">
              <pre className="text-gray-300 whitespace-pre-wrap">
                {actionLogs.map((log, i) => (
                  <span key={i}>{log}</span>
                ))}
              </pre>
              <div ref={logsEndRef} />
            </div>

            {actionResult && (
              <div
                className={`px-4 py-3 border-t border-gray-700 ${
                  actionResult.type === 'success'
                    ? 'bg-green-900/30 text-green-400'
                    : 'bg-red-900/30 text-red-400'
                }`}
              >
                {actionResult.message}
              </div>
            )}

            {!isRunning && (
              <div className="px-4 py-3 border-t border-gray-700 flex justify-end">
                <button
                  onClick={() => setShowLogsModal(false)}
                  className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
