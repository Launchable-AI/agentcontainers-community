import { useState, useRef } from 'react';
import { Upload, File, Folder, X, Loader2, FolderUp } from 'lucide-react';
import * as api from '../api/client';
import type { UploadProgress } from '../api/client';

interface UploadModalProps {
  volumeName: string;
  onClose: () => void;
  onUploadComplete?: () => void;
}

export function UploadModal({ volumeName, onClose, onUploadComplete }: UploadModalProps) {
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
      onUploadComplete?.();
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
      onUploadComplete?.();
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
