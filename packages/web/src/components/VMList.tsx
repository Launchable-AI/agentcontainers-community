import { useState, useMemo } from 'react';
import { Plus, Server, AlertTriangle, Terminal, Play, Square, Trash2, Copy, Download, Cpu, MemoryStick, HardDrive, Network, Loader2, ScrollText, Check } from 'lucide-react';
import { useVms, useStartVm, useStopVm, useDeleteVm, useVmNetworkStatus, useCreateVm, useVmBaseImages, useConfig } from '../hooks/useContainers';
import { VmInfo, downloadVmSshKey } from '../api/client';
import { useConfirm } from './ConfirmModal';
import { LogViewer } from './LogViewer';

interface VMListProps {
  onCreateClick: () => void;
}

type ConnectionMode = 'remote' | 'local';

function VMCard({ vm }: { vm: VmInfo }) {
  const startVm = useStartVm();
  const stopVm = useStopVm();
  const deleteVm = useDeleteVm();
  const confirm = useConfirm();
  const { data: config } = useConfig();
  const [showLogs, setShowLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const [keyDownloaded, setKeyDownloaded] = useState(false);
  const [showChmodHint, setShowChmodHint] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('remote');

  const isRunning = vm.status === 'running';
  const isBooting = vm.status === 'booting' || vm.status === 'creating';
  const hasError = vm.status === 'error';

  // Check if remote mode is available (jump host configured)
  const hasJumpHost = !!(config?.sshJumpHost && config?.sshJumpHostKeyPath);
  const isTapMode = vm.networkMode === 'tap' && vm.guestIp;

  // Generate SSH command with configurable host, key path, and jump host
  const sshCommand = useMemo(() => {
    if (!vm.sshPort && !vm.guestIp) return null;

    const sshKeysPath = config?.sshKeysDisplayPath || '~/.ssh';
    const jumpHost = config?.sshJumpHost || '';
    const jumpHostKeyPath = config?.sshJumpHostKeyPath || '';
    const user = vm.sshUser || 'agent';

    // Local mode: direct connection (from the host machine)
    if (connectionMode === 'local') {
      const host = vm.guestIp || 'localhost';
      const port = isTapMode ? 22 : vm.sshPort;
      let cmd = `ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i ${sshKeysPath}/vm_id_ed25519`;
      if (port !== 22) {
        cmd += ` -p ${port}`;
      }
      cmd += ` ${user}@${host}`;
      return cmd;
    }

    // Remote mode: use ProxyCommand through jump host
    if (isTapMode && jumpHost && jumpHostKeyPath) {
      const host = vm.guestIp;
      // Use ProxyCommand format for proper key handling on both hops
      return `ssh -o ProxyCommand="ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i ${jumpHostKeyPath} -W %h:%p ${jumpHost}" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i ${sshKeysPath}/vm_id_ed25519 ${user}@${host}`;
    }

    // Fallback: no jump host configured, use direct connection
    const host = config?.sshHost || vm.guestIp || 'localhost';
    const port = isTapMode ? 22 : vm.sshPort;
    let cmd = `ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i ${sshKeysPath}/vm_id_ed25519`;
    if (port !== 22) {
      cmd += ` -p ${port}`;
    }
    cmd += ` ${user}@${host}`;
    return cmd;
  }, [vm, config, connectionMode, isTapMode]);

  const statusColors: Record<string, string> = {
    running: 'bg-[hsl(var(--green))]',
    booting: 'bg-[hsl(var(--yellow))]',
    creating: 'bg-[hsl(var(--yellow))]',
    stopped: 'bg-[hsl(var(--text-muted))]',
    paused: 'bg-[hsl(var(--cyan))]',
    error: 'bg-[hsl(var(--red))]',
  };

  const handleStart = () => {
    startVm.mutate(vm.id);
  };

  const handleStop = () => {
    stopVm.mutate(vm.id);
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete VM',
      message: `Are you sure you want to delete "${vm.name}"? This will delete all VM data including disk images.`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      deleteVm.mutate(vm.id);
    }
  };

  const copySshCommand = async () => {
    if (!sshCommand) return;

    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(sshCommand);
      } else {
        // Fallback for non-secure contexts (HTTP)
        const textArea = document.createElement('textarea');
        textArea.value = sshCommand;
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

  const downloadSshKey = async () => {
    try {
      const blob = await downloadVmSshKey();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vm_id_ed25519';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setKeyDownloaded(true);
      setShowChmodHint(true);
      setTimeout(() => setKeyDownloaded(false), 2000);
    } catch (error) {
      console.error('Failed to download SSH key:', error);
    }
  };

  return (
    <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-4 hover:border-[hsl(var(--cyan)/0.3)] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColors[vm.status] || statusColors.stopped}`} />
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">{vm.name}</h3>
        </div>
        <span className="text-[10px] font-mono text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-elevated))] px-1.5 py-0.5">
          {vm.status.toUpperCase()}
        </span>
      </div>

      {/* Resources */}
      <div className="flex gap-3 mb-3 text-[10px] text-[hsl(var(--text-muted))]">
        <div className="flex items-center gap-1">
          <Cpu className="h-3 w-3" />
          {vm.vcpus} vCPU
        </div>
        <div className="flex items-center gap-1">
          <MemoryStick className="h-3 w-3" />
          {vm.memoryMb} MB
        </div>
        <div className="flex items-center gap-1">
          <HardDrive className="h-3 w-3" />
          {vm.diskGb} GB
        </div>
      </div>

      {/* Image */}
      <div className="text-[10px] text-[hsl(var(--text-muted))] mb-3 truncate" title={vm.image}>
        Image: {vm.image}
      </div>

      {/* Network Info */}
      {vm.guestIp && (
        <div className="text-[10px] text-[hsl(var(--text-muted))] mb-3 flex items-center gap-1">
          <Network className="h-3 w-3" />
          {vm.guestIp} ({vm.networkMode})
        </div>
      )}

      {/* Error */}
      {hasError && vm.error && (
        <div className="text-[10px] text-[hsl(var(--red))] mb-3 bg-[hsl(var(--red)/0.1)] p-2 border border-[hsl(var(--red)/0.3)]">
          {vm.error}
        </div>
      )}

      {/* SSH Command */}
      {isRunning && sshCommand && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))]">
              <Terminal className="h-3 w-3" />
              SSH Command
            </div>
            {isTapMode && (
              <div className="flex items-center gap-0.5 text-[10px]">
                <button
                  onClick={() => setConnectionMode('remote')}
                  className={`px-1.5 py-0.5 transition-colors ${
                    connectionMode === 'remote'
                      ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                      : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]'
                  }`}
                  title="Connect from external machine via jump host"
                >
                  Remote
                </button>
                <button
                  onClick={() => setConnectionMode('local')}
                  className={`px-1.5 py-0.5 transition-colors ${
                    connectionMode === 'local'
                      ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                      : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]'
                  }`}
                  title="Connect from host machine directly"
                >
                  Local
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <code className="flex-1 text-[10px] bg-[hsl(var(--bg-base))] text-[hsl(var(--cyan))] px-2 py-1 font-mono truncate" title={sshCommand}>
              {sshCommand}
            </code>
            <button
              onClick={copySshCommand}
              className="p-1 hover:bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              title="Copy SSH command"
            >
              {copied ? <Check className="h-3 w-3 text-[hsl(var(--green))]" /> : <Copy className="h-3 w-3" />}
            </button>
            <button
              onClick={() => setShowLogs(true)}
              className="p-1 hover:bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))]"
              title="View boot logs"
            >
              <ScrollText className="h-3 w-3" />
            </button>
          </div>
          {connectionMode === 'remote' && !hasJumpHost && (
            <p className="text-[9px] text-[hsl(var(--amber))] mt-1">
              Configure SSH Jump Host in Settings for remote access
            </p>
          )}
        </div>
      )}

      {/* Chmod Hint */}
      {showChmodHint && (
        <div className="mb-3 p-2 bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-[hsl(var(--amber))]">Fix key permissions:</span>
            <button
              onClick={() => setShowChmodHint(false)}
              className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            >
              ×
            </button>
          </div>
          <code className="text-[hsl(var(--text-secondary))] block mt-1">
            chmod 600 {config?.sshKeysDisplayPath || '~/.ssh'}/vm_id_ed25519
          </code>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-[hsl(var(--border))]">
        {isRunning ? (
          <button
            onClick={handleStop}
            disabled={stopVm.isPending}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--yellow))] hover:bg-[hsl(var(--yellow)/0.1)] border border-[hsl(var(--yellow)/0.3)] disabled:opacity-50"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={startVm.isPending || isBooting}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
          >
            {isBooting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="h-3 w-3" />
                Start
              </>
            )}
          </button>
        )}

        <button
          onClick={downloadSshKey}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] border transition-colors ${
            keyDownloaded
              ? 'text-[hsl(var(--green))] border-[hsl(var(--green)/0.3)]'
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border-[hsl(var(--border))]'
          }`}
          title="Download SSH key"
        >
          {keyDownloaded ? <Check className="h-3 w-3" /> : <Download className="h-3 w-3" />}
          {keyDownloaded ? 'Downloaded' : 'Key'}
        </button>

        <div className="flex-1" />

        <button
          onClick={handleDelete}
          disabled={deleteVm.isPending || isRunning}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
          title={isRunning ? 'Stop VM before deleting' : 'Delete VM'}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Log Viewer */}
      {showLogs && (
        <LogViewer
          vmId={vm.id}
          title={vm.name}
          onClose={() => setShowLogs(false)}
        />
      )}
    </div>
  );
}

