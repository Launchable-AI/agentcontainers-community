import { useState } from 'react';
import {
  Play,
  Square,
  Trash2,
  Terminal,
  Copy,
  Check,
  Download,
  HardDrive,
  Globe,
  Settings,
  ExternalLink,
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

interface ContainerCardProps {
  container: ContainerInfo;
}

export function ContainerCard({ container }: ContainerCardProps) {
  const [copied, setCopied] = useState(false);
  const [showReconfigure, setShowReconfigure] = useState(false);
  const startMutation = useStartContainer();
  const stopMutation = useStopContainer();
  const removeMutation = useRemoveContainer();
  const { data: config } = useConfig();

  const sshKeysPath = config?.sshKeysDisplayPath || '~/.ssh';
  const isRunning = container.state === 'running';
  const isBuilding = container.state === 'building';
  const isFailed = container.state === 'failed';
  const isPending =
    startMutation.isPending || stopMutation.isPending || removeMutation.isPending;

  const sshCommand = container.sshPort
    ? `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -i ${sshKeysPath}/acm.pem -p ${container.sshPort} dev@localhost`
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

  const stateConfig: Record<string, { bg: string; text: string; label: string }> = {
    running: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Running' },
    exited: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Exited' },
    created: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Created' },
    paused: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Paused' },
    stopped: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Stopped' },
    building: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Building...' },
    failed: { bg: 'bg-red-600/20', text: 'text-red-500', label: 'Failed' },
  };

  const currentState = stateConfig[container.state] || stateConfig.stopped;

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/50 backdrop-blur overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-700/50">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="font-semibold text-white text-lg truncate">
                {container.name}
              </h3>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${currentState.bg} ${currentState.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${container.state === 'building' ? 'animate-pulse' : ''} ${currentState.text.replace('text-', 'bg-')}`} />
                {currentState.label}
              </span>
            </div>
            <p className="text-sm text-gray-400 truncate">
              {container.image}
            </p>
          </div>

          {!isBuilding && (
            <div className="flex items-center gap-1">
              {isRunning ? (
                <button
                  onClick={() => stopMutation.mutate(container.id)}
                  disabled={isPending}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-700 hover:text-orange-400 disabled:opacity-50 transition-colors"
                  title="Stop"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : !isFailed && (
                <button
                  onClick={() => startMutation.mutate(container.id)}
                  disabled={isPending}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-700 hover:text-green-400 disabled:opacity-50 transition-colors"
                  title="Start"
                >
                  <Play className="h-4 w-4" />
                </button>
              )}
              {!isFailed && (
                <button
                  onClick={() => setShowReconfigure(true)}
                  disabled={isPending}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-700 hover:text-blue-400 disabled:opacity-50 transition-colors"
                  title="Reconfigure"
                >
                  <Settings className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => {
                  if (confirm(`Delete container "${container.name}"?`)) {
                    removeMutation.mutate(container.id);
                  }
                }}
                disabled={isPending}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-700 hover:text-red-400 disabled:opacity-50 transition-colors"
                title="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">
        {/* SSH Connection */}
        {container.sshPort && sshCommand && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
              <Terminal className="h-4 w-4 text-gray-500" />
              <span>SSH Connection</span>
              <span className="text-gray-500">•</span>
              <span className="text-gray-400 font-normal">Port {container.sshPort}</span>
            </div>
            <div className="rounded-lg bg-gray-900/70 border border-gray-700/50 p-3">
              <div className="flex items-center gap-3">
                <code className="flex-1 text-xs text-gray-300 font-mono truncate">
                  {sshCommand}
                </code>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={handleCopyCommand}
                    className="rounded-md p-1.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300 transition-colors"
                    title="Copy command"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={handleDownloadKey}
                    className="rounded-md p-1.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300 transition-colors"
                    title="Download SSH key"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Ports & Volumes Row */}
        {(container.ports.length > 0 || container.volumes.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Ports */}
            {container.ports && container.ports.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
                  <Globe className="h-4 w-4 text-gray-500" />
                  <span>Ports</span>
                </div>
                <div className="space-y-1.5">
                  {container.ports.map((port) => (
                    <a
                      key={`${port.host}-${port.container}`}
                      href={`http://localhost:${port.host}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors group"
                    >
                      <span className="font-mono">:{port.host}</span>
                      <span className="text-gray-600">→</span>
                      <span className="text-gray-400 font-mono">:{port.container}</span>
                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Volumes */}
            {container.volumes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
                  <HardDrive className="h-4 w-4 text-gray-500" />
                  <span>Volumes</span>
                </div>
                <div className="space-y-1.5">
                  {container.volumes.map((vol) => (
                    <div
                      key={vol.name}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="text-gray-300 font-medium">{vol.name}</span>
                      <span className="text-gray-600">→</span>
                      <span className="text-gray-500 font-mono text-xs">{vol.mountPath}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-gray-900/30 border-t border-gray-700/50">
        <p className="text-xs text-gray-500">
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
    </div>
  );
}
