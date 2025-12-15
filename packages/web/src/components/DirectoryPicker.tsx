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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="w-full max-w-4xl bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg flex flex-col max-h-[80vh] animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
          <h3 className="text-base font-semibold text-[hsl(var(--text-primary))]">Select Directory</h3>
          <button
            onClick={onCancel}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Path input */}
        <form onSubmit={handleManualNavigate} className="p-3 border-b border-[hsl(var(--border))]">
          <div className="flex gap-2">
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/path/to/directory"
              className="flex-1 px-3 py-2 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan-dim))] focus:outline-none"
            />
            <button
              type="submit"
              className="px-3 py-2 text-xs font-medium bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))]"
            >
              Go
            </button>
          </div>
        </form>

        {/* Current path display and controls */}
        <div className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--bg-base))] border-b border-[hsl(var(--border))]">
          <FolderOpen className="h-4 w-4 text-[hsl(var(--cyan))] flex-shrink-0" />
          <span className="text-xs text-[hsl(var(--text-secondary))] truncate flex-1">
            {currentPath}
          </span>
          <button
            onClick={() => setShowHidden(!showHidden)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
            title={showHidden ? 'Hide hidden folders' : 'Show hidden folders'}
          >
            {showHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </div>

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[200px] bg-[hsl(var(--bg-base))]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-xs text-[hsl(var(--red))]">{error}</p>
              <button
                onClick={() => loadDirectory()}
                className="mt-2 text-xs text-[hsl(var(--cyan))] hover:underline"
              >
                Go to home directory
              </button>
            </div>
          ) : (
            <ul className="space-y-0.5">
              {/* Parent directory */}
              {parentPath && (
                <li>
                  <button
                    onClick={() => handleNavigate(parentPath)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-[hsl(var(--bg-elevated))]"
                  >
                    <ChevronUp className="h-4 w-4 text-[hsl(var(--text-muted))]" />
                    <span className="text-[hsl(var(--text-muted))]">..</span>
                  </button>
                </li>
              )}

              {/* Directories */}
              {visibleDirectories.map((dir) => (
                <li key={dir.path}>
                  <button
                    onClick={() => handleNavigate(dir.path)}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-[hsl(var(--bg-elevated))] ${
                      dir.hidden ? 'opacity-60' : ''
                    }`}
                  >
                    <Folder className="h-4 w-4 text-[hsl(var(--cyan))]" />
                    <span className="text-[hsl(var(--text-primary))] truncate">
                      {dir.name}
                    </span>
                  </button>
                </li>
              ))}

              {visibleDirectories.length === 0 && !parentPath && (
                <li className="text-center py-4 text-xs text-[hsl(var(--text-muted))]">
                  No subdirectories
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <p className="text-[10px] text-[hsl(var(--text-muted))] truncate flex-1">
            Selected: {currentPath}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-xs font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onSelect(currentPath)}
              className="px-4 py-2 text-xs font-medium bg-[hsl(var(--cyan))] text-white hover:bg-[hsl(var(--cyan-dim))] transition-colors"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
