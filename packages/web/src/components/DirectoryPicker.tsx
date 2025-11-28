import { useState, useEffect } from 'react';
import { X, Folder, FolderOpen, ChevronUp, Loader2, Eye, EyeOff } from 'lucide-react';
import * as api from '../api/client';

interface DirectoryPickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function DirectoryPicker({ initialPath, onSelect, onCancel }: DirectoryPickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [directories, setDirectories] = useState<api.DirectoryEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [manualPath, setManualPath] = useState('');

  const loadDirectory = async (path?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.browseDirectory(path);
      setCurrentPath(result.currentPath);
      setParentPath(result.parent);
      setDirectories(result.directories);
      setManualPath(result.currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDirectory(initialPath);
  }, [initialPath]);

  const handleNavigate = (path: string) => {
    loadDirectory(path);
  };

  const handleManualNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualPath) {
      loadDirectory(manualPath);
    }
  };

  const visibleDirectories = showHidden
    ? directories
    : directories.filter(d => !d.hidden);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl dark:bg-gray-800 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h3 className="text-lg font-semibold dark:text-white">Select Directory</h3>
          <button
            onClick={onCancel}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Path input */}
        <form onSubmit={handleManualNavigate} className="p-3 border-b dark:border-gray-700">
          <div className="flex gap-2">
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/path/to/directory"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
            <button
              type="submit"
              className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              Go
            </button>
          </div>
        </form>

        {/* Current path display and controls */}
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700">
          <FolderOpen className="h-4 w-4 text-blue-500 flex-shrink-0" />
          <span className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate flex-1">
            {currentPath}
          </span>
          <button
            onClick={() => setShowHidden(!showHidden)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
            title={showHidden ? 'Hide hidden folders' : 'Show hidden folders'}
          >
            {showHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </div>

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-500">{error}</p>
              <button
                onClick={() => loadDirectory()}
                className="mt-2 text-sm text-blue-500 hover:underline"
              >
                Go to home directory
              </button>
            </div>
          ) : (
            <ul className="space-y-1">
              {/* Parent directory */}
              {parentPath && (
                <li>
                  <button
                    onClick={() => handleNavigate(parentPath)}
                    className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <ChevronUp className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-600 dark:text-gray-400">..</span>
                  </button>
                </li>
              )}

              {/* Directories */}
              {visibleDirectories.map((dir) => (
                <li key={dir.path}>
                  <button
                    onClick={() => handleNavigate(dir.path)}
                    className={`flex items-center gap-2 w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      dir.hidden ? 'opacity-60' : ''
                    }`}
                  >
                    <Folder className="h-4 w-4 text-blue-500" />
                    <span className="text-gray-900 dark:text-white truncate">
                      {dir.name}
                    </span>
                  </button>
                </li>
              ))}

              {visibleDirectories.length === 0 && !parentPath && (
                <li className="text-center py-4 text-sm text-gray-500">
                  No subdirectories
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate flex-1">
            Selected: {currentPath}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={() => onSelect(currentPath)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
