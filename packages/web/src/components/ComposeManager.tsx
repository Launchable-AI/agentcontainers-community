import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import {
  Save,
  Trash2,
  Plus,
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
  PanelRightClose,
  PanelRightOpen,
  TerminalSquare,
  Terminal as TerminalIcon,
  Download,
  Boxes,
  ChevronDown,
  ChevronRight,
  Pencil,
  Database,
  Globe,
  HardDrive,
  MessageSquare,
  Activity,
  Wrench,
  Container,
  RotateCcw,
} from 'lucide-react';
import { useComposeProjects, useCreateCompose, useUpdateCompose, useDeleteCompose, useImages, useConfig, useRenameCompose } from '../hooks/useContainers';
import * as api from '../api/client';
import type { ComposeProject, ComposeService } from '../api/client';
import { ComposeCanvas } from './ComposeCanvas';
import { Terminal } from './Terminal';
import { useConfirm } from './ConfirmModal';
import { downloadSshKey } from '../api/client';
import { AppComposer } from './AppComposer';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Get an icon component based on service image name
function getServiceIcon(image: string): React.ComponentType<{ className?: string }> {
  const imageLower = image.toLowerCase();

  // Databases
  if (imageLower.includes('postgres') || imageLower.includes('mysql') || imageLower.includes('mariadb') ||
      imageLower.includes('mongo') || imageLower.includes('sqlite') || imageLower.includes('cockroach')) {
    return Database;
  }

  // Cache
  if (imageLower.includes('redis') || imageLower.includes('memcache') || imageLower.includes('valkey')) {
    return HardDrive;
  }

  // Web servers
  if (imageLower.includes('nginx') || imageLower.includes('apache') || imageLower.includes('caddy') ||
      imageLower.includes('traefik') || imageLower.includes('haproxy')) {
    return Globe;
  }

  // Message queues
  if (imageLower.includes('rabbit') || imageLower.includes('kafka') || imageLower.includes('nats') ||
      imageLower.includes('activemq') || imageLower.includes('zeromq')) {
    return MessageSquare;
  }

  // Storage
  if (imageLower.includes('minio') || imageLower.includes('s3') || imageLower.includes('storage')) {
    return HardDrive;
  }

  // Monitoring
  if (imageLower.includes('prometheus') || imageLower.includes('grafana') || imageLower.includes('elastic') ||
      imageLower.includes('kibana') || imageLower.includes('jaeger') || imageLower.includes('loki')) {
    return Activity;
  }

  // Development containers
  if (imageLower.includes('acm-') || imageLower.includes('dev') || imageLower.includes('node') ||
      imageLower.includes('python') || imageLower.includes('ubuntu') || imageLower.includes('debian')) {
    return Wrench;
  }

  // Generic container
  return Container;
}

// Generate default compose template with the configured dev-node image
function getDefaultCompose(devNodeImage: string = 'ubuntu:24.04'): string {
  return `version: '3.8'

services:
  dev-node:
    image: ${devNodeImage}
    command: sleep infinity
    volumes:
      - workspace:/home/dev/workspace
    # ports:
    #   - "3000:3000"

volumes:
  workspace:
`;
}

