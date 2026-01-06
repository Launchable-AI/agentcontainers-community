import { useState, useEffect, useMemo } from 'react';
import { FolderOpen, Loader2, Sparkles, RotateCcw, Box, ChevronDown, Cpu, Search, Maximize2, Server, Key, X, Cog, Download, Trash2, Power, PowerOff, CheckCircle, XCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { useConfig, useUpdateConfig, useImages } from '../hooks/useContainers';
import { DirectoryPicker } from './DirectoryPicker';
import * as api from '../api/client';
import type { ModelOption, BackendStatus } from '../api/client';

type SettingsTab = 'general' | 'ai' | 'backends';

export function Settings() {
  const { data: config, isLoading } = useConfig();
  const { data: images } = useImages();
  const updateMutation = useUpdateConfig();

  const [dataDirectory, setDataDirectory] = useState('');
  const [sshHost, setSshHost] = useState('');
  const [sshJumpHost, setSshJumpHost] = useState('');
  const [sshJumpHostKeyPath, setSshJumpHostKeyPath] = useState('');
  const [sshKeysDisplayPath, setSshKeysDisplayPath] = useState('');
  const [defaultDevNodeImage, setDefaultDevNodeImage] = useState('ubuntu:24.04');
  const [showDataDirPicker, setShowDataDirPicker] = useState(false);
  const [showImageDropdown, setShowImageDropdown] = useState(false);

  // Get list of custom-built images (acm-* tags)
  const customImages = useMemo(() => {
    if (!images) return [];
    const imageList: string[] = [];
    for (const img of images) {
      const acmTags = img.repoTags?.filter(tag => tag.startsWith('acm-')) || [];
      imageList.push(...acmTags);
    }
    return imageList.sort();
  }, [images]);

  // AI Prompts state
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [composePrompt, setComposePrompt] = useState('');
  const [dockerfilePrompt, setDockerfilePrompt] = useState('');
  const [mcpInstallPrompt, setMcpInstallPrompt] = useState('');
  const [mcpSearchPrompt, setMcpSearchPrompt] = useState('');
  const [defaultComposePrompt, setDefaultComposePrompt] = useState('');
  const [defaultDockerfilePrompt, setDefaultDockerfilePrompt] = useState('');
  const [defaultMcpInstallPrompt, setDefaultMcpInstallPrompt] = useState('');
  const [defaultMcpSearchPrompt, setDefaultMcpSearchPrompt] = useState('');
  const [currentModel, setCurrentModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsSaving, setPromptsSaving] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState<{
    key: 'compose' | 'dockerfile' | 'mcpSearch' | 'mcpInstall';
    label: string;
  } | null>(null);

  // Backends state
  const [backends, setBackends] = useState<BackendStatus | null>(null);
  const [backendsLoading, setBackendsLoading] = useState(false);
  const [backendsError, setBackendsError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setDataDirectory(config.dataDirectory || '');
      setSshHost(config.sshHost || '');
      setSshJumpHost(config.sshJumpHost || '');
      setSshJumpHostKeyPath(config.sshJumpHostKeyPath || '');
      setSshKeysDisplayPath(config.sshKeysDisplayPath || '');
      setDefaultDevNodeImage(config.defaultDevNodeImage || 'ubuntu:24.04');
    }
  }, [config]);

  // Load AI prompts when switching to AI tab
  useEffect(() => {
    if (activeTab === 'ai') {
      setPromptsLoading(true);
      Promise.all([
        api.getAIStatus(),
        api.getAIPrompts(),
      ]).then(([status, prompts]) => {
        setAiConfigured(status.configured);
        setComposePrompt(prompts.compose.current);
        setDockerfilePrompt(prompts.dockerfile.current);
        setMcpInstallPrompt(prompts.mcpInstall.current);
        setMcpSearchPrompt(prompts.mcpSearch.current);
        setDefaultComposePrompt(prompts.compose.default);
        setDefaultDockerfilePrompt(prompts.dockerfile.default);
        setDefaultMcpInstallPrompt(prompts.mcpInstall.default);
        setDefaultMcpSearchPrompt(prompts.mcpSearch.default);
        setCurrentModel(prompts.model.current);
        setDefaultModel(prompts.model.default);
        setAvailableModels(prompts.model.available);
      }).catch(() => {
        setAiConfigured(false);
      }).finally(() => {
        setPromptsLoading(false);
      });
    }
  }, [activeTab]);

  // Load backends status when switching to backends tab
  useEffect(() => {
    if (activeTab === 'backends') {
      loadBackends();
    }
  }, [activeTab]);

  const loadBackends = async () => {
    setBackendsLoading(true);
    setBackendsError(null);
    try {
      const status = await api.getBackendStatus();
      setBackends(status);
    } catch (err) {
      setBackendsError(err instanceof Error ? err.message : 'Failed to load backend status');
    } finally {
      setBackendsLoading(false);
    }
  };

  const handleBackendAction = async (backend: string, action: 'enable' | 'disable' | 'install' | 'uninstall') => {
    setActionInProgress(`${backend}-${action}`);
    try {
      await api.performBackendAction(backend, action);
      await loadBackends();
    } catch (err) {
      setBackendsError(err instanceof Error ? err.message : `Failed to ${action} ${backend}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSavePrompts = async () => {
    setPromptsSaving(true);
    try {
      const composePromptToSave = composePrompt === defaultComposePrompt ? null : composePrompt;
      const dockerfilePromptToSave = dockerfilePrompt === defaultDockerfilePrompt ? null : dockerfilePrompt;
      const mcpInstallPromptToSave = mcpInstallPrompt === defaultMcpInstallPrompt ? null : mcpInstallPrompt;
      const mcpSearchPromptToSave = mcpSearchPrompt === defaultMcpSearchPrompt ? null : mcpSearchPrompt;
      const modelToSave = currentModel === defaultModel ? null : currentModel;

      await Promise.all([
        api.updateComposePrompt(composePromptToSave),
        api.updateDockerfilePrompt(dockerfilePromptToSave),
        api.updateMCPInstallPrompt(mcpInstallPromptToSave),
        api.updateMCPSearchPrompt(mcpSearchPromptToSave),
        api.updateModel(modelToSave),
      ]);
    } finally {
      setPromptsSaving(false);
    }
  };

  const handleResetComposePrompt = () => setComposePrompt(defaultComposePrompt);
  const handleResetDockerfilePrompt = () => setDockerfilePrompt(defaultDockerfilePrompt);
  const handleResetMcpInstallPrompt = () => setMcpInstallPrompt(defaultMcpInstallPrompt);
  const handleResetMcpSearchPrompt = () => setMcpSearchPrompt(defaultMcpSearchPrompt);
  const handleResetModel = () => setCurrentModel(defaultModel);

  const getPromptValue = (key: 'compose' | 'dockerfile' | 'mcpSearch' | 'mcpInstall') => {
    switch (key) {
      case 'compose': return composePrompt;
      case 'dockerfile': return dockerfilePrompt;
      case 'mcpSearch': return mcpSearchPrompt;
      case 'mcpInstall': return mcpInstallPrompt;
    }
  };

  const setPromptValue = (key: 'compose' | 'dockerfile' | 'mcpSearch' | 'mcpInstall', value: string) => {
    switch (key) {
      case 'compose': setComposePrompt(value); break;
      case 'dockerfile': setDockerfilePrompt(value); break;
      case 'mcpSearch': setMcpSearchPrompt(value); break;
      case 'mcpInstall': setMcpInstallPrompt(value); break;
    }
  };

  const handleSave = async () => {
    await updateMutation.mutateAsync({
      sshHost: sshHost || '',
      sshJumpHost: sshJumpHost || '',
      sshJumpHostKeyPath: sshJumpHostKeyPath || '',
      sshKeysDisplayPath: sshKeysDisplayPath || '~/.ssh',
      dataDirectory: dataDirectory || undefined,
      defaultDevNodeImage: defaultDevNodeImage || 'ubuntu:24.04',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))] px-4">
        <button
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'general'
              ? 'border-[hsl(var(--cyan))] text-[hsl(var(--cyan))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          General
        </button>
        <button
          onClick={() => setActiveTab('backends')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'backends'
              ? 'border-[hsl(var(--green))] text-[hsl(var(--green))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Cog className="h-3.5 w-3.5" />
          Backends
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'ai'
              ? 'border-[hsl(var(--purple))] text-[hsl(var(--purple))]'
              : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI Prompts
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {activeTab === 'general' && (
            <div className="space-y-6">
              {/* SSH Host */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <Server className="h-3.5 w-3.5" />
                  SSH Host
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  The hostname or IP used in SSH connection commands. Leave empty for localhost.
                </p>
                <input
                  type="text"
                  value={sshHost}
                  onChange={(e) => setSshHost(e.target.value)}
                  placeholder="e.g., my-server.example.com or 192.168.1.100"
                  className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                />
              </div>

              {/* SSH Jump Host */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <Server className="h-3.5 w-3.5" />
                  SSH Jump Host (ProxyJump)
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  Optional bastion/jump host for reaching VMs on internal networks. Format: user@host or user@host:port
                </p>
                <input
                  type="text"
                  value={sshJumpHost}
                  onChange={(e) => setSshJumpHost(e.target.value)}
                  placeholder="e.g., ubuntu@my-azure-vm.example.com"
                  className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                />
              </div>

              {/* SSH Jump Host Key Path */}
              {sshJumpHost && (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                    <Key className="h-3.5 w-3.5" />
                    Jump Host SSH Key Path
                  </label>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                    Path to the SSH key for authenticating to the jump host (on your local machine).
                  </p>
                  <input
                    type="text"
                    value={sshJumpHostKeyPath}
                    onChange={(e) => setSshJumpHostKeyPath(e.target.value)}
                    placeholder="e.g., ~/.ssh/azure-vm-key.pem"
                    className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                  />
                </div>
              )}

              {/* SSH Keys Display Path */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <Key className="h-3.5 w-3.5" />
                  SSH Keys Display Path
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  The path shown in SSH commands for finding the private key on your local machine.
                </p>
                <input
                  type="text"
                  value={sshKeysDisplayPath}
                  onChange={(e) => setSshKeysDisplayPath(e.target.value)}
                  placeholder="~/.ssh"
                  className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                />
              </div>

              {/* Data Directory */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Data Directory
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  Where volumes, SSH keys, and dockerfiles are stored on the server.
                </p>
                <div className="flex border border-[hsl(var(--border))] overflow-hidden">
                  <div className="flex-1 px-3 py-2 text-xs bg-[hsl(var(--bg-base))] text-[hsl(var(--text-primary))] truncate">
                    {dataDirectory || <span className="text-[hsl(var(--text-muted))]">Default (project/data)</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDataDirPicker(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Browse
                  </button>
                </div>
              </div>

              {/* Preview */}
              <div className="p-4 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] space-y-3">
                <div>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">
                    Example SSH Command {sshJumpHost && sshJumpHostKeyPath ? '(Remote via jump host)' : '(Local)'}
                  </p>
                  <code className="text-[10px] text-[hsl(var(--cyan))] block break-all font-mono">
                    {sshJumpHost && sshJumpHostKeyPath
                      ? `ssh -o ProxyCommand="ssh -i ${sshJumpHostKeyPath} -W %h:%p ${sshJumpHost}" -i ${sshKeysDisplayPath || '~/.ssh'}/vm_id_ed25519 agent@172.31.0.2`
                      : `ssh -i ${sshKeysDisplayPath || '~/.ssh'}/vm_id_ed25519 agent@${sshHost || '172.31.0.2'}`
                    }
                  </code>
                </div>
                {sshJumpHost && sshJumpHostKeyPath && (
                  <div className="text-[10px] text-[hsl(var(--text-muted))]">
                    Connections will proxy through <span className="text-[hsl(var(--purple))]">{sshJumpHost}</span> to reach VMs
                  </div>
                )}
                {sshJumpHost && !sshJumpHostKeyPath && (
                  <div className="text-[10px] text-[hsl(var(--amber))]">
                    Add Jump Host SSH Key Path to enable remote access
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">Server Volumes Path</p>
                  <code className="text-[10px] text-[hsl(var(--text-secondary))] block break-all">
                    {dataDirectory ? `${dataDirectory}/volumes/` : '(default)'}
                  </code>
                </div>
              </div>

              {/* Default Dev Node Image */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <Box className="h-3.5 w-3.5" />
                  Default Dev Node Image
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  The default Docker image used for the dev-node service in new compose apps.
                </p>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowImageDropdown(!showImageDropdown)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] hover:border-[hsl(var(--cyan)/0.5)]"
                  >
                    <span className={defaultDevNodeImage ? '' : 'text-[hsl(var(--text-muted))]'}>
                      {defaultDevNodeImage || 'Select an image...'}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 text-[hsl(var(--text-muted))] transition-transform ${showImageDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showImageDropdown && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-auto bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] shadow-lg">
                      {customImages.length === 0 ? (
                        <div className="px-3 py-4 text-center">
                          <p className="text-xs text-[hsl(var(--text-muted))]">No custom images found</p>
                          <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">Build an image in the Dockerfile editor first</p>
                        </div>
                      ) : (
                        <>
                          {customImages.map((image) => (
                            <button
                              key={image}
                              type="button"
                              onClick={() => {
                                setDefaultDevNodeImage(image);
                                setShowImageDropdown(false);
                              }}
                              className={`w-full px-3 py-2 text-left text-xs hover:bg-[hsl(var(--bg-overlay))] flex items-center justify-between ${
                                defaultDevNodeImage === image
                                  ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                                  : 'text-[hsl(var(--text-primary))]'
                              }`}
                            >
                              <span>{image}</span>
                              {defaultDevNodeImage === image && (
                                <span className="text-[10px] text-[hsl(var(--cyan))]">selected</span>
                              )}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
                {defaultDevNodeImage && !customImages.includes(defaultDevNodeImage) && (
                  <p className="mt-2 text-[10px] text-[hsl(var(--amber))]">
                    Current image "{defaultDevNodeImage}" is not in your built images
                  </p>
                )}
              </div>

              {/* Save Button */}
              <div className="flex justify-end pt-4 border-t border-[hsl(var(--border))]">
                <button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50"
                >
                  {updateMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save Settings
                </button>
              </div>
            </div>
          )}

          {activeTab === 'backends' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Backend Services</h3>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                    Manage container and VM runtime backends
                  </p>
                </div>
                <button
                  onClick={loadBackends}
                  disabled={backendsLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))]"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${backendsLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {backendsError && (
                <div className="p-3 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-xs text-[hsl(var(--red))]">
                  {backendsError}
                </div>
              )}

              {backendsLoading && !backends ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
                </div>
              ) : backends ? (
                <div className="space-y-4">
                  {/* Docker */}
                  <BackendCard
                    name="Docker"
                    description="Container runtime for running containers and compose projects"
                    status={backends.docker}
                    icon={<Box className="h-5 w-5" />}
                    onAction={(action) => handleBackendAction('docker', action)}
                    actionInProgress={actionInProgress?.startsWith('docker-') ? actionInProgress : null}
                  />

                  {/* Cloud-Hypervisor */}
                  <BackendCard
                    name="Cloud-Hypervisor"
                    description="Lightweight hypervisor for running virtual machines"
                    status={backends.cloudHypervisor}
                    icon={<Server className="h-5 w-5" />}
                    onAction={(action) => handleBackendAction('cloud-hypervisor', action)}
                    actionInProgress={actionInProgress?.startsWith('cloud-hypervisor-') ? actionInProgress : null}
                  />

                  {/* Firecracker */}
                  <BackendCard
                    name="Firecracker"
                    description="MicroVM hypervisor with fast snapshot restore via MMDS"
                    status={backends.firecracker}
                    icon={<Cpu className="h-5 w-5" />}
                    onAction={(action) => handleBackendAction('firecracker', action)}
                    actionInProgress={actionInProgress?.startsWith('firecracker-') ? actionInProgress : null}
                  />
                </div>
              ) : null}

              {/* Info section */}
              <div className="p-4 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] space-y-3">
                <h4 className="text-xs font-medium text-[hsl(var(--text-primary))] uppercase tracking-wider">About Backends</h4>
                <div className="space-y-2 text-[10px] text-[hsl(var(--text-muted))]">
                  <p><strong className="text-[hsl(var(--cyan))]">Docker</strong>: Standard container runtime. Best for development environments and services.</p>
                  <p><strong className="text-[hsl(var(--green))]">Cloud-Hypervisor</strong>: Modern hypervisor for VMs. Great for isolation and production-like environments.</p>
                  <p><strong className="text-[hsl(var(--purple))]">Firecracker</strong>: MicroVM technology with ~125ms snapshot restore. Ideal for golden images and rapid provisioning.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-6">
              {promptsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
                </div>
              ) : (
                <>
                  {!aiConfigured && (
                    <div className="p-3 bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.2)] text-xs text-[hsl(var(--amber))]">
                      AI is not configured. Add <code className="bg-[hsl(var(--bg-base))] px-1">OPENROUTER_API_KEY</code> to <code className="bg-[hsl(var(--bg-base))] px-1">.env.local</code> to enable AI features.
                    </div>
                  )}

                  {/* Model Selection */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))]">
                        <Cpu className="h-3.5 w-3.5" />
                        AI Model
                      </label>
                      <button
                        onClick={handleResetModel}
                        disabled={currentModel === defaultModel}
                        className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset
                      </button>
                    </div>
                    <p className="text-[10px] text-[hsl(var(--text-muted))] mb-2">
                      Select the model used for all AI features via OpenRouter.
                    </p>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowModelDropdown(!showModelDropdown)}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] hover:border-[hsl(var(--purple)/0.5)]"
                      >
                        <span>
                          {availableModels.find(m => m.id === currentModel)?.name || currentModel}
                        </span>
                        <ChevronDown className={`h-3.5 w-3.5 text-[hsl(var(--text-muted))] transition-transform ${showModelDropdown ? 'rotate-180' : ''}`} />
                      </button>

                      {showModelDropdown && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-auto bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] shadow-lg">
                          {availableModels.map((model) => (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => {
                                setCurrentModel(model.id);
                                setShowModelDropdown(false);
                              }}
                              className={`w-full px-3 py-2 text-left text-xs hover:bg-[hsl(var(--bg-overlay))] flex items-center justify-between ${
                                currentModel === model.id
                                  ? 'text-[hsl(var(--purple))] bg-[hsl(var(--purple)/0.1)]'
                                  : 'text-[hsl(var(--text-primary))]'
                              }`}
                            >
                              <span>{model.name}</span>
                              {currentModel === model.id && (
                                <span className="text-[10px] text-[hsl(var(--purple))]">selected</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Compose Prompt */}
                  <PromptEditor
                    label="Docker Compose Assistant Prompt"
                    value={composePrompt}
                    onChange={setComposePrompt}
                    defaultValue={defaultComposePrompt}
                    onReset={handleResetComposePrompt}
                    onExpand={() => setExpandedPrompt({ key: 'compose', label: 'Docker Compose Assistant Prompt' })}
                    placeholder="System prompt for Compose AI assistant..."
                  />

                  {/* Dockerfile Prompt */}
                  <PromptEditor
                    label="Dockerfile Assistant Prompt"
                    value={dockerfilePrompt}
                    onChange={setDockerfilePrompt}
                    defaultValue={defaultDockerfilePrompt}
                    onReset={handleResetDockerfilePrompt}
                    onExpand={() => setExpandedPrompt({ key: 'dockerfile', label: 'Dockerfile Assistant Prompt' })}
                    placeholder="System prompt for Dockerfile AI assistant..."
                  />

                  {/* MCP Search Prompt */}
                  <PromptEditor
                    label="MCP Registry AI Search Prompt"
                    value={mcpSearchPrompt}
                    onChange={setMcpSearchPrompt}
                    defaultValue={defaultMcpSearchPrompt}
                    onReset={handleResetMcpSearchPrompt}
                    onExpand={() => setExpandedPrompt({ key: 'mcpSearch', label: 'MCP Registry AI Search Prompt' })}
                    placeholder="System prompt for MCP AI search..."
                    icon={<Search className="h-3.5 w-3.5" />}
                    description="Prompt used for AI-powered semantic search through MCP servers."
                  />

                  {/* MCP Install Prompt */}
                  <PromptEditor
                    label="MCP Install Instructions Prompt"
                    value={mcpInstallPrompt}
                    onChange={setMcpInstallPrompt}
                    defaultValue={defaultMcpInstallPrompt}
                    onReset={handleResetMcpInstallPrompt}
                    onExpand={() => setExpandedPrompt({ key: 'mcpInstall', label: 'MCP Install Instructions Prompt' })}
                    placeholder="System prompt for MCP install instructions extraction..."
                    description="Prompt used to extract installation instructions from MCP server READMEs."
                  />

                  {/* Save Button */}
                  <div className="flex justify-end pt-4 border-t border-[hsl(var(--border))]">
                    <button
                      onClick={handleSavePrompts}
                      disabled={promptsSaving || promptsLoading}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--purple)/0.9)] disabled:opacity-50"
                    >
                      {promptsSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                      Save Prompts
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Directory Picker Modal */}
      {showDataDirPicker && (
        <DirectoryPicker
          initialPath={dataDirectory || undefined}
          onSelect={(path) => {
            setDataDirectory(path);
            setShowDataDirPicker(false);
          }}
          onCancel={() => setShowDataDirPicker(false)}
        />
      )}

      {/* Expanded Prompt Editor Modal */}
      {expandedPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80">
          <div className="w-full max-w-4xl h-[80vh] flex flex-col bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
              <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
                {expandedPrompt.label}
              </h3>
              <button
                onClick={() => setExpandedPrompt(null)}
                className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 p-4">
              <textarea
                value={getPromptValue(expandedPrompt.key)}
                onChange={(e) => setPromptValue(expandedPrompt.key, e.target.value)}
                className="w-full h-full p-4 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] resize-none font-mono"
                placeholder="Enter system prompt..."
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[hsl(var(--border))]">
              <button
                onClick={() => setExpandedPrompt(null)}
                className="px-4 py-2 text-xs bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Backend Card Component
interface BackendInfo {
  installed: boolean;
  enabled: boolean;
  running: boolean;
  version?: string;
  error?: string;
}

interface BackendCardProps {
  name: string;
  description: string;
  status: BackendInfo;
  icon: React.ReactNode;
  onAction: (action: 'enable' | 'disable' | 'install' | 'uninstall') => void;
  actionInProgress: string | null;
}

function BackendCard({ name, description, status, icon, onAction, actionInProgress }: BackendCardProps) {
  const getStatusIcon = () => {
    if (!status.installed) return <XCircle className="h-4 w-4 text-[hsl(var(--text-muted))]" />;
    if (status.error) return <AlertCircle className="h-4 w-4 text-[hsl(var(--red))]" />;
    if (status.running) return <CheckCircle className="h-4 w-4 text-[hsl(var(--green))]" />;
    if (status.enabled) return <Power className="h-4 w-4 text-[hsl(var(--amber))]" />;
    return <PowerOff className="h-4 w-4 text-[hsl(var(--text-muted))]" />;
  };

  const getStatusText = () => {
    if (!status.installed) return 'Not Installed';
    if (status.error) return status.error;
    if (status.running) return 'Running';
    if (status.enabled) return 'Enabled (Not Running)';
    return 'Disabled';
  };

  const getStatusColor = () => {
    if (!status.installed) return 'text-[hsl(var(--text-muted))]';
    if (status.error) return 'text-[hsl(var(--red))]';
    if (status.running) return 'text-[hsl(var(--green))]';
    if (status.enabled) return 'text-[hsl(var(--amber))]';
    return 'text-[hsl(var(--text-muted))]';
  };

  const isLoading = actionInProgress !== null;

  return (
    <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]">
      <div className="flex items-start gap-4">
        <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))]">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">{name}</h4>
            {status.version && (
              <span className="text-[10px] text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-base))] px-1.5 py-0.5">
                v{status.version}
              </span>
            )}
          </div>
          <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">{description}</p>
          <div className="flex items-center gap-1.5 mt-2">
            {getStatusIcon()}
            <span className={`text-[10px] ${getStatusColor()}`}>{getStatusText()}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {status.installed ? (
            <>
              {status.enabled ? (
                <button
                  onClick={() => onAction('disable')}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] disabled:opacity-50"
                >
                  {actionInProgress === `${name.toLowerCase().replace('-', '')}-disable` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <PowerOff className="h-3 w-3" />
                  )}
                  Disable
                </button>
              ) : (
                <button
                  onClick={() => onAction('enable')}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
                >
                  {actionInProgress === `${name.toLowerCase().replace('-', '')}-enable` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Power className="h-3 w-3" />
                  )}
                  Enable
                </button>
              )}
              <button
                onClick={() => onAction('uninstall')}
                disabled={isLoading}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
              >
                {actionInProgress === `${name.toLowerCase().replace('-', '')}-uninstall` ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Uninstall
              </button>
            </>
          ) : (
            <button
              onClick={() => onAction('install')}
              disabled={isLoading}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] disabled:opacity-50"
            >
              {actionInProgress === `${name.toLowerCase().replace('-', '')}-install` ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Prompt Editor Component
interface PromptEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultValue: string;
  onReset: () => void;
  onExpand: () => void;
  placeholder: string;
  icon?: React.ReactNode;
  description?: string;
}

function PromptEditor({ label, value, onChange, defaultValue, onReset, onExpand, placeholder, icon, description }: PromptEditorProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))]">
          {icon}
          {label}
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={onExpand}
            className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          >
            <Maximize2 className="h-3 w-3" />
            Expand
          </button>
          <button
            onClick={onReset}
            disabled={value === defaultValue}
            className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
      </div>
      {description && (
        <p className="text-[10px] text-[hsl(var(--text-muted))] mb-2">{description}</p>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        className="w-full p-3 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] resize-y"
        placeholder={placeholder}
      />
    </div>
  );
}
