import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import {
  Save,
  Trash2,
  Plus,
  FileCode,
  Loader2,
  Hammer,
  X,
  Minimize2,
  Maximize2,
  Sparkles,
  Send,
  PanelRightClose,
  PanelRightOpen,
  Check,
  Copy,
  RotateCcw,
} from 'lucide-react';
import { useDockerfiles } from '../hooks/useContainers';
import { useConfirm } from './ConfirmModal';
import * as api from '../api/client';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

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
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/dev/.bashrc

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
  const chatEndRef = useRef<HTMLDivElement>(null);

  // AI Panel state
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [copiedCode, setCopiedCode] = useState<number | null>(null);

  const { data: files, refetch } = useDockerfiles();
  const confirm = useConfirm();

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
    const confirmed = await confirm({
      title: 'Delete Dockerfile',
      message: `Are you sure you want to delete "${selectedFile}"? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

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

  // Auto-scroll chat
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Check AI status on mount
  useEffect(() => {
    api.getAIStatus().then((status) => {
      setAiConfigured(status.configured);
    }).catch(() => {
      setAiConfigured(false);
    });
  }, []);

  // Extract Dockerfile code block from AI response
  const extractDockerfileFromResponse = (response: string): string | null => {
    const match = response.match(/```(?:dockerfile|Dockerfile)?\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
  };

  // Handle sending chat message
  const handleSendChat = async () => {
    if (!chatInput.trim() || isStreaming) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsStreaming(true);

    // Add empty assistant message that will be streamed into
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      await api.streamDockerfileChat(
        userMessage,
        content,
        (chunk) => {
          setChatMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { ...lastMsg, content: lastMsg.content + chunk }
              ];
            }
            return prev;
          });
        },
        () => {
          setIsStreaming(false);
        },
        (error) => {
          setChatMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { ...lastMsg, content: `Error: ${error}` }
              ];
            }
            return prev;
          });
          setIsStreaming(false);
        }
      );
    } catch {
      setIsStreaming(false);
    }
  };

  // Apply Dockerfile from AI response to editor
  const handleApplyDockerfile = (dockerfile: string) => {
    setContent(dockerfile);
  };

  // Copy code to clipboard
  const handleCopyCode = async (code: string, index: number) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(index);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Render message content with syntax-highlighted code blocks
  const renderMessageContent = (msgContent: string) => {
    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(msgContent)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: msgContent.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', content: match[2], language: match[1] || 'plaintext' });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < msgContent.length) {
      parts.push({ type: 'text', content: msgContent.slice(lastIndex) });
    }

    return parts.map((part, idx) => {
      if (part.type === 'code') {
        return (
          <div key={idx} className="my-2 overflow-hidden border border-[hsl(var(--border-highlight))]">
            <div className="flex items-center justify-between px-2.5 py-1 bg-[hsl(var(--bg-base))] text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
              <span>{part.language}</span>
            </div>
            <pre className="p-2.5 bg-[hsl(var(--bg-surface))] overflow-x-auto text-xs leading-relaxed">
              <code className="text-[hsl(var(--text-primary))]">{part.content}</code>
            </pre>
          </div>
        );
      }
      return (
        <span key={idx} className="whitespace-pre-wrap">{part.content}</span>
      );
    });
  };

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
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        <div className="flex items-center gap-2">
          {/* File selector */}
          <div className="flex items-center gap-1">
            {/* Default template */}
            <button
              onClick={() => setSelectedFile(DEFAULT_FILE_ID)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-all ${
                isDefaultSelected
                  ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.3)]'
                  : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-transparent'
              }`}
            >
              <FileCode className="h-3 w-3" />
              default
              <span className="text-[10px] text-[hsl(var(--text-muted))]">(template)</span>
            </button>

            {/* User's dockerfiles */}
            {files?.map((file) => (
              <button
                key={file}
                onClick={() => setSelectedFile(file)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-all ${
                  selectedFile === file
                    ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.3)]'
                    : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-transparent'
                }`}
              >
                <FileCode className="h-3 w-3" />
                {file}
              </button>
            ))}

            {/* New Dockerfile */}
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
                  className="w-24 px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
                  autoFocus
                />
                <button
                  onClick={handleCreate}
                  disabled={!newFileName || isSaving}
                  className="px-2 py-1 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
                </button>
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewFileName('');
                  }}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] border border-dashed border-[hsl(var(--border))] hover:border-[hsl(var(--cyan)/0.5)]"
              >
                <Plus className="h-3 w-3" />
                New
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* AI Toggle */}
          {selectedFile && !isDefaultSelected && (
            <button
              onClick={() => aiConfigured && setIsAIPanelOpen(!isAIPanelOpen)}
              disabled={!aiConfigured}
              title={!aiConfigured ? 'Set OPENROUTER_API_KEY in .env.local to enable AI' : 'AI Assistant'}
              className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                !aiConfigured
                  ? 'text-[hsl(var(--text-muted))] cursor-not-allowed'
                  : isAIPanelOpen
                  ? 'bg-[hsl(var(--purple)/0.2)] text-[hsl(var(--purple))] border border-[hsl(var(--purple)/0.3)]'
                  : 'text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.1)] border border-[hsl(var(--purple)/0.3)]'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              AI
              {isAIPanelOpen ? <PanelRightClose className="h-3 w-3" /> : <PanelRightOpen className="h-3 w-3" />}
            </button>
          )}

          {/* Action Buttons */}
          {isDefaultSelected ? (
            <button
              onClick={handleUseAsTemplate}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)]"
            >
              <Plus className="h-3 w-3" />
              Use as Template
            </button>
          ) : selectedFile && (
            <>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </button>
              <button
                onClick={handleBuild}
                disabled={isBuilding}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[hsl(var(--amber))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--amber)/0.9)] disabled:opacity-50"
                title="Build image from this Dockerfile"
              >
                {isBuilding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Hammer className="h-3 w-3" />}
                Build
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)]"
              >
                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor */}
        <div className="flex-1 min-w-0">
          <Editor
            height="100%"
            defaultLanguage="dockerfile"
            value={content}
            onChange={(value) => !isDefaultSelected && setContent(value || '')}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              readOnly: isDefaultSelected,
              padding: { top: 12, bottom: 12 },
              renderLineHighlight: 'gutter',
              cursorBlinking: 'smooth',
            }}
          />
        </div>

        {/* AI Side Panel */}
        {isAIPanelOpen && selectedFile && !isDefaultSelected && (
          <div className="w-96 flex flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))] animate-slide-in">
            {/* AI Panel Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))]">
              <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--purple))]">
                <Sparkles className="h-4 w-4" />
                AI Assistant
              </div>
              <div className="flex items-center gap-1">
                {chatMessages.length > 0 && (
                  <button
                    onClick={() => setChatMessages([])}
                    disabled={isStreaming}
                    className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50"
                    title="Clear chat"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => setIsAIPanelOpen(false)}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                >
                  <PanelRightClose className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <Sparkles className="h-8 w-8 mx-auto mb-3 text-[hsl(var(--purple)/0.3)]" />
                  <p className="text-xs text-[hsl(var(--text-secondary))]">Ask me to modify your Dockerfile</p>
                  <p className="text-[10px] mt-1 text-[hsl(var(--text-muted))]">e.g., "Add Node.js" or "Install Python 3.12"</p>
                </div>
              )}
              {chatMessages.map((msg, i) => {
                const isLastAssistantMessage = msg.role === 'assistant' && i === chatMessages.length - 1;
                const shouldRenderMarkdown = msg.role === 'assistant' && !(isStreaming && isLastAssistantMessage);

                return (
                <div
                  key={i}
                  className={`p-2.5 text-xs ${
                    msg.role === 'user'
                      ? 'bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.2)] ml-6'
                      : 'bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] mr-6'
                  }`}
                >
                  <div className="text-[hsl(var(--text-primary))]">
                    {shouldRenderMarkdown
                      ? renderMessageContent(msg.content)
                      : <span className="whitespace-pre-wrap">{msg.content}</span>}
                  </div>
                  {msg.role === 'assistant' && !isStreaming && msg.content && (() => {
                    const dockerfile = extractDockerfileFromResponse(msg.content);
                    if (dockerfile) {
                      return (
                        <div className="mt-2.5 flex gap-2">
                          <button
                            onClick={() => handleCopyCode(dockerfile, i)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
                          >
                            {copiedCode === i ? (
                              <>
                                <Check className="h-3 w-3 text-[hsl(var(--green))]" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                Copy
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleApplyDockerfile(dockerfile)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--purple)/0.9)]"
                          >
                            <Check className="h-3 w-3" />
                            Apply
                          </button>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              );
              })}
              {isStreaming && (
                <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Processing...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-3 border-t border-[hsl(var(--border))]">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  placeholder="Ask AI to modify Dockerfile..."
                  disabled={isStreaming}
                  className="flex-1 px-2.5 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] disabled:opacity-50"
                />
                <button
                  onClick={handleSendChat}
                  disabled={isStreaming || !chatInput.trim()}
                  className="px-2.5 py-1.5 bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--purple)/0.9)] disabled:opacity-50"
                >
                  {isStreaming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Build Log Modal - Minimized */}
      {showBuildModal && isBuildMinimized && (
        <div className="fixed bottom-4 right-4 z-50">
          <button
            onClick={() => setIsBuildMinimized(false)}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-medium shadow-lg transition-colors ${
              buildResult?.type === 'error'
                ? 'bg-[hsl(var(--red))] text-white'
                : buildResult?.type === 'success'
                ? 'bg-[hsl(var(--green))] text-[hsl(var(--bg-base))]'
                : 'bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]'
            }`}
          >
            <Hammer className="h-4 w-4" />
            <span>
              {isBuilding ? 'Building...' : buildResult?.type === 'success' ? 'Build Complete' : 'Build Failed'}
            </span>
            {isBuilding && <Loader2 className="h-3 w-3 animate-spin" />}
            <Maximize2 className="h-3 w-3 ml-1 opacity-60" />
          </button>
        </div>
      )}

      {/* Build Log Modal - Expanded */}
      {showBuildModal && !isBuildMinimized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-3xl mx-4 flex flex-col max-h-[80vh] bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--border))]">
              <h3 className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--text-primary))] uppercase tracking-wider">
                <Hammer className="h-4 w-4" />
                Building Image
                {isBuilding && <Loader2 className="h-3 w-3 animate-spin ml-2" />}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsBuildMinimized(true)}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowBuildModal(false)}
                  disabled={isBuilding}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-[hsl(var(--bg-base))]">
              <pre className="text-xs text-[hsl(var(--text-secondary))] whitespace-pre-wrap leading-relaxed">
                {buildLogs.map((log, i) => (
                  <span key={i}>{log}</span>
                ))}
              </pre>
              <div ref={logsEndRef} />
            </div>

            {buildResult && (
              <div
                className={`px-4 py-2.5 text-xs border-t ${
                  buildResult.type === 'success'
                    ? 'bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border-[hsl(var(--green)/0.2)]'
                    : 'bg-[hsl(var(--red)/0.1)] text-[hsl(var(--red))] border-[hsl(var(--red)/0.2)]'
                }`}
              >
                {buildResult.message}
              </div>
            )}

            {!isBuilding && (
              <div className="px-4 py-2.5 border-t border-[hsl(var(--border))] flex justify-end">
                <button
                  onClick={() => setShowBuildModal(false)}
                  className="px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))]"
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
