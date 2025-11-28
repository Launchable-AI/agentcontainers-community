import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Save, Trash2, Plus, FileCode, Loader2, Hammer, X, Minimize2, Maximize2 } from 'lucide-react';
import { useDockerfiles } from '../hooks/useContainers';
import * as api from '../api/client';

const DEFAULT_DOCKERFILE = `FROM ubuntu:24.04

# Install packages
RUN apt-get update && apt-get install -y \\
    openssh-server \\
    sudo \\
    curl \\
    wget \\
    git \\
    vim \\
    build-essential \\
    python3 \\
    python3-pip \\
    python3-venv \\
    nodejs \\
    npm \\
    && rm -rf /var/lib/apt/lists/* \\
    && mkdir -p /var/run/sshd

# Create non-root user with sudo access
RUN useradd -m -s /bin/bash dev \\
    && echo 'dev ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Configure SSH for key-based auth only
RUN sed -i 's/#PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config \\
    && sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config

# Setup SSH key ({{PUBLIC_KEY}} is replaced at build time)
RUN mkdir -p /home/dev/.ssh \\
    && chmod 700 /home/dev/.ssh \\
    && echo '{{PUBLIC_KEY}}' > /home/dev/.ssh/authorized_keys \\
    && chmod 600 /home/dev/.ssh/authorized_keys \\
    && chown -R dev:dev /home/dev/.ssh

# Add ~/.local/bin to PATH for pip-installed tools
RUN echo 'export PATH="\$HOME/.local/bin:\$PATH"' >> /home/dev/.bashrc

# Set working directory
RUN mkdir -p /home/dev/workspace && chown dev:dev /home/dev/workspace
WORKDIR /home/dev/workspace

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
`;

const DEFAULT_FILE_ID = '__default__';

