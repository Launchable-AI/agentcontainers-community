import { useState, useEffect } from 'react';
import { X, FolderOpen, Loader2 } from 'lucide-react';
import { useConfig, useUpdateConfig } from '../hooks/useContainers';
import { DirectoryPicker } from './DirectoryPicker';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { data: config, isLoading } = useConfig();
  const updateMutation = useUpdateConfig();

  const [dataDirectory, setDataDirectory] = useState('');
  const [showDataDirPicker, setShowDataDirPicker] = useState(false);

  useEffect(() => {
    if (config) {
      setDataDirectory(config.dataDirectory || '');
    }
  }, [config]);

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
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold dark:text-white">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

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

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
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
