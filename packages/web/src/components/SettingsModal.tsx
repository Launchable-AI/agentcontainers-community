import { useState, useEffect, useMemo } from 'react';
import { X, FolderOpen, Loader2, Sparkles, RotateCcw, Box, ChevronDown } from 'lucide-react';
import { useConfig, useUpdateConfig, useImages } from '../hooks/useContainers';
import { DirectoryPicker } from './DirectoryPicker';
import * as api from '../api/client';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { data: config, isLoading } = useConfig();
  const { data: images } = useImages();
  const updateMutation = useUpdateConfig();

  const [dataDirectory, setDataDirectory] = useState('');
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
  const [activeTab, setActiveTab] = useState<'general' | 'ai'>('general');
  const [composePrompt, setComposePrompt] = useState('');
  const [dockerfilePrompt, setDockerfilePrompt] = useState('');
  const [defaultComposePrompt, setDefaultComposePrompt] = useState('');
  const [defaultDockerfilePrompt, setDefaultDockerfilePrompt] = useState('');
  const [aiConfigured, setAiConfigured] = useState(false);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsSaving, setPromptsSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setDataDirectory(config.dataDirectory || '');
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
        setDefaultComposePrompt(prompts.compose.default);
        setDefaultDockerfilePrompt(prompts.dockerfile.default);
      }).catch(() => {
        setAiConfigured(false);
      }).finally(() => {
        setPromptsLoading(false);
      });
    }
  }, [activeTab]);

  const handleSavePrompts = async () => {
    setPromptsSaving(true);
    try {
      // Only send null if we want to reset to default, otherwise send the current value
      const composePromptToSave = composePrompt === defaultComposePrompt ? null : composePrompt;
      const dockerfilePromptToSave = dockerfilePrompt === defaultDockerfilePrompt ? null : dockerfilePrompt;

      await Promise.all([
        api.updateComposePrompt(composePromptToSave),
        api.updateDockerfilePrompt(dockerfilePromptToSave),
      ]);
    } finally {
      setPromptsSaving(false);
    }
  };

  const handleResetComposePrompt = () => {
    setComposePrompt(defaultComposePrompt);
  };

  const handleResetDockerfilePrompt = () => {
    setDockerfilePrompt(defaultDockerfilePrompt);
  };

  const handleSave = async () => {
    const sshKeysPath = dataDirectory ? `${dataDirectory}/ssh-keys` : '';
    await updateMutation.mutateAsync({
      sshKeysDisplayPath: sshKeysPath || '~/.ssh',
      dataDirectory: dataDirectory || undefined,
      defaultDevNodeImage: defaultDevNodeImage || 'ubuntu:24.04',
    });
    onClose();
  };

  const sshKeysPath = dataDirectory ? `${dataDirectory}/ssh-keys` : '(default)';

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="p-8 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]">
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-2xl flex flex-col max-h-[90vh] bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h2 className="text-sm font-medium text-[hsl(var(--text-primary))] uppercase tracking-wider">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[hsl(var(--border))]">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'general'
                ? 'border-[hsl(var(--cyan))] text-[hsl(var(--cyan))]'
                : 'border-transparent text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
            }`}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            General
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
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
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'general' && (
            <div className="space-y-4">
              {/* Data Directory */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--text-primary))] mb-2">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Data Directory
                </label>
                <p className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
                  Where volumes, SSH keys, and dockerfiles are stored.
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
              <div className="p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] space-y-2">
                <div>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">Volumes</p>
                  <code className="text-[10px] text-[hsl(var(--text-secondary))] block break-all">
                    {dataDirectory ? `${dataDirectory}/volumes/` : '(default)'}
                  </code>
                </div>
                <div>
                  <p className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-1">SSH Keys</p>
                  <code className="text-[10px] text-[hsl(var(--text-secondary))] block break-all">
                    {sshKeysPath}
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
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-5">
              {promptsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
                </div>
              ) : (
                <>
                  {!aiConfigured && (
                    <div className="p-3 bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.2)] text-xs text-[hsl(var(--amber))]">
                      AI is not configured. Add <code className="bg-[hsl(var(--bg-base))] px-1">OPENROUTER_API_KEY</code> to <code className="bg-[hsl(var(--bg-base))] px-1">.env.local</code> to enable AI features.
                    </div>
                  )}

                  {/* Compose Prompt */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-[hsl(var(--text-primary))]">
                        Docker Compose Assistant Prompt
                      </label>
                      <button
                        onClick={handleResetComposePrompt}
                        disabled={composePrompt === defaultComposePrompt}
                        className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset
                      </button>
                    </div>
                    <textarea
                      value={composePrompt}
                      onChange={(e) => setComposePrompt(e.target.value)}
                      rows={8}
                      className="w-full p-3 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] resize-y"
                      placeholder="System prompt for Compose AI assistant..."
                    />
                  </div>

                  {/* Dockerfile Prompt */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-[hsl(var(--text-primary))]">
                        Dockerfile Assistant Prompt
                      </label>
                      <button
                        onClick={handleResetDockerfilePrompt}
                        disabled={dockerfilePrompt === defaultDockerfilePrompt}
                        className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset
                      </button>
                    </div>
                    <textarea
                      value={dockerfilePrompt}
                      onChange={(e) => setDockerfilePrompt(e.target.value)}
                      rows={8}
                      className="w-full p-3 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] resize-y"
                      placeholder="System prompt for Dockerfile AI assistant..."
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[hsl(var(--border))]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))]"
          >
            Cancel
          </button>
          {activeTab === 'general' ? (
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50"
            >
              {updateMutation.isPending && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              Save
            </button>
          ) : (
            <button
              onClick={handleSavePrompts}
              disabled={promptsSaving || promptsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--purple)/0.9)] disabled:opacity-50"
            >
              {promptsSaving && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              Save Prompts
            </button>
          )}
        </div>
      </div>

      {/* Directory Picker */}
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
    </div>
  );
}