export function ComposeManager() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [content, setContent] = useState('');
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
  const { data: config } = useConfig();
  const createMutation = useCreateCompose();
  const updateMutation = useUpdateCompose();
  const deleteMutation = useDeleteCompose();
  const renameMutation = useRenameCompose();
  const [copiedImage, setCopiedImage] = useState<string | null>(null);
  const confirm = useConfirm();

  // Projects panel state
  const [isProjectsPanelCollapsed, setIsProjectsPanelCollapsed] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState<string | null>(null);
  const [newNameValue, setNewNameValue] = useState('');

  // Terminal state
  const [activeTerminal, setActiveTerminal] = useState<{ containerId: string; serviceName: string; isDevNode: boolean } | null>(null);
  const [copiedSshCommand, setCopiedSshCommand] = useState<string | null>(null);

  // App Composer state
  const [showAppComposer, setShowAppComposer] = useState(false);

  // Get SSH keys path from config
  const sshKeysPath = config?.sshKeysDisplayPath || '~/.ssh';

  // Get default dev-node image from config
  const defaultDevNodeImage = config?.defaultDevNodeImage || 'ubuntu:24.04';
  const defaultCompose = getDefaultCompose(defaultDevNodeImage);

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
      setContent(defaultCompose);
    }
  }, [selectedProject, defaultCompose]);

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
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { ...lastMsg, content: lastMsg.content + chunk }
              ];
            }
            return prev;
          });
        },
        () => {
          setIsStreaming(false);
        },
        (error) => {
          setChatMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { ...lastMsg, content: `Error: ${error}` }
              ];
            }
            return prev;
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
  const renderMessageContent = (msgContent: string) => {
    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(msgContent)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: msgContent.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', content: match[2], language: match[1] || 'plaintext' });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < msgContent.length) {
      parts.push({ type: 'text', content: msgContent.slice(lastIndex) });
    }

    return parts.map((part, idx) => {
      if (part.type === 'code') {
        return (
          <div key={idx} className="my-2 overflow-hidden border border-[hsl(var(--border-highlight))]">
            <div className="flex items-center justify-between px-2.5 py-1 bg-[hsl(var(--bg-base))] text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
              <span>{part.language}</span>
            </div>
            <pre className="p-2.5 bg-[hsl(var(--bg-surface))] overflow-x-auto text-xs leading-relaxed">
              <code className="text-[hsl(var(--text-primary))]">{part.content}</code>
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
      await createMutation.mutateAsync({ name: newProjectName, content: defaultCompose });
      setSelectedProject(newProjectName);
      setContent(defaultCompose);
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
    const confirmed = await confirm({
      title: 'Delete Project',
      message: `Are you sure you want to delete "${selectedProject}"? This will stop any running services and cannot be undone.`,
      confirmText: 'Delete Project',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await deleteMutation.mutateAsync(selectedProject);
      setSelectedProject(null);
      setContent(defaultCompose);
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

  const getStatusClass = (status: ComposeProject['status']) => {
    switch (status) {
      case 'running':
        return 'status-running';
      case 'partial':
        return 'status-partial';
      case 'stopped':
      default:
        return 'status-stopped';
    }
  };

  const handleCopyImage = async (tag: string) => {
    await navigator.clipboard.writeText(tag);
    setCopiedImage(tag);
    setTimeout(() => setCopiedImage(null), 2000);
  };

  const handleInsertImage = (tag: string) => {
    const imageLineRegex = /^(\s*)image:\s*.*/m;
    if (imageLineRegex.test(content)) {
      setContent(content.replace(imageLineRegex, `$1image: ${tag}`));
    } else {
      const serviceRegex = /^(\s+\w+:)\s*$/m;
      const match = content.match(serviceRegex);
      if (match) {
        const indent = match[1].match(/^\s*/)?.[0] || '  ';
        setContent(content.replace(serviceRegex, `$1\n${indent}  image: ${tag}`));
      } else {
        handleCopyImage(tag);
      }
    }
  };

  // SSH helpers
  const getSshCommand = (service: ComposeService): string | null => {
    if (!service.sshPort) return null;
    return `ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i ${sshKeysPath}/acm.pem -p ${service.sshPort} dev@localhost`;
  };

  const handleCopySshCommand = async (command: string) => {
    await navigator.clipboard.writeText(command);
    setCopiedSshCommand(command);
    setTimeout(() => setCopiedSshCommand(null), 2000);
  };

  const handleDownloadSshKey = async (service: ComposeService) => {
    try {
      const blob = await downloadSshKey(service.containerId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'acm.pem';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download SSH key:', error);
    }
  };

  // Check if service is a dev-node (main development container)
  const isDevNode = (serviceName: string): boolean => {
    return serviceName === 'dev-node' || serviceName === 'dev' || serviceName === 'development';
  };

  // Find services with SSH access - prioritize dev-node, otherwise first SSH-enabled service
  const sshServices = selectedProjectData?.services.filter(s => s.sshPort && s.state === 'running') || [];
  const primarySshService = sshServices.find(s => isDevNode(s.name)) || sshServices[0];

  // Handle applying compose YAML from App Composer
  const handleApplyCompose = (yaml: string) => {
    setContent(yaml);
    setViewMode('editor');
  };

  // Handle renaming a project
  const handleRename = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) {
      setEditingProjectName(null);
      return;
    }
    try {
      await renameMutation.mutateAsync({ name: oldName, newName: newName.trim() });
      if (selectedProject === oldName) {
        setSelectedProject(newName.trim());
      }
      setEditingProjectName(null);
      refetch();
    } catch (error) {
      console.error('Failed to rename:', error);
    }
  };

  const startEditing = (name: string) => {
    setEditingProjectName(name);
    setNewNameValue(name);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".yml,.yaml"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Projects Panel - Collapsible Cards */}
      <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        {/* Panel Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            {/* New/Upload buttons - on the left */}
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
                  className="w-32 px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                  autoFocus
                />
                <button
                  onClick={handleCreate}
                  disabled={!newProjectName || isSaving}
                  className="px-2 py-1 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
                </button>
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewProjectName('');
                  }}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
                >
                  <Plus className="h-3 w-3" />
                  New
                </button>
                <button
                  onClick={handleUpload}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
                >
                  <Upload className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Compose Apps toggle - on the right */}
          <button
            onClick={() => setIsProjectsPanelCollapsed(!isProjectsPanelCollapsed)}
            className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]"
          >
            <span className="uppercase tracking-wider">Compose Apps</span>
            <span className="text-[hsl(var(--text-muted))]">({projects?.length || 0})</span>
            {isProjectsPanelCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {/* Project Cards */}
        {!isProjectsPanelCollapsed && (
          <div className="flex flex-wrap gap-3 p-3">
            {projects?.map((project) => {
              const isSelected = selectedProject === project.name;
              const isEditing = editingProjectName === project.name;

              return (
                <div
                  key={project.name}
                  onClick={() => !isEditing && setSelectedProject(project.name)}
                  className={`relative flex flex-col min-w-[180px] max-w-[240px] p-3 cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-[hsl(var(--cyan)/0.1)] border-2 border-[hsl(var(--cyan)/0.5)]'
                      : 'bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))]'
                  }`}
                >
                  {/* Project Header */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Circle className={`h-2 w-2 shrink-0 fill-current ${getStatusClass(project.status)}`} />
                      {isEditing ? (
                        <input
                          type="text"
                          value={newNameValue}
                          onChange={(e) => setNewNameValue(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') handleRename(project.name, newNameValue);
                            if (e.key === 'Escape') setEditingProjectName(null);
                          }}
                          onBlur={() => handleRename(project.name, newNameValue)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 px-1 py-0.5 text-sm font-medium bg-[hsl(var(--input-bg))] border border-[hsl(var(--cyan))] text-[hsl(var(--text-primary))]"
                          autoFocus
                        />
                      ) : (
                        <span className="text-sm font-medium text-[hsl(var(--text-primary))] truncate">
                          {project.name}
                        </span>
                      )}
                    </div>
                    {!isEditing && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing(project.name);
                        }}
                        className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Rename"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  {/* Service Count */}
                  <div className="flex items-center gap-1 mb-2 text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
                    <span>{project.services.length} service{project.services.length !== 1 ? 's' : ''}</span>
                  </div>

                  {/* Service Icons */}
                  {project.services.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {project.services.map((service) => {
                        const ServiceIcon = getServiceIcon(service.image);
                        const isRunning = service.state === 'running';
                        return (
                          <div
                            key={service.name}
                            title={`${service.name}: ${service.image}`}
                            className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] ${
                              isRunning
                                ? 'bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]'
                                : 'bg-[hsl(var(--bg-base))] text-[hsl(var(--text-muted))] border border-[hsl(var(--border))]'
                            }`}
                          >
                            <ServiceIcon className="h-3 w-3" />
                            <span className="truncate max-w-[60px]">{service.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Quick Actions - shown on selected */}
                  {isSelected && (
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[hsl(var(--border))]">
                      {project.status === 'running' || project.status === 'partial' ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleComposeDown();
                          }}
                          disabled={isRunning}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[hsl(var(--amber))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--amber)/0.9)] disabled:opacity-50"
                        >
                          {isRunning && currentAction === 'down' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleComposeUp();
                          }}
                          disabled={isRunning}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
                        >
                          {isRunning && currentAction === 'up' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          Start
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete();
                        }}
                        disabled={deleteMutation.isPending}
                        className="p-1 text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)]"
                        title="Delete project"
                      >
                        {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Empty state */}
            {(!projects || projects.length === 0) && (
              <div className="flex items-center justify-center w-full py-6 text-[hsl(var(--text-muted))]">
                <div className="text-center">
                  <FileCode className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No compose apps yet</p>
                  <p className="text-[10px] mt-1">Create one to get started</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Editor Toolbar */}
      {selectedProject && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex border border-[hsl(var(--border))]">
              <button
                onClick={() => setViewMode('editor')}
                className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                  viewMode === 'editor'
                    ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))]'
                    : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                }`}
              >
                <Code className="h-3 w-3" />
                Code
              </button>
              <button
                onClick={() => setViewMode('canvas')}
                className={`flex items-center gap-1 px-2 py-1 text-xs border-l border-[hsl(var(--border))] transition-colors ${
                  viewMode === 'canvas'
                    ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))]'
                    : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                }`}
              >
                <Network className="h-3 w-3" />
                Canvas
              </button>
            </div>

            {/* App Composer Button */}
            <button
              onClick={() => setShowAppComposer(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.2)] border border-[hsl(var(--green)/0.3)] transition-colors"
            >
              <Boxes className="h-3.5 w-3.5" />
              Components
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* AI Toggle */}
            <button
              onClick={() => aiConfigured && setIsAIPanelOpen(!isAIPanelOpen)}
              disabled={!aiConfigured}
              title={!aiConfigured ? 'Set OPENROUTER_API_KEY on server to enable AI' : 'AI Assistant'}
              className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                !aiConfigured
                  ? 'text-[hsl(var(--text-muted))] cursor-not-allowed'
                  : isAIPanelOpen
                  ? 'bg-[hsl(var(--purple)/0.2)] text-[hsl(var(--purple))] border border-[hsl(var(--purple)/0.3)]'
                  : 'text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.1)] border border-[hsl(var(--purple)/0.3)]'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              AI
              {isAIPanelOpen ? <PanelRightClose className="h-3 w-3" /> : <PanelRightOpen className="h-3 w-3" />}
            </button>

            {/* Save Button */}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        </div>
      )}

      {/* Services Status Bar */}
      {selectedProject && selectedProjectData && selectedProjectData.services.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Services</span>
          <div className="flex flex-wrap gap-2">
            {selectedProjectData.services.map((service) => (
              <div
                key={service.name}
                className={`flex items-center gap-1.5 px-2 py-1 text-xs ${
                  service.state === 'running'
                    ? isDevNode(service.name)
                      ? 'bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.2)]'
                      : 'bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)]'
                    : 'bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))]'
                }`}
              >
                <Circle className={`h-1.5 w-1.5 fill-current ${service.state === 'running' ? isDevNode(service.name) ? 'text-[hsl(var(--cyan))]' : 'status-running' : 'status-stopped'}`} />
                <span className={`${isDevNode(service.name) ? 'text-[hsl(var(--cyan))] font-medium' : 'text-[hsl(var(--text-primary))]'}`}>
                  {service.name}
                  {isDevNode(service.name) && <span className="ml-1 text-[10px] opacity-60">(dev)</span>}
                </span>
                <span className="text-[hsl(var(--text-muted))]">{service.image}</span>
                {service.ports.length > 0 && (
                  <span className="text-[hsl(var(--cyan))]">
                    {service.ports.map(p => p.host ? `:${p.host}` : `:${p.container}`).join(', ')}
                  </span>
                )}
                {service.state === 'running' && (
                  <button
                    onClick={() => setActiveTerminal({ containerId: service.containerId, serviceName: service.name, isDevNode: isDevNode(service.name) })}
                    className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                    title="Open Terminal"
                  >
                    <TerminalSquare className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SSH Command Bar - shows for any service with SSH access */}
      {primarySshService && (
        <div className="px-4 py-2.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--cyan))]">
              <TerminalIcon className="h-3 w-3" />
              <span>SSH</span>
              <span className="text-[hsl(var(--text-muted))]">:{primarySshService.sshPort}</span>
              {sshServices.length > 1 && (
                <span className="text-[hsl(var(--text-muted))]">({primarySshService.name})</span>
              )}
            </div>
            <div className="flex-1 flex items-center gap-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] px-2.5 py-1.5">
              <code className="flex-1 text-[10px] text-[hsl(var(--text-secondary))] truncate">
                {getSshCommand(primarySshService)}
              </code>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => handleCopySshCommand(getSshCommand(primarySshService)!)}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
                  title="Copy command"
                >
                  {copiedSshCommand === getSshCommand(primarySshService) ? (
                    <Check className="h-3 w-3 text-[hsl(var(--green))]" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
                <button
                  onClick={() => handleDownloadSshKey(primarySshService)}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
                  title="Download SSH key"
                >
                  <Download className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setActiveTerminal({ containerId: primarySshService.containerId, serviceName: primarySshService.name, isDevNode: isDevNode(primarySshService.name) })}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] transition-colors"
                  title="Open Browser Terminal"
                >
                  <TerminalSquare className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Picker */}
      {selectedProject && customImages.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
            <Image className="h-3 w-3" />
            Images
          </div>
          <div className="flex flex-wrap gap-2">
            {customImages.map((img) => {
              const tag = img.repoTags?.find(t => t.startsWith('acm-')) || img.repoTags?.[0];
              if (!tag) return null;
              const isCopied = copiedImage === tag;
              return (
                <div
                  key={img.id}
                  className="flex items-center bg-[hsl(var(--purple)/0.1)] border border-[hsl(var(--purple)/0.2)]"
                >
                  <button
                    onClick={() => handleInsertImage(tag)}
                    className="px-2 py-1 text-xs text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.2)] transition-colors"
                    title="Click to replace image in YAML"
                  >
                    {tag}
                  </button>
                  <button
                    onClick={() => handleCopyImage(tag)}
                    className="px-1.5 py-1 hover:bg-[hsl(var(--purple)/0.2)] border-l border-[hsl(var(--purple)/0.2)] transition-colors"
                    title="Copy to clipboard"
                  >
                    {isCopied ? (
                      <Check className="h-3 w-3 text-[hsl(var(--green))]" />
                    ) : (
                      <Copy className="h-3 w-3 text-[hsl(var(--purple))]" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor/Canvas */}
        <div className={`flex-1 min-w-0 ${isAIPanelOpen ? '' : ''}`}>
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
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  padding: { top: 12, bottom: 12 },
                  renderLineHighlight: 'gutter',
                  cursorBlinking: 'smooth',
                }}
              />
            ) : (
              <ComposeCanvas
                composeContent={content}
                services={selectedProjectData?.services || []}
              />
            )
          ) : (
            <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))]">
              <div className="text-center">
                <FileCode className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-xs uppercase tracking-wider">Select or create a project</p>
              </div>
            </div>
          )}
        </div>

        {/* AI Side Panel */}
        {isAIPanelOpen && selectedProject && (
          <div className="w-96 flex flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))] animate-slide-in">
            {/* AI Panel Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))]">
              <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--purple))]">
                <Sparkles className="h-4 w-4" />
                AI Assistant
              </div>
              <div className="flex items-center gap-1">
                {chatMessages.length > 0 && (
                  <button
                    onClick={() => setChatMessages([])}
                    disabled={isStreaming}
                    className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
                    title="Clear chat"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => setIsAIPanelOpen(false)}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                >
                  <PanelRightClose className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <Sparkles className="h-8 w-8 mx-auto mb-3 text-[hsl(var(--purple)/0.3)]" />
                  <p className="text-xs text-[hsl(var(--text-secondary))]">Ask me to modify your compose file</p>
                  <p className="text-[10px] mt-1 text-[hsl(var(--text-muted))]">e.g., "Add PostgreSQL" or "Add Redis cache"</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`p-2.5 text-xs ${
                    msg.role === 'user'
                      ? 'bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.2)] ml-6'
                      : 'bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] mr-6'
                  }`}
                >
                  <div className="text-[hsl(var(--text-primary))]">
                    {msg.role === 'assistant' && !(isStreaming && i === chatMessages.length - 1)
                      ? renderMessageContent(msg.content)
                      : <span className="whitespace-pre-wrap">{msg.content}</span>}
                  </div>
                  {msg.role === 'assistant' && !isStreaming && msg.content && (() => {
                    const yaml = extractYamlFromResponse(msg.content);
                    if (yaml) {
                      return (
                        <div className="mt-2.5 flex gap-2">
                          <button
                            onClick={() => handleCopyCode(yaml, i)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
                          >
                            {copiedCode === i ? (
                              <>
                                <Check className="h-3 w-3 text-[hsl(var(--green))]" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                Copy
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleApplyYaml(yaml)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--purple)/0.9)]"
                          >
                            <Check className="h-3 w-3" />
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
                <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Processing...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-3 border-t border-[hsl(var(--border))]">
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
                  className="flex-1 px-2.5 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] disabled:opacity-50"
                />
                <button
                  onClick={handleSendChat}
                  disabled={isStreaming || !chatInput.trim()}
                  className="px-2.5 py-1.5 bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--purple)/0.9)] disabled:opacity-50"
                >
                  {isStreaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
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
            className={`flex items-center gap-2 px-3 py-2 text-xs font-medium shadow-lg transition-colors ${
              actionResult?.type === 'error'
                ? 'bg-[hsl(var(--red))] text-white'
                : actionResult?.type === 'success'
                ? 'bg-[hsl(var(--green))] text-[hsl(var(--bg-base))]'
                : 'bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]'
            }`}
          >
            {currentAction === 'up' ? <Play className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            <span>
              {isRunning
                ? currentAction === 'up' ? 'Starting...' : 'Stopping...'
                : actionResult?.type === 'success'
                ? currentAction === 'up' ? 'Started' : 'Stopped'
                : 'Failed'}
            </span>
            {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
            <Maximize2 className="h-3 w-3 ml-1 opacity-60" />
          </button>
        </div>
      )}

      {/* Action Log Modal - Expanded */}
      {showLogsModal && !isLogsMinimized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-3xl mx-4 flex flex-col max-h-[80vh] bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--border))]">
              <h3 className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--text-primary))] uppercase tracking-wider">
                {currentAction === 'up' ? <Play className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {currentAction === 'up' ? 'Starting Services' : 'Stopping Services'}
                {isRunning && <Loader2 className="h-3 w-3 animate-spin ml-2" />}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsLogsMinimized(true)}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowLogsModal(false)}
                  disabled={isRunning}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-[hsl(var(--bg-base))]">
              <pre className="text-xs text-[hsl(var(--text-secondary))] whitespace-pre-wrap leading-relaxed">
                {actionLogs.map((log, i) => (
                  <span key={i}>{log}</span>
                ))}
              </pre>
              <div ref={logsEndRef} />
            </div>

            {actionResult && (
              <div
                className={`px-4 py-2.5 text-xs border-t ${
                  actionResult.type === 'success'
                    ? 'bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border-[hsl(var(--green)/0.2)]'
                    : 'bg-[hsl(var(--red)/0.1)] text-[hsl(var(--red))] border-[hsl(var(--red)/0.2)]'
                }`}
              >
                {actionResult.message}
              </div>
            )}

            {!isRunning && (
              <div className="px-4 py-2.5 border-t border-[hsl(var(--border))] flex justify-end">
                <button
                  onClick={() => setShowLogsModal(false)}
                  className="px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))]"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Terminal */}
      {activeTerminal && (
        <Terminal
          containerId={activeTerminal.containerId}
          containerName={`${selectedProject}/${activeTerminal.serviceName}`}
          onClose={() => setActiveTerminal(null)}
          isDevNode={activeTerminal.isDevNode}
        />
      )}

      {/* App Composer */}
      {showAppComposer && (
        <AppComposer
          onApplyCompose={handleApplyCompose}
          onClose={() => setShowAppComposer(false)}
          currentContent={content}
        />
      )}
    </div>
  );
}