export function DockerfileEditor() {
  const [selectedFile, setSelectedFile] = useState<string | null>(DEFAULT_FILE_ID);
  const [content, setContent] = useState(DEFAULT_DOCKERFILE);
  const isDefaultSelected = selectedFile === DEFAULT_FILE_ID;
  const [newFileName, setNewFileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [isBuildMinimized, setIsBuildMinimized] = useState(false);
  const [buildResult, setBuildResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const { data: files, refetch } = useDockerfiles();

  useEffect(() => {
    if (selectedFile === DEFAULT_FILE_ID) {
      setContent(DEFAULT_DOCKERFILE);
    } else if (selectedFile) {
      api.getDockerfile(selectedFile).then((result) => {
        setContent(result.content);
      });
    }
  }, [selectedFile]);

  const handleUseAsTemplate = () => {
    setIsCreating(true);
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    try {
      await api.saveDockerfile(selectedFile, content);
      refetch();
    } catch (error) {
      console.error('Failed to save:', error);
    }
    setIsSaving(false);
  };

  const handleCreate = async () => {
    if (!newFileName) return;
    setIsSaving(true);
    try {
      await api.saveDockerfile(newFileName, DEFAULT_DOCKERFILE);
      setSelectedFile(newFileName);
      setContent(DEFAULT_DOCKERFILE);
      setNewFileName('');
      setIsCreating(false);
      refetch();
    } catch (error) {
      console.error('Failed to create:', error);
    }
    setIsSaving(false);
  };

  const handleDelete = async () => {
    if (!selectedFile) return;
    if (!confirm(`Delete "${selectedFile}"?`)) return;

    setIsDeleting(true);
    try {
      await api.deleteDockerfile(selectedFile);
      setSelectedFile(null);
      setContent(DEFAULT_DOCKERFILE);
      refetch();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
    setIsDeleting(false);
  };

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buildLogs]);

  const handleBuild = async () => {
    if (!selectedFile) return;

    setIsBuilding(true);
    setBuildLogs([]);
    setBuildResult(null);
    setShowBuildModal(true);
    setIsBuildMinimized(false);

    try {
      await api.buildDockerfile(
        selectedFile,
        (log) => {
          setBuildLogs((prev) => [...prev, log]);
        },
        (tag) => {
          setBuildResult({ type: 'success', message: `Image built successfully: ${tag}` });
          setIsBuilding(false);
        },
        (error) => {
          setBuildResult({ type: 'error', message: error });
          setIsBuilding(false);
        }
      );
    } catch {
      setIsBuilding(false);
    }
  };

  return (
    <div className="rounded-lg border bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3 dark:border-gray-700">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <FileCode className="h-5 w-5" />
          Dockerfiles
        </h3>
        <div className="flex items-center gap-2">
          {isDefaultSelected ? (
            <button
              onClick={handleUseAsTemplate}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Use as Template
            </button>
          ) : selectedFile && (
            <>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
              <button
                onClick={handleBuild}
                disabled={isBuilding}
                className="flex items-center gap-1 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                title="Build image from this Dockerfile"
              >
                {isBuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
                Build
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Dockerfile Cards */}
      <div className="flex flex-wrap gap-2 p-4 border-b dark:border-gray-700">
        {/* Default template card */}
        <button
          onClick={() => setSelectedFile(DEFAULT_FILE_ID)}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            isDefaultSelected
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          <FileCode className="h-4 w-4" />
          default
          <span className="text-xs opacity-70">(template)</span>
        </button>

        {/* User's dockerfiles */}
        {files?.map((file) => (
          <button
            key={file}
            onClick={() => setSelectedFile(file)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              selectedFile === file
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            <FileCode className="h-4 w-4" />
            {file}
          </button>
        ))}

        {/* New Dockerfile Button/Input */}
        {isCreating ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              placeholder="name"
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={!newFileName || isSaving}
              className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setNewFileName('');
              }}
              className="rounded-lg px-2 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 hover:border-blue-500 hover:text-blue-500 dark:border-gray-600 dark:text-gray-400"
          >
            <Plus className="h-4 w-4" />
            New
          </button>
        )}
      </div>

      {/* Editor */}
      <div className="h-[calc(100vh-480px)] min-h-[300px]">
        <Editor
          height="100%"
          defaultLanguage="dockerfile"
          value={content}
          onChange={(value) => !isDefaultSelected && setContent(value || '')}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            readOnly: isDefaultSelected,
          }}
        />
      </div>

      {/* Build Log Modal - Minimized */}
      {showBuildModal && isBuildMinimized && (
        <div className="fixed bottom-4 right-4 z-50">
          <button
            onClick={() => setIsBuildMinimized(false)}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg transition-colors ${
              buildResult?.type === 'error'
                ? 'bg-red-900 text-red-100 hover:bg-red-800'
                : buildResult?.type === 'success'
                ? 'bg-green-900 text-green-100 hover:bg-green-800'
                : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            <Hammer className="h-5 w-5" />
            <span className="font-medium">
              {isBuilding ? 'Building...' : buildResult?.type === 'success' ? 'Build Complete' : 'Build Failed'}
            </span>
            {isBuilding && <Loader2 className="h-4 w-4 animate-spin" />}
            <Maximize2 className="h-4 w-4 ml-2 opacity-60" />
          </button>
        </div>
      )}

      {/* Build Log Modal - Expanded */}
      {showBuildModal && !isBuildMinimized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-3xl mx-4 rounded-lg bg-gray-900 shadow-xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Hammer className="h-5 w-5" />
                Building Image
                {isBuilding && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsBuildMinimized(true)}
                  className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
                  title="Minimize"
                >
                  <Minimize2 className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setShowBuildModal(false)}
                  disabled={isBuilding}
                  className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-50"
                  title={isBuilding ? 'Cannot close while building' : 'Close'}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 font-mono text-sm">
              <pre className="text-gray-300 whitespace-pre-wrap">
                {buildLogs.map((log, i) => (
                  <span key={i}>{log}</span>
                ))}
              </pre>
              <div ref={logsEndRef} />
            </div>

            {buildResult && (
              <div
                className={`px-4 py-3 border-t border-gray-700 ${
                  buildResult.type === 'success'
                    ? 'bg-green-900/30 text-green-400'
                    : 'bg-red-900/30 text-red-400'
                }`}
              >
                {buildResult.message}
              </div>
            )}

            {!isBuilding && (
              <div className="px-4 py-3 border-t border-gray-700 flex justify-end">
                <button
                  onClick={() => setShowBuildModal(false)}
                  className="rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
