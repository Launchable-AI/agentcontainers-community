import { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Trash2, Loader2, HardDrive, Container, Upload, File, Folder, X } from 'lucide-react';
import { useVolumes, useCreateVolume, useRemoveVolume, useContainers } from '../hooks/useContainers';
import { useConfirm } from './ConfirmModal';
import * as api from '../api/client';
import type { UploadProgress } from '../api/client';

export function VolumeManager() {
  const [newVolumeName, setNewVolumeName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [uploadingVolume, setUploadingVolume] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{ volume: string; type: 'success' | 'error'; text: string } | null>(null);
  const [showUploadMenu, setShowUploadMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<'above' | 'below'>('below');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const uploadButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const { data: volumes, isLoading } = useVolumes();
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

  // Close upload menu when clicking outside
  useEffect(() => {
    if (!showUploadMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(event.target as Node)) {
        setShowUploadMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUploadMenu]);

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

  const handleUploadClick = (volumeName: string) => {
    if (showUploadMenu === volumeName) {
      setShowUploadMenu(null);
    } else {
      const button = uploadButtonRefs.current.get(volumeName);
      if (button) {
        const buttonRect = button.getBoundingClientRect();
        const spaceBelow = window.innerHeight - buttonRect.bottom;
        const menuHeight = 90;
        setMenuPosition(spaceBelow < menuHeight ? 'above' : 'below');
      }
      setShowUploadMenu(volumeName);
    }
  };

  const handleFileUploadClick = (volumeName: string) => {
    setUploadingVolume(volumeName);
    setShowUploadMenu(null);
    fileInputRef.current?.click();
  };

  const handleFolderUploadClick = (volumeName: string) => {
    setUploadingVolume(volumeName);
    setShowUploadMenu(null);
    folderInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingVolume) return;

    try {
      await api.uploadFileToVolume(uploadingVolume, file);
      setUploadMessage({ volume: uploadingVolume, type: 'success', text: `Uploaded: ${file.name}` });
      setTimeout(() => setUploadMessage(null), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setUploadMessage({ volume: uploadingVolume, type: 'error', text: message });
    } finally {
      setUploadingVolume(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !uploadingVolume) return;

    try {
      const fileArray: Array<{ file: globalThis.File; relativePath: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relativePath = file.webkitRelativePath || file.name;
        fileArray.push({ file, relativePath });
      }

      const folderName = fileArray[0]?.relativePath.split('/')[0] || 'folder';

      setUploadProgress({ loaded: 0, total: 1, percent: 0 });

      await api.uploadDirectoryToVolume(uploadingVolume, fileArray, (progress) => {
        setUploadProgress(progress);
      });

      setUploadMessage({
        volume: uploadingVolume,
        type: 'success',
        text: `Uploaded: ${folderName}/ (${fileArray.length} files)`
      });
      setTimeout(() => setUploadMessage(null), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setUploadMessage({ volume: uploadingVolume, type: 'error', text: message });
    } finally {
      setUploadingVolume(null);
      setUploadProgress(null);
      if (folderInputRef.current) {
        folderInputRef.current.value = '';
      }
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Hidden inputs */}
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
        <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
          {volumes?.length || 0} volumes
        </div>
      </div>

      {/* Volume List */}
      <div className="flex-1 overflow-auto p-4">
        {volumes && volumes.length > 0 ? (
          <div className="grid gap-2">
            {volumes.map((volume) => {
              const usedBy = volumeUsage.get(volume.name) || [];
              const isInUse = usedBy.length > 0;

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
                        <p className="text-[10px] text-[hsl(var(--text-muted))]">
                          {volume.driver}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="relative" ref={showUploadMenu === volume.name ? uploadMenuRef : undefined}>
                        <button
                          ref={(el) => {
                            if (el) uploadButtonRefs.current.set(volume.name, el);
                          }}
                          onClick={() => handleUploadClick(volume.name)}
                          disabled={uploadingVolume === volume.name}
                          className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))]"
                          title="Upload to volume"
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </button>
                        {showUploadMenu === volume.name && (
                          <div className={`absolute right-0 z-10 bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] shadow-lg py-1 min-w-[120px] ${
                            menuPosition === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
                          }`}>
                            <button
                              onClick={() => handleFileUploadClick(volume.name)}
                              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))]"
                            >
                              <File className="h-3 w-3" />
                              File
                            </button>
                            <button
                              onClick={() => handleFolderUploadClick(volume.name)}
                              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-overlay))]"
                            >
                              <Folder className="h-3 w-3" />
                              Folder
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          const confirmed = await confirm({
                            title: 'Delete Volume',
                            message: isInUse
                              ? `Volume "${volume.name}" is in use by ${usedBy.length} container(s). Are you sure you want to delete it?`
                              : `Are you sure you want to delete volume "${volume.name}"? This action cannot be undone.`,
                            confirmText: 'Delete',
                            variant: isInUse ? 'warning' : 'danger',
                          });
                          if (confirmed) {
                            removeMutation.mutate(volume.name);
                          }
                        }}
                        disabled={removeMutation.isPending}
                        className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))]"
                        title="Delete volume"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Upload Progress */}
                  {uploadingVolume === volume.name && uploadProgress && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[10px] text-[hsl(var(--text-muted))] mb-1">
                        <span>Uploading...</span>
                        <span>{uploadProgress.percent}%</span>
                      </div>
                      <div className="h-1 bg-[hsl(var(--bg-base))] overflow-hidden">
                        <div
                          className="h-full bg-[hsl(var(--cyan))] transition-all duration-150"
                          style={{ width: `${uploadProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Upload Message */}
                  {uploadMessage?.volume === volume.name && (
                    <p className={`mt-2 text-[10px] ${
                      uploadMessage.type === 'success' ? 'text-[hsl(var(--green))]' : 'text-[hsl(var(--red))]'
                    }`}>
                      {uploadMessage.text}
                    </p>
                  )}

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
    </div>
  );
}
