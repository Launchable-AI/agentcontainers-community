import { useState } from 'react';
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

interface ContainerCardProps {
  container: ContainerInfo;
}

export function ContainerCard({ container }: ContainerCardProps) {
  const [copied, setCopied] = useState(false);
  const [showReconfigure, setShowReconfigure] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const startMutation = useStartContainer();
  const stopMutation = useStopContainer();
  const removeMutation = useRemoveContainer();
  const { data: config } = useConfig();
  const confirm = useConfirm();

  const sshKeysPath = config?.sshKeysDisplayPath || '~/.ssh';
  const isRunning = container.state === 'running';
  const isBuilding = container.state === 'building';
  const isFailed = container.state === 'failed';
  const isPending =
    startMutation.isPending || stopMutation.isPending || removeMutation.isPending;

  const sshCommand = container.sshPort
    ? `ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i ${sshKeysPath}/acm.pem -p ${container.sshPort} dev@localhost`
    : null;

  const handleCopyCommand = async () => {
    if (sshCommand) {
      await navigator.clipboard.writeText(sshCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
                <button
                  onClick={() => setShowTerminal(true)}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
                  title="Open Terminal"
                >
                  <TerminalSquare className="h-3.5 w-3.5" />
                </button>
              )}
              {isRunning ? (
                <button
                  onClick={() => stopMutation.mutate(container.id)}
                  disabled={isPending}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                  title="Stop"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : !isFailed && (
                <button
                  onClick={() => startMutation.mutate(container.id)}
                  disabled={isPending}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 transition-colors"
                  title="Start"
                >
                  <Play className="h-3.5 w-3.5" />
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
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-3">
        {/* SSH Connection */}
        {container.sshPort && sshCommand && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
              <TerminalIcon className="h-3 w-3" />
              <span>SSH</span>
              <span className="text-[hsl(var(--cyan))]">:{container.sshPort}</span>
            </div>
            <div className="bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[10px] text-[hsl(var(--text-secondary))] truncate">
                  {sshCommand}
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
                  <button
                    onClick={handleDownloadKey}
                    className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] transition-colors"
                    title="Download SSH key"
                  >
                    <Download className="h-3 w-3" />
                  </button>
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
                      className="flex items-center gap-1.5 text-[10px]"
                    >
                      <span className="text-[hsl(var(--text-primary))]">{vol.name}</span>
                      <span className="text-[hsl(var(--text-muted))]">→</span>
                      <span className="text-[hsl(var(--text-muted))] truncate">{vol.mountPath}</span>
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

      {/* Terminal */}
      {showTerminal && (
        <Terminal
          containerId={container.id}
          containerName={container.name}
          onClose={() => setShowTerminal(false)}
        />
      )}
    </div>
  );
}
