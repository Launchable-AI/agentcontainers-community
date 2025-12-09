import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Plus, Trash2, Loader2, HardDrive, Container, Upload, File, Folder, X, Database, FolderUp } from 'lucide-react';
import { useVolumes, useCreateVolume, useRemoveVolume, useContainers } from '../hooks/useContainers';
import { useConfirm } from './ConfirmModal';
import * as api from '../api/client';
import type { UploadProgress } from '../api/client';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

interface UploadModalProps {
  volumeName: string;
  onClose: () => void;
  onUploadComplete: () => void;
}

function UploadModal({ volumeName, onClose, onUploadComplete }: UploadModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setUploadError(null);
    setUploadSuccess(null);

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    // Check if it's a file or folder
    const firstItem = items[0];
    if (firstItem.webkitGetAsEntry) {
      const entry = firstItem.webkitGetAsEntry();
      if (entry?.isDirectory) {
        // Handle folder drop
        const files = await getAllFilesFromDirectory(entry as FileSystemDirectoryEntry);
        if (files.length > 0) {
          await uploadFiles(files, true);
        }
        return;
      }
    }

    // Handle file drop
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await uploadSingleFile(files[0]);
    }
  };

  const getAllFilesFromDirectory = async (dirEntry: FileSystemDirectoryEntry): Promise<Array<{ file: File; relativePath: string }>> => {
    const files: Array<{ file: File; relativePath: string }> = [];

    const readEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => {
      return new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
    };

    const getFile = (fileEntry: FileSystemFileEntry): Promise<File> => {
      return new Promise((resolve, reject) => {
        fileEntry.file(resolve, reject);
      });
    };

    const processEntry = async (entry: FileSystemEntry, path: string) => {
      if (entry.isFile) {
        const file = await getFile(entry as FileSystemFileEntry);
        files.push({ file, relativePath: path + entry.name });
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        let entries: FileSystemEntry[];
        do {
          entries = await readEntries(reader);
          for (const e of entries) {
            await processEntry(e, path + entry.name + '/');
          }
        } while (entries.length > 0);
      }
    };

    await processEntry(dirEntry, '');
    return files;
  };

  const uploadSingleFile = async (file: File) => {
    setUploadProgress({ loaded: 0, total: 1, percent: 0 });
    try {
      await api.uploadFileToVolume(volumeName, file);
      setUploadSuccess(`Uploaded: ${file.name}`);
      setUploadProgress(null);
      onUploadComplete();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
      setUploadProgress(null);
    }
  };

  const uploadFiles = async (files: Array<{ file: File; relativePath: string }>, isFolder: boolean) => {
    const folderName = isFolder ? files[0]?.relativePath.split('/')[0] || 'folder' : '';
    setUploadProgress({ loaded: 0, total: 1, percent: 0 });

    try {
      await api.uploadDirectoryToVolume(volumeName, files, (progress) => {
        setUploadProgress(progress);
      });
      setUploadSuccess(isFolder ? `Uploaded: ${folderName}/ (${files.length} files)` : `Uploaded ${files.length} files`);
      setUploadProgress(null);
      onUploadComplete();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
      setUploadProgress(null);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadSingleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray: Array<{ file: File; relativePath: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = file.webkitRelativePath || file.name;
      fileArray.push({ file, relativePath });
    }

    await uploadFiles(fileArray, true);
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-[hsl(var(--cyan))]" />
            <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
              Upload to {volumeName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded p-8 text-center transition-colors ${
              isDragging
                ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                : 'border-[hsl(var(--border))] hover:border-[hsl(var(--text-muted))]'
            }`}
          >
            <FolderUp className={`h-10 w-10 mx-auto mb-3 ${isDragging ? 'text-[hsl(var(--cyan))]' : 'text-[hsl(var(--text-muted))]'}`} />
            <p className="text-sm text-[hsl(var(--text-primary))] mb-1">
              Drag & drop files or folders here
            </p>
            <p className="text-xs text-[hsl(var(--text-muted))]">
              or use the buttons below
            </p>
          </div>

          {/* Upload Buttons */}
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
            />
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              onChange={handleFolderSelect}
              {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!!uploadProgress}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] border border-[hsl(var(--border))] disabled:opacity-50"
            >
              <File className="h-4 w-4" />
              Select File
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={!!uploadProgress}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))] border border-[hsl(var(--border))] disabled:opacity-50"
            >
              <Folder className="h-4 w-4" />
              Select Folder
            </button>
          </div>

          {/* Progress */}
          {uploadProgress && (
            <div>
              <div className="flex items-center justify-between text-xs text-[hsl(var(--text-muted))] mb-1">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Uploading...
                </span>
                <span>{uploadProgress.percent}%</span>
              </div>
              <div className="h-1.5 bg-[hsl(var(--bg-base))] rounded overflow-hidden">
                <div
                  className="h-full bg-[hsl(var(--cyan))] transition-all duration-150"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Success Message */}
          {uploadSuccess && (
            <div className="p-3 bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-xs text-[hsl(var(--green))]">
              {uploadSuccess}
            </div>
          )}

          {/* Error Message */}
          {uploadError && (
            <div className="p-3 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-xs text-[hsl(var(--red))]">
              {uploadError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-4 py-3 border-t border-[hsl(var(--border))]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function VolumeManager() {
  const [newVolumeName, setNewVolumeName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [uploadModalVolume, setUploadModalVolume] = useState<string | null>(null);
  const [volumeSizes, setVolumeSizes] = useState<Record<string, number | 'loading'>>({});

  const { data: volumes, isLoading, refetch } = useVolumes();
  const { data: containers } = useContainers();
  const createMutation = useCreateVolume();
  const removeMutation = useRemoveVolume();
  const confirm = useConfirm();

  // Build a map of volume name -> containers using it
  const volumeUsage = useMemo(() => {
    const usage = new Map<string, Array<{ name: string; state: string }>>();

    if (containers) {
      for (const container of containers) {
        for (const vol of container.volumes) {
          const existing = usage.get(vol.name) || [];
          existing.push({ name: container.name, state: container.state });
          usage.set(vol.name, existing);
        }
      }
    }

    return usage;
  }, [containers]);

  // Lazy load volume sizes
  const loadVolumeSize = useCallback(async (volumeName: string) => {
    if (volumeSizes[volumeName] !== undefined) return;

    setVolumeSizes(prev => ({ ...prev, [volumeName]: 'loading' }));
    try {
      const size = await api.getVolumeSize(volumeName);
      setVolumeSizes(prev => ({ ...prev, [volumeName]: size }));
    } catch {
      setVolumeSizes(prev => ({ ...prev, [volumeName]: 0 }));
    }
  }, [volumeSizes]);

  // Load sizes for all volumes when they change
  useEffect(() => {
    if (volumes) {
      for (const volume of volumes) {
        loadVolumeSize(volume.name);
      }
    }
  }, [volumes, loadVolumeSize]);

  // Reset sizes when volumes list changes (e.g., after deletion)
  useEffect(() => {
    if (volumes) {
      const volumeNames = new Set(volumes.map(v => v.name));
      setVolumeSizes(prev => {
        const next: Record<string, number | 'loading'> = {};
        for (const name of Object.keys(prev)) {
          if (volumeNames.has(name)) {
            next[name] = prev[name];
          }
        }
        return next;
      });
    }
  }, [volumes]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVolumeName) return;

    try {
      await createMutation.mutateAsync(newVolumeName);
      setNewVolumeName('');
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to create volume:', error);
    }
  };

  const handleDelete = async (volumeName: string, isInUse: boolean, usedByCount: number) => {
    const confirmed = await confirm({
      title: 'Delete Volume',
      message: isInUse
        ? `Volume "${volumeName}" is in use by ${usedByCount} container(s). Are you sure you want to delete it?`
        : `Are you sure you want to delete volume "${volumeName}"? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: isInUse ? 'warning' : 'danger',
    });

    if (confirmed) {
      await removeMutation.mutateAsync(volumeName);
      // Clear the size cache for this volume
      setVolumeSizes(prev => {
        const next = { ...prev };
        delete next[volumeName];
        return next;
      });
    }
  };

  const handleUploadComplete = () => {
    // Refresh the size for the volume that was uploaded to
    if (uploadModalVolume) {
      setVolumeSizes(prev => {
        const next = { ...prev };
        delete next[uploadModalVolume];
        return next;
      });
      loadVolumeSize(uploadModalVolume);
    }
    refetch();
  };

  const totalSize = useMemo(() => {
    let total = 0;
    for (const size of Object.values(volumeSizes)) {
      if (typeof size === 'number') {
        total += size;
      }
    }
    return total;
  }, [volumeSizes]);

  const allSizesLoaded = useMemo(() => {
    if (!volumes) return true;
    return volumes.every(v => typeof volumeSizes[v.name] === 'number');
  }, [volumes, volumeSizes]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        <div className="flex items-center gap-2">
          {isCreating ? (
            <form onSubmit={handleCreate} className="flex items-center gap-1">
              <input
                type="text"
                value={newVolumeName}
                onChange={(e) => setNewVolumeName(e.target.value)}
                placeholder="volume-name"
                pattern="^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$"
                className="w-40 px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                autoFocus
              />
              <button
                type="submit"
                disabled={createMutation.isPending || !newVolumeName}
                className="px-2 py-1 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
              >
                {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                <X className="h-3 w-3" />
              </button>
            </form>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] border border-dashed border-[hsl(var(--border))] hover:border-[hsl(var(--cyan)/0.5)]"
            >
              <Plus className="h-3 w-3" />
              New Volume
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
          <span>{volumes?.length || 0} volumes</span>
          {volumes && volumes.length > 0 && (
            <>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Database className="h-3 w-3" />
                {allSizesLoaded ? formatSize(totalSize) : <Loader2 className="h-3 w-3 animate-spin" />} total
              </span>
            </>
          )}
        </div>
      </div>

      {/* Volume List */}
      <div className="flex-1 overflow-auto p-4">
        {volumes && volumes.length > 0 ? (
          <div className="grid gap-2">
            {volumes.map((volume) => {
              const usedBy = volumeUsage.get(volume.name) || [];
              const isInUse = usedBy.length > 0;
              const size = volumeSizes[volume.name];

              return (
                <div
                  key={volume.name}
                  className="p-3 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-[hsl(var(--cyan))]" />
                      <div>
                        <span className="text-xs font-medium text-[hsl(var(--text-primary))]">
                          {volume.name}
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--text-muted))]">
                          <span>{volume.driver}</span>
                          <span className="text-[hsl(var(--text-muted))]">•</span>
                          <span className="flex items-center gap-1">
                            <Database className="h-2.5 w-2.5" />
                            {size === 'loading' ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            ) : typeof size === 'number' ? (
                              formatSize(size)
                            ) : (
                              '—'
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setUploadModalVolume(volume.name)}
                        className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))]"
                        title="Upload to volume"
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(volume.name, isInUse, usedBy.length)}
                        disabled={removeMutation.isPending}
                        className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))]"
                        title="Delete volume"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Container Usage */}
                  {isInUse && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {usedBy.map((container) => (
                        <span
                          key={container.name}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] ${
                            container.state === 'running'
                              ? 'bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]'
                              : 'bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))] border border-[hsl(var(--border))]'
                          }`}
                        >
                          <Container className="h-2.5 w-2.5" />
                          {container.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))]">
            <div className="text-center">
              <HardDrive className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-xs uppercase tracking-wider">No volumes yet</p>
              <p className="text-[10px] mt-1 text-[hsl(var(--text-muted))]">Create one to persist data across containers</p>
            </div>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {uploadModalVolume && (
        <UploadModal
          volumeName={uploadModalVolume}
          onClose={() => setUploadModalVolume(null)}
          onUploadComplete={handleUploadComplete}
        />
      )}
    </div>
  );
}
