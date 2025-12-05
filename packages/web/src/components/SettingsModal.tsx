import { useState, useEffect } from 'react';
import { X, FolderOpen, Loader2, Sparkles, RotateCcw } from 'lucide-react';
import { useConfig, useUpdateConfig } from '../hooks/useContainers';
import { DirectoryPicker } from './DirectoryPicker';
import * as api from '../api/client';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { data: config, isLoading } = useConfig();
  const updateMutation = useUpdateConfig();

  const [dataDirectory, setDataDirectory] = useState('');
  const [showDataDirPicker, setShowDataDirPicker] = useState(false);

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
    });
    onClose();
  };

  const sshKeysPath = dataDirectory ? `${dataDirectory}/ssh-keys` : '(default)';

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="rounded-lg bg-white p-8 dark:bg-gray-800">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-800 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold dark:text-white">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b dark:border-gray-700 px-6">
          <button
            onClick={() => setActiveTab('general')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'general'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            <FolderOpen className="inline h-4 w-4 mr-1.5" />
            General
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'ai'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            <Sparkles className="inline h-4 w-4 mr-1.5" />
            AI Prompts
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'general' && (
            <div className="space-y-4">
              {/* Data Directory */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <FolderOpen className="inline h-4 w-4 mr-1" />
                  Data Directory
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Where volumes, SSH keys, and dockerfiles are stored.
                </p>
                <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
                  <div className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 dark:text-white font-mono truncate">
                    {dataDirectory || <span className="text-gray-400">Default (project/data)</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowDataDirPicker(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 border-l border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800"
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span>Browse</span>
                  </button>
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-md bg-gray-50 dark:bg-gray-900 p-3 overflow-hidden space-y-2">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Volumes:</p>
                  <code className="text-xs text-gray-800 dark:text-gray-200 font-mono block break-all">
                    {dataDirectory ? `${dataDirectory}/volumes/` : '(default)'}
                  </code>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">SSH Keys:</p>
                  <code className="text-xs text-gray-800 dark:text-gray-200 font-mono block break-all">
                    {sshKeysPath}
                  </code>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-6">
              {promptsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <>
                  {!aiConfigured && (
                    <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4">
                      <p className="text-sm text-yellow-800 dark:text-yellow-200">
                        AI is not configured. Add <code className="bg-yellow-100 dark:bg-yellow-900/50 px-1 rounded">OPENROUTER_API_KEY</code> to <code className="bg-yellow-100 dark:bg-yellow-900/50 px-1 rounded">.env.local</code> to enable AI features.
                      </p>
                    </div>
                  )}

                  {/* Compose Prompt */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Docker Compose Assistant Prompt
                      </label>
                      <button
                        onClick={handleResetComposePrompt}
                        disabled={composePrompt === defaultComposePrompt}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset to default
                      </button>
                    </div>
                    <textarea
                      value={composePrompt}
                      onChange={(e) => setComposePrompt(e.target.value)}
                      rows={8}
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-mono bg-gray-50 dark:bg-gray-900 dark:text-white resize-y"
                      placeholder="System prompt for Compose AI assistant..."
                    />
                  </div>

                  {/* Dockerfile Prompt */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Dockerfile Assistant Prompt
                      </label>
                      <button
                        onClick={handleResetDockerfilePrompt}
                        disabled={dockerfilePrompt === defaultDockerfilePrompt}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reset to default
                      </button>
                    </div>
                    <textarea
                      value={dockerfilePrompt}
                      onChange={(e) => setDockerfilePrompt(e.target.value)}
                      rows={8}
                      className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-mono bg-gray-50 dark:bg-gray-900 dark:text-white resize-y"
                      placeholder="System prompt for Dockerfile AI assistant..."
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          {activeTab === 'general' ? (
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save
            </button>
          ) : (
            <button
              onClick={handleSavePrompts}
              disabled={promptsSaving || promptsLoading}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {promptsSaving && (
                <Loader2 className="h-4 w-4 animate-spin" />
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
