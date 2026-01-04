import { useState, useEffect } from 'react';
import {
  Play,
  Square,
  Trash2,
  Terminal as TerminalIcon,
  Copy,
  Check,
  Download,
  HardDrive,
  Globe,
  Settings,
  ExternalLink,
  Circle,
  TerminalSquare,
  Loader2,
  Upload,
  AlertCircle,
  X,
  ScrollText,
} from 'lucide-react';
import type { ContainerInfo } from '../api/client';
import { downloadSshKey } from '../api/client';
import {
  useStartContainer,
  useStopContainer,
  useRemoveContainer,
  useConfig,
} from '../hooks/useContainers';
import { ReconfigureModal } from './ReconfigureModal';
import { Terminal } from './Terminal';
import { useConfirm } from './ConfirmModal';
import { UploadModal } from './UploadModal';
import { LogViewer } from './LogViewer';

interface ContainerCardProps {
  container: ContainerInfo;
}

type ConnectionMode = 'docker' | 'ssh';

export function ContainerCard({ container }: ContainerCardProps) {
  const [copied, setCopied] = useState(false);
  const [showReconfigure, setShowReconfigure] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('docker');
  const [uploadVolume, setUploadVolume] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startMutation = useStartContainer();
  const stopMutation = useStopContainer();
  const removeMutation = useRemoveContainer();
  const { data: config } = useConfig();
  const confirm = useConfirm();

  // Track mutation errors
  useEffect(() => {
    if (startMutation.error) {
      setError(startMutation.error.message || 'Failed to start container');
    } else if (stopMutation.error) {
      setError(stopMutation.error.message || 'Failed to stop container');
    } else if (removeMutation.error) {
      setError(removeMutation.error.message || 'Failed to remove container');
    }
  }, [startMutation.error, stopMutation.error, removeMutation.error]);

  const sshKeysPath = config?.sshKeysDisplayPath || '~/.ssh';
  const sshHost = config?.sshHost || 'localhost';
  const sshJumpHost = config?.sshJumpHost || '';
  const isRunning = container.state === 'running';
  const isBuilding = container.state === 'building';
  const isFailed = container.state === 'failed';
  const isPending =
    startMutation.isPending || stopMutation.isPending || removeMutation.isPending;

  const dockerCommand = `docker exec -it -u dev -w /home/dev/workspace ${container.name} /bin/bash`;
  const sshCommand = container.sshPort
    ? `ssh${sshJumpHost ? ` -J ${sshJumpHost}` : ''} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i ${sshKeysPath}/acm.pem -p ${container.sshPort} dev@${sshHost}`
    : null;
  const currentCommand = connectionMode === 'docker' ? dockerCommand : sshCommand;

  const handleCopyCommand = async () => {
    if (!currentCommand) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentCommand);
      } else {
        // Fallback for non-secure contexts (HTTP)
        const textArea = document.createElement('textarea');
        textArea.value = currentCommand;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDownloadKey = async () => {
    try {
      const blob = await downloadSshKey(container.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'acm.pem';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download SSH key:', error);
    }
  };

  const stateConfig: Record<string, { color: string; label: string }> = {
    running: { color: 'green', label: 'Running' },
    exited: { color: 'red', label: 'Exited' },
    created: { color: 'amber', label: 'Created' },
    paused: { color: 'amber', label: 'Paused' },
    stopped: { color: 'text-muted', label: 'Stopped' },
    building: { color: 'cyan', label: 'Building' },
    failed: { color: 'red', label: 'Failed' },
  };

  const currentState = stateConfig[container.state] || stateConfig.stopped;
  const stateColorVar = currentState.color === 'text-muted' ? 'text-muted' : currentState.color;

  return (
    <div className="border border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-[hsl(var(--border))]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <Circle className={`h-2 w-2 fill-current flex-shrink-0 ${
                stateColorVar === 'text-muted'
                  ? 'text-[hsl(var(--text-muted))]'
                  : `text-[hsl(var(--${stateColorVar}))]`
              } ${container.state === 'building' ? 'animate-pulse' : ''}`} />
              <h3 className="text-xs font-medium text-[hsl(var(--text-primary))] truncate">
                {container.name}
              </h3>
              <span className={`text-[10px] uppercase tracking-wider ${
                stateColorVar === 'text-muted'
                  ? 'text-[hsl(var(--text-muted))]'
                  : `text-[hsl(var(--${stateColorVar}))]`
              }`}>
                {currentState.label}
              </span>
            </div>
            <p className="text-[10px] text-[hsl(var(--text-muted))] truncate">
              {container.image}
            </p>
          </div>

          {!isBuilding && (
            <div className="flex items-center gap-0.5">
              {isRunning && (
                <>
                  <button
                    onClick={() => setShowTerminal(true)}
                    className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                    title="Open Terminal"
                  >
                    <TerminalSquare className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setShowLogs(true)}
                    className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                    title="View Logs"
                  >
                    <ScrollText className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
              {isRunning ? (
                <button
                  onClick={() => {
                    setError(null);
                    stopMutation.mutate(container.id);
                  }}
                  disabled={isPending}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                  title="Stop"
                >
                  {stopMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : !isFailed && (
                <button
                  onClick={() => {
                    setError(null);
                    startMutation.mutate(container.id);
                  }}
                  disabled={isPending}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                  title="Start"
                >
                  {startMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {!isFailed && (
                <button
                  onClick={() => setShowReconfigure(true)}
                  disabled={isPending}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                  title="Reconfigure"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={async () => {
                  const confirmed = await confirm({
                    title: 'Delete Container',
                    message: `Are you sure you want to delete "${container.name}"? This action cannot be undone.`,
                    confirmText: 'Delete',
                    variant: 'danger',
                  });
                  if (confirmed) {
                    removeMutation.mutate(container.id);
                  }
                }}
                disabled={isPending}
                className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                title="Remove"
              >
                {removeMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-3 mt-2.5 p-2 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-[hsl(var(--red))] flex-shrink-0 mt-0.5" />
          <p className="flex-1 min-w-0 text-[10px] text-[hsl(var(--red))] break-words">{error}</p>
          <button
            onClick={() => setError(null)}
            className="p-0.5 text-[hsl(var(--red))] hover:text-[hsl(var(--red)/0.7)] transition-colors flex-shrink-0"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="px-3 py-2.5 space-y-3">
        {/* Connection Command */}
        {isRunning && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                <TerminalIcon className="h-3 w-3" />
                <span>Connect</span>
              </div>
              {container.sshPort && (
                <div className="flex items-center gap-0.5 text-[10px]">
                  <button
                    onClick={() => setConnectionMode('docker')}
                    className={`px-1.5 py-0.5 transition-colors ${
                      connectionMode === 'docker'
                        ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                        : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]'
                    }`}
                  >
                    Docker
                  </button>
                  <button
                    onClick={() => setConnectionMode('ssh')}
                    className={`px-1.5 py-0.5 transition-colors ${
                      connectionMode === 'ssh'
                        ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                        : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]'
                    }`}
                  >
                    SSH
                  </button>
                </div>
              )}
            </div>
            <div className="bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] text-[hsl(var(--text-secondary))] truncate">
                  {currentCommand}
                </code>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={handleCopyCommand}
                    className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
                    title="Copy command"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-[hsl(var(--green))]" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                  {connectionMode === 'ssh' && (
                    <button
                      onClick={handleDownloadKey}
                      className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
                      title="Download SSH key"
                    >
                      <Download className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Ports & Volumes Row */}
        {(container.ports.length > 0 || container.volumes.length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {/* Ports */}
            {container.ports && container.ports.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                  <Globe className="h-3 w-3" />
                  <span>Ports</span>
                </div>
                <div className="space-y-1">
                  {container.ports.map((port) => (
                    <a
                      key={`${port.host}-${port.container}`}
                      href={`http://localhost:${port.host}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan)/0.8)] transition-colors group"
                    >
                      <span>:{port.host}</span>
                      <span className="text-[hsl(var(--text-muted))]">→</span>
                      <span className="text-[hsl(var(--text-muted))]">:{port.container}</span>
                      <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Volumes */}
            {container.volumes.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                  <HardDrive className="h-3 w-3" />
                  <span>Volumes</span>
                </div>
                <div className="space-y-1">
                  {container.volumes.map((vol) => (
                    <div
                      key={vol.name}
                      className="flex items-center gap-1.5 text-[10px] group"
                    >
                      <span className="text-[hsl(var(--text-primary))]">{vol.name}</span>
                      <span className="text-[hsl(var(--text-muted))]">→</span>
                      <span className="text-[hsl(var(--text-muted))] truncate flex-1">{vol.mountPath}</span>
                      <button
                        onClick={() => setUploadVolume(vol.name)}
                        className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Upload files to volume"
                      >
                        <Upload className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 bg-[hsl(var(--bg-base))] border-t border-[hsl(var(--border))]">
        <p className="text-[10px] text-[hsl(var(--text-muted))]">
          {container.status}
        </p>
      </div>

      {/* Reconfigure Modal */}
      {showReconfigure && (
        <ReconfigureModal
          container={container}
          onClose={() => setShowReconfigure(false)}
        />
      )}

      {/* Terminal - standalone containers are always dev containers */}
      {showTerminal && (
        <Terminal
          containerId={container.id}
          containerName={container.name}
          onClose={() => setShowTerminal(false)}
          isDevNode={true}
        />
      )}

      {/* Upload Modal */}
      {uploadVolume && (
        <UploadModal
          volumeName={uploadVolume}
          onClose={() => setUploadVolume(null)}
        />
      )}

      {/* Log Viewer */}
      {showLogs && (
        <LogViewer
          containerId={container.id}
          title={container.name}
          onClose={() => setShowLogs(false)}
        />
      )}
    </div>
  );
}
