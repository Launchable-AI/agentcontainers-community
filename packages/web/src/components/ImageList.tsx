import { useState } from 'react';
import { Trash2, Image, Loader2, HardDrive } from 'lucide-react';
import { useImages } from '../hooks/useContainers';
import { useConfirm } from './ConfirmModal';
import * as api from '../api/client';

export function ImageList() {
  const { data: images, isLoading, refetch } = useImages();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirm = useConfirm();

  const handleDelete = async (id: string, tag: string) => {
    const confirmed = await confirm({
      title: 'Delete Image',
      message: `Are you sure you want to delete "${tag}"? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    setDeletingId(id);
    try {
      await api.removeImage(id);
      refetch();
    } catch (error) {
      console.error('Failed to delete image:', error);
    }
    setDeletingId(null);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  if (!images || images.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))]">
        <div className="text-center">
          <Image className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-xs uppercase tracking-wider">No images</p>
          <p className="text-[10px] mt-1 text-[hsl(var(--text-muted))]">Build a Dockerfile to create an image</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
          Built Images
        </div>
        <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
          {images.length} images
        </div>
      </div>

      {/* Image List */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-2">
          {images.map((image) => {
            const tag = image.repoTags[0] || 'untagged';
            const isDeleting = deletingId === image.id;

            return (
              <div
                key={image.id}
                className="p-3 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Image className="h-4 w-4 text-[hsl(var(--cyan))] flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-[hsl(var(--text-primary))] truncate block">
                        {tag}
                      </span>
                      <span className="text-[10px] text-[hsl(var(--text-muted))] font-mono">
                        {image.id.replace('sha256:', '').substring(0, 12)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(image.id, tag)}
                    disabled={isDeleting}
                    className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50"
                    title="Delete image"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-4 text-[10px] text-[hsl(var(--text-muted))]">
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {formatSize(image.size)}
                  </span>
                  <span>{formatDate(image.created)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