function CreateVMForm({ onClose }: { onClose: () => void }) {
  const createVm = useCreateVm();
  const { data: baseImages } = useVmBaseImages();
  const [name, setName] = useState('');
  const [baseImage, setBaseImage] = useState('');
  const [vcpus, setVcpus] = useState(1);
  const [memoryMb, setMemoryMb] = useState(1024);
  const [diskGb, setDiskGb] = useState(5);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createVm.mutateAsync({
        name,
        baseImage: baseImage || undefined,
        vcpus,
        memoryMb,
        diskGb,
        autoStart: true,
      });
      onClose();
    } catch (error) {
      console.error('Failed to create VM:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-4">Create Virtual Machine</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="my-vm"
              required
              pattern="^[a-zA-Z0-9][a-zA-Z0-9_.-]*$"
            />
          </div>

          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Base Image</label>
            <select
              value={baseImage}
              onChange={e => setBaseImage(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
            >
              <option value="">Default (ubuntu-24.04)</option>
              {baseImages?.map(img => (
                <option key={img.name} value={img.name}>
                  {img.name} {img.hasWarmupSnapshot ? '(fast boot)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">vCPUs</label>
              <input
                type="number"
                value={vcpus}
                onChange={e => setVcpus(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                min={1}
                max={32}
              />
            </div>
            <div>
              <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Memory (MB)</label>
              <input
                type="number"
                value={memoryMb}
                onChange={e => setMemoryMb(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                min={512}
                max={65536}
                step={256}
              />
            </div>
            <div>
              <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Disk (GB)</label>
              <input
                type="number"
                value={diskGb}
                onChange={e => setDiskGb(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                min={1}
                max={1000}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createVm.isPending || !name}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.3)] hover:bg-[hsl(var(--cyan)/0.1)] disabled:opacity-50"
            >
              {createVm.isPending ? 'Creating...' : 'Create VM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function VMList({ onCreateClick: _onCreateClick }: VMListProps) {
  const { data: vms, isLoading, error } = useVms();
  const { data: networkStatus } = useVmNetworkStatus();
  const { data: config } = useConfig();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [hostCopied, setHostCopied] = useState(false);

  // Generate host connection command
  const hostSshCommand = useMemo(() => {
    if (!config?.sshJumpHost || !config?.sshJumpHostKeyPath) return null;
    return `ssh -o IdentitiesOnly=yes -i ${config.sshJumpHostKeyPath} ${config.sshJumpHost}`;
  }, [config]);

  const copyHostCommand = async () => {
    if (!hostSshCommand) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(hostSshCommand);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = hostSshCommand;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setHostCopied(true);
      setTimeout(() => setHostCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--text-muted))]">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading VMs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--red))]">
        <AlertTriangle className="h-5 w-5 mr-2" />
        Failed to load VMs: {String(error)}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      {/* Network Status Warning */}
      {networkStatus && !networkStatus.healthy && (
        <div className="mb-4 p-3 bg-[hsl(var(--yellow)/0.1)] border border-[hsl(var(--yellow)/0.3)] text-[hsl(var(--yellow))]">
          <div className="flex items-center gap-2 text-sm font-medium mb-1">
            <AlertTriangle className="h-4 w-4" />
            Network Not Configured
          </div>
          <p className="text-xs text-[hsl(var(--text-muted))]">
            {networkStatus.message}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-[hsl(var(--text-muted))]">
            {vms?.length || 0} VM{(vms?.length || 0) !== 1 ? 's' : ''}
          </span>
          {networkStatus?.healthy && (
            <span className="text-[10px] text-[hsl(var(--green))] bg-[hsl(var(--green)/0.1)] px-2 py-0.5 border border-[hsl(var(--green)/0.3)]">
              Network: {networkStatus.availableTaps} TAPs available
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
        >
          <Plus className="h-3.5 w-3.5" />
          New VM
        </button>
      </div>

      {/* Host Connection Command */}
      {hostSshCommand && (
        <div className="mb-4 p-3 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]">
          <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-muted))] mb-2">
            <Server className="h-3 w-3" />
            Connect to Host
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[10px] bg-[hsl(var(--bg-base))] text-[hsl(var(--purple))] px-2 py-1.5 font-mono truncate" title={hostSshCommand}>
              {hostSshCommand}
            </code>
            <button
              onClick={copyHostCommand}
              className="p-1.5 hover:bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
              title="Copy host SSH command"
            >
              {hostCopied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--green))]" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* VM Grid */}
      {vms && vms.length > 0 ? (
        <div className="flex-1 overflow-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
          {vms.map(vm => (
            <VMCard key={vm.id} vm={vm} />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-[hsl(var(--text-muted))]">
          <Server className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm mb-1">No virtual machines</p>
          <p className="text-xs mb-4">Create a VM to get started with cloud-hypervisor</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Create VM
          </button>
        </div>
      )}

      {/* Create VM Modal */}
      {showCreateForm && (
        <CreateVMForm onClose={() => setShowCreateForm(false)} />
      )}
    </div>
  );
}
